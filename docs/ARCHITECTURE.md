# Architecture

## Overview

```
 Phone / laptop browser                         Server (one Node.js process)                  PostgreSQL 16
┌────────────────────────────┐   HTTPS/JSON   ┌───────────────────────────────────┐   SQL   ┌──────────────────────┐
│ React SPA (Vite build)     │ ─────────────▶ │ Express 5 REST API (/api/*)       │ ──────▶ │ 22 tables, FKs,      │
│ • TanStack Query cache     │ ◀───────────── │ • Zod validation per route        │         │ checks, indexes,     │
│ • Leaflet map (OSM tiles)  │   SSE stream   │ • session auth + role/facility    │         │ append-only triggers │
│ • qr-scanner (camera)      │ ◀───────────── │   scoping                         │         └──────────────────────┘
│ • Geolocation API          │                │ • lifecycle state machine         │
└────────────────────────────┘                │ • alert job (setInterval)         │
                                              │ • in-process event bus → SSE      │
                                              │ • serves built SPA in production  │
                                              └───────────────────────────────────┘
```

In development Vite serves the SPA on :5173 and proxies `/api` to the API on :4000, so the browser always talks to one origin.

## Why these choices

| Concern | Choice | Reason / rejected alternatives |
|---|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind v4, Radix primitives (shadcn-style components written in-repo) | Mature, fast builds; Radix gives accessible dialogs/menus without a heavy kit |
| Server state | TanStack Query | Caching, retries, invalidation after mutations; no global store needed |
| Backend | Express 5 + TypeScript | Boring and well understood; Express 5 forwards async errors natively |
| Validation | Zod 4 | One schema validates requests **and** generates the OpenAPI document |
| DB + ORM | PostgreSQL 16 + Drizzle ORM | Relational integrity is the point of a custody system. Drizzle is pure TypeScript (no binary engine), with plain SQL migrations |
| Live updates | Server-sent events | One-way server→browser push is all that's needed; simpler than WebSockets |
| Background work | `setInterval` job in the API | A queue (Redis/BullMQ) solves no current problem. All state is in PostgreSQL, so the job is idempotent |
| Redis | **Not used** | No caching or cross-process fan-out need at this scale |
| Maps | Leaflet + OpenStreetMap | Free, no API key. Tile URL is configurable |
| Routing | Optional OSRM-compatible URL | Off by default; planned routes are clearly separated from recorded positions |
| Passwords | Argon2id (`@node-rs/argon2`) | Current OWASP recommendation, prebuilt binaries for Windows/Linux/macOS |

## Authentication & sessions

- Opaque 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when `COOKIE_SECURE=true`). Only its SHA-256 is stored (`sessions.id`), so a database leak does not leak live sessions.
- Session row holds the **active organization**; a user may belong to several organizations and switch between them.
- Logout deletes the row; password change/reset deletes other sessions; disabling a member detaches them from the org immediately.
- **CSRF:** state-changing requests must carry `X-BWTS-CSRF: 1` (a custom header forces a CORS preflight, which the API never grants to other origins) and any `Origin` header must match. Combined with `SameSite=Lax`.
- **Rate limits:** 10 login attempts / 15 min per IP+email; 5 reset requests/hour per IP; 600 requests/min per IP overall.
- Password reset and invitation tokens are random, stored hashed, single use, and expire (1 hour / 7 days).

## Authorization model

Three roles only: `admin`, `facility_staff`, `transporter` (per organization membership).

- Every route is registered through `route()` (`apps/api/src/lib/http.ts`), which enforces `access: public | user | member` and the allowed roles **before** the handler runs.
- Every query filters by `organization_id` from the session — never from the request body. Records of another organization return **404**, not 403, to avoid confirming they exist.
- **Facility scoping** (finer than roles): staff see batches that originate at or are destined for their assigned facilities, and may only register waste at, receive at, or dispose at those facilities. Transporters see only batches/jobs they were assigned. The same rule is implemented once as a predicate (`canView`) and once as SQL (`visibilityFilter`).
- Lifecycle permissions live next to the state machine (`actions[].check`), so the UI's “what can I do next” list and the server's enforcement come from the same code.

## Data model (main tables)

`users`, `organizations`, `memberships` (+ `membership_facilities`), `sessions`, `password_reset_tokens`, `invitations`, `facilities`, `waste_categories`, `waste_batches`, `containers`, `container_identifiers`, `assignments`, `assignment_batches`, `custody_events`, `location_points`, `receipt_records`, `disposal_records`, `incidents`, `alerts`, `notifications`, `audit_logs`.

Integrity is enforced in the database, not only in code:
- foreign keys everywhere; unique tracking codes, assignment references, `(org, facility name)`, `(org, category code)`;
- partial unique indexes: one **active** identifier per `(method, value)` system-wide; one **open** assignment link per batch; one **open** alert per dedupe key;
- CHECK constraints: positive quantities, coordinate ranges, origin ≠ destination, due-by after pickup, hex colours, lower-case emails;
- **append-only** `custody_events` and `audit_logs` via a trigger that rejects UPDATE/DELETE (cascading deletion of a whole organization is still allowed);
- `waste_batches.version` for optimistic concurrency; transitions lock the row with `SELECT … FOR UPDATE`.
- All timestamps are `timestamptz` (UTC); the browser renders them in the viewer's timezone; PDFs use the organization's timezone.

## Waste lifecycle

```
generated ─segregate─▶ segregated ─(assigned to a job)─▶ ─pickup─▶ collected ─start trip─▶ in_transit
    │                      │                                                                  │
    └──── cancel ──────────┴──▶ cancelled                                                handover
                                                                                              ▼
                       disposed ◀─dispose─ received ◀─receive (accept)─ delivered ─receive (reject)─▶ rejected
                                                                                                         │
                                                                    in_transit (new job) ◀─reroute (admin)┘
```

`apps/api/src/services/lifecycle.ts` holds the table of actions: allowed source statuses, target status, who may do it, and the body schema. Each transition runs in one transaction: lock batch → check → apply side records (receipt/disposal/incidents) → update with version check → append custody event → audit log. An `Idempotency-Key` header makes retries safe (the same key returns the original result; a different duplicate attempt gets HTTP 422 because the status already moved on). Blocked attempts are audited and raise a low-severity admin alert.

Assignments (`services/assignments.ts`) group one or more segregated batches from one origin to one receiving facility for one transporter: `assigned → accepted → in_progress → completed | cancelled`. Starting a trip requires every batch to be picked up; the job completes automatically when everything has been handed over, which also switches location sharing off.

## Identification (QR / RFID / NFC)

- Each container gets a **QR identifier**: a 144-bit random token. The label encodes `APP_URL/s/<token>`, so a normal phone camera opens the app; the token reveals nothing on its own and resolves only for signed-in members of the owning organization.
- `container_identifiers` stores QR, RFID (EPC) and NFC (UID) values with one shared resolver (`POST /api/identify`). Tags can be registered, reassigned (explicit confirmation) and deactivated; collisions are prevented by a unique index.
- Scan sources in the browser all produce `{ method, value, source }`: camera QR, USB/Bluetooth keyboard-wedge RFID readers, Web NFC, manual entry. A fixed-reader gateway would call the same endpoint (see HARDWARE.md). The lifecycle never knows which hardware was used, only the recorded `scan_method`.

## GPS tracking

1. Transporter presses *Start sharing* on an accepted/in-progress job → `PUT /assignments/:id/tracking {active:true}`.
2. `useGeoTracking` calls `navigator.geolocation.watchPosition` (high accuracy). Fixes are throttled (≥15 s or ≥30 m), queued in memory, and uploaded in batches of ≤50 every 10 s; the queue survives network loss. A screen wake lock is requested where supported.
3. The API validates ownership, active sharing, job state, coordinate ranges and timestamps (within the sharing window, not in the future), de-duplicates on `(assignment, recorded_at)`, stores rows in `location_points`, updates `last_location_at`, and publishes an SSE `location` event.
4. The map shows the last fix, its time and accuracy circle, greys it out when older than the org's stale threshold, and draws the recorded path. Simulated points (demo mode / seed) are stored with `source = 'simulated'` and drawn in amber with a “SIMULATED” tag.
5. Sharing stops when the transporter stops it, or automatically on completion/cancellation (server rejects further points). Location history is deleted after the org's retention period by the background job.

## Alerts

Background job (every `ALERT_JOB_INTERVAL_SECONDS`), per organization, using that organization's thresholds: overdue collection, delayed transport, missing handover (custody held too long), pending receipt, stale/missing GPS during an in-progress trip. Event-driven alerts: failed receipt, incidents, blocked transitions (admins only). Alerts are de-duplicated with a partial unique index and **auto-resolve** when their condition clears. Each new alert notifies the relevant admins, facility staff and transporter in-app (and live via SSE).

## Reports

Seven report types built with parameterised SQL and the same scope rules as the rest of the API, exported as JSON (preview), CSV (UTF-8 BOM, formula-injection neutralised) or PDF (pdfkit, landscape table with organization, filters, timezone and a “not a regulatory certificate” footer).

## Scaling notes

- One API process is assumed for SSE fan-out and the alert timer. To run several instances, replace `lib/events.ts` with PostgreSQL `LISTEN/NOTIFY` and run the alert job in one instance (or guard it with an advisory lock).
- `location_points` grows fastest; it is indexed by `(assignment_id, recorded_at)` and pruned by the retention policy. Partitioning by month would be the next step at high volume.

## Repository layout

```
apps/api/src
  app.ts            Express app: security middleware, CSRF, routers, OpenAPI, SPA hosting
  index.ts          boot: migrations → listen → alert job
  db/               schema.ts, migrations/, migrate.ts, seed.ts
  lib/              http (route wrapper), session, audit, events, mailer, errors, crypto
  services/         lifecycle, assignments, identification, alerts, notify, orgs, settings
  routes/           auth, org (facilities/categories/team/invites/audit), batches,
                    identification, assignments (+ tracking), ops (incidents/alerts/
                    notifications/SSE), insights (dashboard/reports)
apps/api/test       integration tests (Vitest + Supertest, real PostgreSQL)
apps/web/src
  components/       ui kit, AppShell, Scanner, ActionDialog, TrackingMap, dialogs
  pages/            one file per screen
  lib/              api client, session/SSE, GPS hook, formatters, types
apps/web/e2e        browser acceptance test (Playwright)
```

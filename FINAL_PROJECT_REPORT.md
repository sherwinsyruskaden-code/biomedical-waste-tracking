# Final project report — Smart Biomedical Waste Tracking System (BWTS)

## 1. Problem

Biomedical waste (soiled dressings, sharps, contaminated plastics, glassware) is hazardous until treated. In practice it can be put in the wrong colour bag, left uncollected, handed over without a record, carried without anyone knowing where it is, or "disposed of" with no trace. Paper registers make these failures hard to detect and impossible to audit.

## 2. Objectives and what was delivered

| Objective | Delivered |
|---|---|
| Register and identify batches and containers | Batches with human-readable tracking codes (`BW-YYMMDD-XXXXXX`), 1–50 containers each, one QR label per container |
| Record categories and segregation | Configurable categories (template from India's BMW Rules 2016 colour coding), explicit segregation verification step |
| Track collection, custody, transport, receipt, disposal | Seven-stage state machine, multi-batch transport jobs, scanned custody transfers, receipt with weight/condition checks, disposal with category-allowed methods |
| QR identification | QR-only scanning in the UI (camera or image upload, deep link, printable demo labels). RFID/NFC remain as backend endpoints with no UI — **never tested with hardware** |
| Real GPS tracking | Transporter's phone shares position during active jobs; live map with freshness, accuracy, stale flags and recorded path |
| Dashboards, alerts, reports, audit | Live dashboard, threshold alerts with auto-resolve, in-app notifications, 7 reports as CSV/PDF, append-only audit log |
| Real accounts & organizations | Signup, login, reset, invitations, multi-organization membership |
| Data protection & permissions | Three roles + facility scoping, organization isolation, CSRF, rate limits, hashed tokens |
| End-to-end demonstrable workflow | Automated 16-step browser acceptance test passing |

## 3. Architecture summary

React SPA (Vite, Tailwind, TanStack Query, Leaflet) → Express 5 REST API (TypeScript, Zod) → PostgreSQL 16 (Drizzle ORM, SQL migrations). One Node process serves the API, the server-sent-event stream, the background alert job and, in production, the built SPA. Details and design rationale: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Key design decisions:
1. **Custody history is evidence**, so it is append-only at the database level (trigger rejects UPDATE/DELETE), every transition runs in a locked transaction, and the batch carries a version number.
2. **One source of truth for permissions**: the same `check` functions decide what the UI offers and what the API accepts.
3. **QR codes carry no data**, only a 144-bit random token, so a photographed label leaks nothing.
4. **Honesty about data provenance**: device GPS vs simulated positions are stored and drawn differently; planned routes are labelled as estimates; alerts are described as operational signals, not regulatory findings.
5. **Boring infrastructure**: Redis is only an optional session-lookup cache, with no queues or microservices — PostgreSQL holds all state; the system runs on a laptop.

## 4. Implementation size

- Database: 22 tables, 2 migrations (schema + integrity guards).
- API: 57 documented endpoints + SSE stream; OpenAPI generated from validation schemas.
- Frontend: 15+ screens, shared UI kit, scanner, GPS hook, map component.
- Tests: 60 API integration tests; a 16-step browser acceptance test plus landing, scan, date and motion browser suites.

## 5. Testing and verification

| Check | Result |
|---|---|
| `npm run typecheck` (API + web) | Pass |
| `npm test` — 60 integration tests on real PostgreSQL: registration, duplicates, validation, login/logout/session revocation, rate limiting, CSRF, password reset, org isolation (direct IDs, QR labels, reports, assignments), role enforcement, facility scoping, invitations (single use, existing accounts, switching orgs, signed-in-as-someone-else), full lifecycle, wrong-container scans, idempotent retries, duplicate handover/receipt-before-handover/disposal-before-receipt blocking, GPS validation/dedupe/ownership, auto-completion, rejection + incidents + reroute, alert job raise/dedupe/auto-resolve, RFID/NFC registration/collision/reassign, DB-level tamper protection, CSV/PDF export | 29/29 pass |
| `npm run test:e2e` — headless Chromium drives the real UI through the whole journey (§6) | 16/16 steps pass against the dev server **and** against the production build |
| Production build served by the API (`NODE_ENV=production`) | Pass |
| Data survives API restart (counts identical before/after) | Pass |
| Backup (`pg_dump -Fc`) and restore into a fresh database | Pass |
| Visual review of all main screens at 1440 px and 390 px | Done; issues found were fixed |

Bugs found by testing and fixed: PDF responses being replaced by an empty 204; nested forms inside scanner dialogs submitting the parent form; accepting an invitation while signed in as another user attached the new membership to the wrong session; rate-limit key not IPv6-safe; segregation events wrongly labelled "recorded without scan".

## 6. Acceptance criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | New user registers | ✅ | E2E step 1, API test |
| 2 | Logs in, creates organization and facility | ✅ | E2E 1–2 |
| 3 | Admin adds facility staff and transporter | ✅ | E2E 3 (invitation links) |
| 4 | Staff create a real batch | ✅ | E2E 4–5 |
| 5 | QR code generated | ✅ | E2E 4–5 (label sheet) |
| 6 | Scanning retrieves the correct batch | ✅ | E2E 6 (identifier entered in the scanner; camera decoding is the `qr-scanner` library and needs a real camera) |
| 7 | Valid segregation and collection events | ✅ | E2E 7–8b |
| 8 | Transporter receives assignment, accepts custody | ✅ | E2E 8a–8b |
| 9 | Transporter starts GPS; backend records permitted updates | ✅ | E2E 9 (browser Geolocation API with emulated coordinates) |
| 10 | Dashboard map shows latest position and timestamp | ✅ | E2E 10 |
| 11 | Delivery + handover recorded | ✅ | E2E 11 |
| 12 | Receipt and authorized disposal | ✅ | E2E 12 |
| 13 | Complete lifecycle history available | ✅ | E2E 13 |
| 14 | Accurate dashboard statistics, report export | ✅ | E2E 14 |
| 15 | No access to another organization's records | ✅ | E2E 15 + API isolation tests |
| 16 | Records survive logout/login and restart | ✅ | E2E 16 + restart check |
| 17 | Installable from documentation | ⚠️ | Steps verified in Linux; Windows PowerShell commands written but run by the student; Docker files unexecuted |

## 7. Limitations (honest list)

- No physical RFID/NFC hardware or moving phone was available; those paths are untested on real devices.
- Background GPS with the screen off needs a native app; the web app asks the driver to keep the page open (and requests a wake lock).
- Not a compliance certification tool; categories/thresholds are configurable templates.
- Single-instance design for live events and the alert timer.
- Real email delivery untested (console-mail mode used).
- Not deployed publicly.

## 8. Future work

Native transporter app (background location, offline-first), fixed RFID gateway with device API keys, email/SMS alert delivery, signed digital manifests (e.g. hash-chained custody events and e-signatures at handover), regulator-specific report templates (e.g. Form IV annual reports in India), multi-instance support via LISTEN/NOTIFY, partitioned location history, photo evidence uploads for incidents.

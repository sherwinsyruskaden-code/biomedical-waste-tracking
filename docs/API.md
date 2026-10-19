# API reference

Interactive documentation is served by the API at **`/api/docs`** (OpenAPI 3.1, generated from the same Zod schemas that validate requests). The raw document is at `/api/openapi.json`.

## Conventions

- Base path `/api`, JSON in and out. Authentication is the `bwts_session` HTTP-only cookie set by signup/login/invitation acceptance.
- Every `POST`/`PATCH`/`PUT`/`DELETE` must send the header `X-BWTS-CSRF: 1`.
- Errors: `{ "error": { "code", "message", "details"? } }`. Validation errors (400) include `details.fields` keyed by field path.
- Status codes: 400 validation · 401 not signed in · 403 role not allowed · 404 not found **or belongs to another organization** · 409 conflict/duplicate · 422 invalid lifecycle transition (message explains why) · 429 rate limited.
- Lifecycle actions accept an `Idempotency-Key` header (8–100 chars `[A-Za-z0-9_-]`); repeating a request with the same key returns the original result with `replayed: true`.
- Timestamps are ISO-8601 UTC. Lists are paginated with `page` and `pageSize` (max 100) and return `{ items, total, page, pageSize }`.

## Dates and times

Day filters (`from`, `to` on batches and reports) are calendar days `YYYY-MM-DD` in the organization's timezone: `from` is inclusive, `to` runs to the end of that day, neither may be in the future, and `from` ≤ `to`. Scheduling: pickup from now−10 min to now+90 days; due time after pickup and ≤ 30 days later; reroute due time in the future, ≤ 30 days; disposal not before the accepted receipt and not more than 5 min ahead; no instant before year 2000. Violations return 400 with `fields: { <field>: message }`.

## Endpoints (60)

### Auth

| Method | Path | Purpose | Access |
|---|---|---|---|
| POST | `/api/auth/signup` | Register a user and create their organization | public |
| POST | `/api/auth/login` | Sign in with email and password | public |
| POST | `/api/auth/logout` | Sign out and invalidate the session | signed-in user |
| GET | `/api/auth/me` | Current user, memberships and active organization | public |
| POST | `/api/auth/switch-organization` | Change the active organization for this session | signed-in user |
| POST | `/api/auth/create-organization` | Create an additional organization (caller becomes admin) | signed-in user |
| PATCH | `/api/auth/profile` | Update own name / phone | signed-in user |
| POST | `/api/auth/change-password` | Change own password (signs out other sessions) | signed-in user |
| POST | `/api/auth/forgot-password` | Request a password-reset link (always returns ok) | public |
| POST | `/api/auth/reset-password` | Set a new password using a reset token | public |

| GET | `/api/auth/demo` | Whether one-click demo sign-in is enabled, and its accounts | public |
| POST | `/api/auth/demo-login` | DEMO MODE ONLY: sign in to the synthetic demo organization as one of its demo users (`{ account: "admin"\|"staff"\|"plant"\|"driver" }`) | public |

### Organization

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/api/organization` | Organization profile and settings | organization member |
| PATCH | `/api/organization` | Update organization profile | organization member (admin) |
| PUT | `/api/organization/settings` | Update operational thresholds | organization member (admin) |
| GET | `/api/audit-logs` | Organization audit trail | organization member (admin) |

### Facilities

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/api/facilities` | List facilities | organization member |
| POST | `/api/facilities` | Create facility | organization member (admin) |
| PATCH | `/api/facilities/{facilityId}` | Update facility (or deactivate) | organization member (admin) |

### Categories

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/api/categories` | List waste categories | organization member |
| POST | `/api/categories` | Create waste category | organization member (admin) |
| PATCH | `/api/categories/{categoryId}` | Update waste category | organization member (admin) |

### Team

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/api/members` | List organization members | organization member |
| PATCH | `/api/members/{membershipId}` | Change a member's role, status, facilities or vehicle | organization member (admin) |
| GET | `/api/invitations` | List pending invitations | organization member (admin) |
| POST | `/api/invitations` | Invite a staff member or transporter (returns a one-time link) | organization member (admin) |
| DELETE | `/api/invitations/{invitationId}` | Revoke an invitation | organization member (admin) |
| GET | `/api/invitations/lookup/{token}` | Inspect an invitation token (public) | public |
| POST | `/api/invitations/accept` | Accept an invitation (creates the account if needed) | public |

### Batches

| Method | Path | Purpose | Access |
|---|---|---|---|
| POST | `/api/batches` | Register a new waste batch (creates containers + QR labels) | organization member (admin, facility_staff) |
| GET | `/api/batches` | Search and filter batches (paginated) | organization member |
| GET | `/api/batches/{batchId}` | Batch detail with containers, timeline, receipt, disposal and allowed actions | organization member |
| PATCH | `/api/batches/{batchId}` | Edit a batch (only while status is generated) | organization member (admin, facility_staff) |

### Lifecycle

| Method | Path | Purpose | Access |
|---|---|---|---|
| POST | `/api/batches/{batchId}/actions/{action}` | Perform a lifecycle action (segregate, cancel, pickup, handover, receive, dispose, reroute). Send an Idempotency-Key header to make retries safe. | organization member |

### Identification

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/api/batches/{batchId}/labels` | Printable QR labels (SVG) for every container in the batch | organization member |
| POST | `/api/identify` | Resolve a scanned identifier (QR in the UI) to its container and batch, including category, origin, container count | organization member |
| POST | `/api/containers/{containerId}/identifiers` | Register (or move) an RFID / NFC tag on a container | organization member (admin, facility_staff) |
| DELETE | `/api/identifiers/{identifierId}` | Deactivate an RFID / NFC tag | organization member (admin, facility_staff) |

### Assignments

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/api/assignments` | List transport assignments (transporters see only their own) | organization member |
| POST | `/api/assignments` | Create a transport assignment for one or more segregated batches | organization member (admin) |
| GET | `/api/assignments/{assignmentId}` | Assignment detail with batches, facilities and latest position | organization member |
| PATCH | `/api/assignments/{assignmentId}` | Edit before the trip starts: reassign transporter, add/remove batches, change due time | organization member (admin) |
| POST | `/api/assignments/{assignmentId}/{action}` | Assignment action: accept / decline / start / cancel | organization member |

### Tracking

| Method | Path | Purpose | Access |
|---|---|---|---|
| PUT | `/api/assignments/{assignmentId}/tracking` | Transporter switches location sharing on/off for their job | organization member (transporter) |
| POST | `/api/assignments/{assignmentId}/locations` | Upload device GPS fixes (batched, up to 50; duplicates ignored) | organization member (transporter) |
| GET | `/api/assignments/{assignmentId}/locations` | Recorded position history for an assignment | organization member |
| GET | `/api/tracking/live` | Latest reported position for every active assignment you may see | organization member |
| GET | `/api/assignments/{assignmentId}/route` | Planned route from an OSRM-compatible routing service, if configured | organization member |
| POST | `/api/demo/assignments/{assignmentId}/simulate` | DEMO MODE ONLY: generate clearly-labelled simulated positions toward the destination | organization member (admin) |
| GET | `/api/demo/labels` | DEMO MODE + demo org only: demo batches visible to your role with their QR label and the next permitted actions | organization member |
| GET | `/api/events/stream` | Server-sent events: location, notification and invalidate events |  |

### Incidents

| Method | Path | Purpose | Access |
|---|---|---|---|
| POST | `/api/incidents` | Report an incident or exception (spill, leak, delay, …) | organization member |
| GET | `/api/incidents` | List incidents | organization member |
| POST | `/api/incidents/{incidentId}/resolve` | Resolve an incident with notes | organization member (admin, facility_staff) |

### Alerts

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/api/alerts` | List alerts (open by default) | organization member |
| POST | `/api/alerts/{alertId}/resolve` | Acknowledge / resolve an alert | organization member (admin, facility_staff) |

### Notifications

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/api/notifications` | Your in-app notifications | organization member |
| POST | `/api/notifications/read` | Mark notifications read (all if ids omitted) | organization member |

### Dashboard

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/api/dashboard` | Operational overview from live data (scoped to what you may see) | organization member |

### Reports

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/api/reports` | Run a report (format=json/csv/pdf). Always scoped to your organization and permissions. | organization member (admin, facility_staff) |

## Lifecycle action bodies

`POST /api/batches/{batchId}/actions/{action}`

| Action | Body |
|---|---|
| `segregate` | `{ confirmSegregation: true, notes? }` |
| `cancel` | `{ reason }` |
| `pickup`, `handover` | `{ scanMethod: "qr"\|"rfid"\|"nfc"\|"manual", identifier?, notes? (required if manual), latitude?, longitude? }` |
| `receive` | `{ accepted, receivedQuantity, unit, condition: "intact"\|"damaged"\|"leaking"\|"mislabelled", notes? (required if rejected), scanMethod?, identifier? }` |
| `dispose` | `{ method, treatedQuantity?, unit?, documentRef?, notes?, disposedAt? }` — method must be allowed for the category |
| `reroute` (admin) | `{ destinationFacilityId, dueBy, notes? }` |

## Live events

`GET /api/events/stream` (server-sent events, cookie-authenticated):

- `location` — `{ assignmentId, transporterUserId, originFacilityId, destinationFacilityId, point }`, sent only to users allowed to see that job;
- `notification` — a new in-app notification for the current user;
- `invalidate` — `{ kind }`, a content-free hint that batches/assignments/alerts changed.

## Organization approval, collection requests and demo scans

| Method & path | Access | Purpose |
|---|---|---|
| `GET /api/platform/organizations?status=pending\|approved\|rejected\|all` | platform administrator | Registration review queue: applicant, organization details, declared facilities |
| `POST /api/platform/organizations/:id/approve` `{ note? }` | platform administrator | Approve a pending organization (not one you belong to) |
| `POST /api/platform/organizations/:id/reject` `{ note }` | platform administrator | Reject with a reason; nothing is deleted |
| `POST /api/batches/:id/request-collection` `{ notes? }` | origin-hospital staff, admin | Creates the transport assignment to the configured treatment plant and assigns a transporter, who must accept |
| `POST /api/demo/batches/:id/simulate-scan` `{ action: "pickup" \| "handover" }` | transporter, admin, **demo organization only** | Runs the real lifecycle action with the batch's real QR label; recorded with `details.simulatedScan = true` |

Members of a **pending** or **rejected** organization get `403` with code `organization_pending` / `organization_rejected` from every operational endpoint. `GET /api/facilities` returns `access: "managed" | "own" | "partner"`, and partner facilities only include name, type, address, contact and location.

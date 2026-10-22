# Viva preparation

Short, accurate answers to questions examiners are likely to ask. Every claim here matches the code.

## The project in one minute

BWTS tracks biomedical waste from the moment it is bagged on a ward until it is destroyed at a treatment plant. Each container gets a QR label; every handover is recorded by scanning, which moves custody from a facility to a named transporter and on to the plant. While a transporter drives, their phone shares GPS so admins can see where the waste is and how fresh that position is. The full history is stored append-only in PostgreSQL and can be exported as CSV or PDF.

## Architecture questions

**Why a monolith instead of microservices?** One team, one database, one deployable. The problem is data integrity, not independent scaling. A single Node process serves the API, live events and the alert job; ARCHITECTURE.md explains how to scale out later (LISTEN/NOTIFY, one alert worker).

**Why PostgreSQL rather than MongoDB?** Custody is relational: batches belong to facilities, move through assignments, are handled by users. Foreign keys, transactions, CHECK constraints, partial unique indexes and triggers enforce rules the application could forget.

**Why Drizzle?** Type-safe queries in TypeScript, plain SQL migrations, no native query engine to install. Raw SQL is still used where it is clearer (reports).

**Where is Redis used?** Only as an optional cache for the login-session lookup (`apps/api/src/lib/redis.ts`, `lib/session.ts`). Sessions and all other state stay in PostgreSQL, which is the source of truth; if `REDIS_URL` is empty or Redis is down the app runs exactly as before. Live updates stay in-process and the alert job is a timer, so nothing else needed Redis.

**Why server-sent events, not WebSockets?** Updates only flow server → browser. SSE is plain HTTP, reconnects automatically, and works with cookie auth.

## Data integrity

**How do you stop someone editing history?** `custody_events` and `audit_logs` have a `BEFORE UPDATE OR DELETE` trigger that raises an error. Even a developer with SQL access gets "append-only". Only deleting a whole organization cascades.

**What stops two people handing over the same batch at once?** The transition runs in a transaction that locks the batch row (`SELECT … FOR UPDATE`), checks the current status, and updates with `WHERE version = <read version>`. The second request sees the new status and gets a 422 explaining why.

**What about a network retry?** Clients send an `Idempotency-Key`. A unique index on `(organization_id, idempotency_key)` means the retry returns the original result (`replayed: true`) instead of applying twice.

**Can a batch be disposed without being received?** No: `dispose` is only allowed from `received`; `receive` only from `delivered`; `handover` only during an in-progress trip. Tested.

## Security

- Passwords: Argon2id. Sessions: random 256-bit tokens in HTTP-only, SameSite=Lax cookies; only their SHA-256 is stored.
- CSRF: custom `X-BWTS-CSRF` header required on writes (forces a CORS preflight that other origins can't pass) + Origin check.
- Authorization: every route declares its access level and roles in one wrapper; queries always filter by the session's organization; foreign records return 404.
- Facility scoping: staff only act at facilities assigned to them; transporters only see their own jobs.
- Rate limiting on login and password reset; reset/invite tokens are hashed, single-use and expire.
- QR labels contain only a random token; scanning resolves it only for members of the owning organization.
- No patient data is collected — batches record ward/department only.
- Location is collected only while the transporter explicitly shares for an active job, is visible only to people involved, and is deleted after a configurable retention period.

## GPS questions

**Does the system track the bag?** No — it tracks the transporter's device. RFID tags identify a container when read; they don't report location.

**How often are positions sent?** Fixes are stored at most every 15 s unless the vehicle moved 30 m, queued locally, and uploaded every 10 s in batches. This saves battery and data and survives brief network loss.

**How do you know a position is stale?** Each point keeps its device timestamp; the map compares it to now against the organization's threshold (default 5 min) and the alert job raises a "GPS stale" alert during in-progress trips.

**What if location permission is denied?** The page explains how to allow it; the job can still proceed, but admins see "Tracking off" alerts.

**What is "simulated"?** In demo mode an admin can generate positions toward the destination for presentations. They are stored with `source = 'simulated'` and drawn amber with a label — never presented as real.

**Planned route vs actual path?** Recorded positions draw a solid cyan line. A planned route (if an OSRM server is configured) is a dashed grey line labelled as an estimate.

## RFID / NFC

The UI is QR-only (I removed RFID/NFC/manual entry from the interface because I had no hardware to test). RFID/NFC identifiers can still be stored and resolved through the same backend endpoint, but that path is untested with hardware and has no screen.

## Testing

60 API integration tests run against a real PostgreSQL test database (not mocks) and cover auth, isolation, lifecycle rules, GPS validation, alerts and exports. A browser end-to-end test drives the real UI through the full 16-step acceptance journey, including emulated geolocation, and passes against both the dev server and the production build. I also checked restart persistence and a backup/restore round trip.

## Regulations

The default categories follow the colour coding of India's Bio-Medical Waste Management Rules, 2016 (as amended) — yellow, red, white (translucent) and blue — as an editable template. The app does not claim compliance; thresholds such as "collect within 24 h" are configurable defaults, and every PDF says it is not a regulatory certificate.

## Likely tricky questions

- *"What if the transporter scans a container from another batch?"* — rejected: "The scanned container belongs to a different batch."
- *"What if a label is damaged?"* — manual recording is allowed only with a written reason, and it is shown as "Recorded without scan" in the history.
- *"What if the plant rejects a load?"* — receipt with `accepted: false` requires a reason, raises a high-severity alert, custody returns to the transporter, and an admin can reroute it to another plant as a new job.
- *"What happens if the weight differs?"* — above the configured tolerance (default 10%) an incident is opened automatically.
- *"Who can see GPS history?"* — admins, the transporter, and staff at the pickup or destination facility of that job; viewing is audit-logged.
- *"What would you do next?"* — native driver app for background GPS, RFID gateway, email/SMS alerts, e-signatures at handover, regulator report templates.

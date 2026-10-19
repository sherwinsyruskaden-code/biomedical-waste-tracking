# BWTS — Smart Biomedical Waste Tracking System

Track biomedical waste from the ward to final disposal: QR-labelled containers, a scanned chain of custody, live transport GPS and audit-ready CSV/PDF reports. Built as an individual academic project, structured to grow into a real product.

**Stack:** React 19 + TypeScript + Vite + Tailwind · Node.js + Express 5 + TypeScript · PostgreSQL 16 + Drizzle ORM · Leaflet/OpenStreetMap · Server-sent events. No paid services required.

| | |
|---|---|
| Web app (dev) | http://localhost:5173 |
| API (dev) | http://localhost:4000 |
| API docs (OpenAPI) | http://localhost:4000/api/docs · raw: `/api/openapi.json` |
| Health check | http://localhost:4000/api/health |

More detail: [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Demo script](docs/DEMO.md) · [Hardware notes (RFID/NFC, backend only)](docs/HARDWARE.md) · [Project report](FINAL_PROJECT_REPORT.md) · [Viva prep](VIVA_PREPARATION.md) · [Plan & checklist](IMPLEMENTATION_PLAN.md)

---

## 1. Prerequisites

- **Node.js 22.9 or newer** (`node -v`). Download from nodejs.org (LTS).
- **PostgreSQL 16** — either
  - **Docker Desktop** (easiest: the database runs in a container with a persistent volume), or
  - a native install from postgresql.org (Windows installer). Then create a user/database matching `.env`.
- Git, and VS Code (optional).

## 2. Install (Windows PowerShell)

```powershell
cd $HOME\Documents\biomedical-waste-tracking
npm install
Copy-Item .env.example .env        # then edit if needed
docker compose up -d db            # starts PostgreSQL 16 (skip if you installed PostgreSQL natively)
npm run db:migrate                 # creates all tables (also runs automatically when the API starts)
npm run db:seed                    # OPTIONAL: sample organization with synthetic data (never deletes)
npm run dev                        # starts API (4000) + web app (5173)
```

Open **http://localhost:5173**. Open the folder in VS Code with `code .`

> macOS/Linux: the same commands work; use `cp .env.example .env`.

**Native PostgreSQL instead of Docker** — in `psql` as the `postgres` user:

```sql
CREATE USER bwts WITH PASSWORD 'bwts_dev_password';
CREATE DATABASE bwts OWNER bwts;
CREATE DATABASE bwts_test OWNER bwts;
```

## 3. First use

- **Create an account → Register an organization:** you become the organization's admin. Choose the **Facility Type** (only *Hospital* or *Lab*) and enter the **Facility Registration ID** exactly as on your registration documents, plus address, city, state and postal code. The ID is stored on the facility, shown prominently to the reviewer and searchable in the approval queue; it is recorded as entered and is **never verified or generated** by this system. The organization starts **pending**: you can sign in and see its status, but nothing operational works until it is approved. Registration does not require inviting anyone. After approval, follow the dashboard checklist: add a treatment plant if needed, invite staff and transporters when you have them, register the first batch. Every password field has a show/hide toggle.
- **Transporters belong to one organization.** The data model has no cross-organization sharing, and people are never attached or moved between organizations automatically. A new organization therefore has no transporter until its admin invites one; until then the *Request collection* dialog says so plainly and the rest of the app stays usable.
- **Joining an organization (hospital staff, treatment-plant staff, transporters):** you never pick your own role. Your organization admin invites you (a one-time link valid 7 days, with role and facility already set). Open the link, or use *Already have an invitation? Accept invitation* and paste it. Without SMTP configured, the admin copies the link and sends it themselves.
- **Passwords** must be at least **4 characters** (sign-up, invitation, change and reset). The API and the web forms enforce the same rule. Passwords are still stored as Argon2id hashes and sign-in attempts are rate-limited.
- **Approving organizations (a separate permission, not a role):** there is no "platform administrator" role or sign-in. Instead, the *Organization approvals* section of the admin interface appears only for an organization admin whose account also holds the **organization-review permission**. The permission is a flag on the user that can only be set on the server, never through sign-up or any API call, and every approval endpoint checks it. An ordinary organization admin cannot open the section or call its API (403), and nobody can review an organization they belong to or applied for. The review panel shows the admin's full name and full email, facility type, name and registration ID, full address, phone, submission date, status and any previous review, and can be searched by registration ID, facility, organization, name or email. Approvals and rejections (with a reason) are timestamped and written to that organization's audit log; rejecting keeps all its records.
  - Grant it: first create the account normally, then run `npm run platform-admin -- person@example.org` (add `--revoke` to remove it). Give it to someone in an *already approved* organization, because a member of a pending one cannot enter the app.
  - Local evaluation: the sample **Main Admin** account (below) already holds the permission and two pending sample organizations are waiting for review there.
- **The waste journey (one batch, one QR):** hospital staff register a batch (category, quantity, ward, containers; the origin is filled in automatically from their hospital, no destination is asked for). Its **own QR code** is shown straight away, and **View QR Code** / **Print QR Label** on the batch page reopen the same code at any time (it never changes). After verifying segregation, staff click **Request collection** and **choose the transporter** (only **available** transporters are listed). A transporter holds **one active order at a time**, from assignment until the batch is handed over at the plant; this is enforced in the API (row lock inside the transaction, so simultaneous requests cannot double-book) and, where existing data allows, by a partial unique index. The destination is the organization's authorised treatment plant (*Settings → Organization → Collection destination*, or automatic when there is one). Only the chosen transporter sees the request; they **accept** (or **decline**), scan the batch's QR at pickup and start the trip. **Declining** is a real transition: it is stored with a timestamp, recorded in the batch history, and notifies the hospital's staff and admins (code, transporter, time, next step). The batch shows *Declined*, can be requested again from an available transporter, the history is kept, and the decliner can no longer act on it. On arrival the transporter just taps **Mark arrived** (no scan). The batch then shows **Arrived — awaiting receipt** in the plant's list. **Plant staff scan the batch's QR** with their own account (**Scan Incoming Batch**, or pick it from the arrivals list if no camera), the app validates it, and they click **Confirm receipt**; nothing is received automatically. Plant staff only see approved collections that are on the road, arrived or received. One tracking code and one QR follow the batch throughout and its history lists every step.
- **Presenting with your own batch:** register a batch as Hospital A and keep its QR page open (**Present full screen** enlarges it, or print it). As the transporter, scan that QR with the camera or with *Scan a photo or screenshot*. Where no scan is possible in the sample organization, the Scan page's **Use a batch's QR** picker (newest batch first) or the **Simulate QR scan** button on the collection page use the same real QR and the same server checks; the result is marked *simulated* everywhere and in the history. Plant staff scan the arriving batch to receive it (a simulated scan is labelled as such); the Main Admin is never asked to scan.
- **Alerts and incidents are not part of this version.** Their screens and endpoints were removed and no new alerts or incidents are recorded. Stored rows, the tables and the code are kept (`apps/api/src/services/alerts.ts`, flag `ALERTS_ENABLED`) so the feature can be restored later. The bell now opens *Notifications* (new collection requests and arrivals).
- **Who sees what:** hospital staff see only their own hospital's batches plus the plant's name, address and contact. Plant staff see waste addressed to their plant. Transporters see only their own collections. Organization admins see their whole organization. These rules are enforced in the API's queries, not just hidden in the UI.
- **One-click sign-in** (`DEMO_MODE=true`): the landing and sign-in pages offer four choices: **Hospital Staff** (opens **Hospital A** / **Hospital B**), **Transporter**, **Treatment Plant Staff** and **Main Admin**. Each signs in with that account's real permissions. Sessions last 4 hours and end when the browser closes. **Set `DEMO_MODE=false` on any public server.**
- **Sample data:** all of it is synthetic. A small set of four preloaded batches (three transporters; one is on the road, so it is not offered for new requests) have tracking codes starting with **SMP-** and back-dated times, so batches you register (codes starting with BW-, newest first) are easy to spot. The first quick sign-in on an empty database creates the sample data. Password for every sample account: `Demo-pass-2026`.

| Email | Role | Facility |
|---|---|---|
| staff@sample.bwts.local | Hospital staff | Sunrise General Hospital (Hospital A) |
| staff.b@sample.bwts.local | Hospital staff | Sunrise Women & Children Hospital (Hospital B) |
| driver@sample.bwts.local / driver2@… / driver3@… | Transporters | Own collections only |
| plant@sample.bwts.local | Treatment-plant staff | GreenCycle Treatment Plant |
| admin@sample.bwts.local | Main Admin (organization admin + review permission) | All three facilities |
| lakeview@sample.bwts.local / coastal@sample.bwts.local | Applicants | Two **pending** sample organizations to approve or reject |

In the sample organization the transporter can also use **Simulate QR scan** on the collection page, or the picker on the Scan page. Both perform the real pickup or arrival with that batch's real QR label (no second device needed) and the history records them as a *simulated QR scan*, never as a physical scan.

**Existing data is never deleted automatically.** Sample-data upgrades are versioned: a marker (`sampleDataVersion`) is stored in the sample organization's settings, so the one-time in-place refresh of an older sample (renames, top-ups) runs once and every later restart is a no-op. It never touches your own batches, users or other organizations. An existing database keeps its older, larger set of sample batches; to remove the surplus *unused* sample batches opt in with `npm run db:seed:trim` (dry run, lists what would go) and `npm run db:seed:trim -- --yes` (does it). It only ever targets batches in the sample organization that were created as synthetic sample batches (and their own assignments); batches you registered are never selected. To get the small preloaded set on a throwaway/test database run `npm run db:seed:reset`. **This deletes the sample organization and everything in it, including batches you registered there, then recreates it.** Real organizations are never touched.

## 4. Environment variables (`.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `TEST_DATABASE_URL` | Separate database the tests **wipe** — never point it at real data |
| `APP_URL` | Public URL of the web app (links in emails; CSRF origin check) |
| `PORT` | API port (default 4000) |
| `SESSION_TTL_HOURS` | Session lifetime (default 168 = 7 days) |
| `COOKIE_SECURE` | `true` when served over HTTPS |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Real email for password reset and invitations. Empty = **console-mail mode**: links are printed in the API terminal |
| `VITE_MAP_TILE_URL`, `VITE_MAP_ATTRIBUTION` | Map tiles. Default OpenStreetMap (no key; follow the OSM tile usage policy) |
| `ROUTING_URL` | Optional OSRM-compatible routing server for *planned* routes and ETA |
| `DEMO_MODE` | `true` enables one-click demo sign-in and the admin-only, clearly labelled simulated-trip tool. **Set `false` on public servers** — anyone could otherwise open the demo organization |
| `ALERT_JOB_INTERVAL_SECONDS` | How often the background job runs (it now only applies the location-history retention setting; alerts are switched off) |

Never commit `.env` (it is git-ignored).

## 5. Commands

| Command | What it does |
|---|---|
| `npm run dev` | API + web app with hot reload |
| `npm run dev:api` / `npm run dev:web` | Run one side only |
| `npm run build` | Type-check and build both apps |
| `npm start` | Run the production API, which also serves the built web app at http://localhost:4000 (set `NODE_ENV=production`) |
| `npm run typecheck` | TypeScript checks for both apps |
| `npm test` | API integration tests against `TEST_DATABASE_URL` (real PostgreSQL) |
| `npm run test:e2e` | Browser end-to-end acceptance test (needs `npm run dev` running) |
| `npm run test:e2e:landing` / `:scan` / `:dates` / `:motion` / `:workflow` | Browser regression suites: landing/signup/session, QR scanning, date pickers and timezones, reduced-motion |
| `node scripts/audit-api-calls.mjs` | Cross-checks every frontend API call against the backend routes (method + path) |
| `npm run db:migrate` | Apply migrations |
| `npm run db:generate --workspace apps/api` | Create a migration after editing `apps/api/src/db/schema.ts` |
| `npm run db:seed` | Create the sample data if missing, otherwise refresh its names/accounts in place (non-destructive) |
| `npm run db:seed:trim` | Opt-in cleanup of surplus sample batches: dry run by default, `-- --yes` to apply; only synthetic sample batches in the sample organization |
| `npm run test:e2e:registration` | Browser suite: registration fields, password toggle, approval search/details |
| `npm run db:seed:reset` | **Destructive:** delete the sample organization and everything in it, then recreate the small preloaded set |
| `npm run platform-admin -- <email> [--revoke]` | Grant / revoke the organization-review permission (server only) |

**Production build on Windows:**

```powershell
npm run build
$env:NODE_ENV="production"; $env:APP_URL="http://localhost:4000"; npm start
```

**End-to-end test browser:** run `npx playwright install chromium` once, or set `$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"`.

## 6. Where data lives

- **Docker:** the named volume `bwts-pgdata`. It survives `docker compose down`, restarts and rebuilds; only `docker compose down -v` deletes it. See it with `docker volume ls`.
- **Native PostgreSQL:** your PostgreSQL data directory (on Windows typically `C:\Program Files\PostgreSQL\16\data`).
- Nothing is stored in browser localStorage. Generated reports are streamed, not stored.

**Back up / restore:**

```powershell
.\scripts\backup-db.ps1                                     # writes backups\bwts-<timestamp>.dump
.\scripts\restore-db.ps1 backups\bwts-20261018-120000.dump  # replaces current data
```

## 7. Maps, GPS and phones

- Maps use OpenStreetMap tiles in the user's browser — no key needed. For heavy use point `VITE_MAP_TILE_URL` at your own tile server or a provider (e.g. MapTiler) and restart `npm run dev:web`.
- GPS comes from the **transporter's phone browser** while they press *Start sharing* on an active job. Browsers only allow camera and location on **HTTPS or localhost**. To test on a phone over Wi-Fi, use an HTTPS tunnel (e.g. `cloudflared tunnel --url http://localhost:5173`, or ngrok) and set `APP_URL` to that URL. Keep the job page open while driving; sharing stops automatically when the job completes.
- The system tracks the **device carrying the waste**, not the bag itself.
- Planned routes/ETA appear only if `ROUTING_URL` is set (e.g. a self-hosted OSRM). They are labelled as estimates, separate from recorded positions.

## 8. QR scanning (the only scanning method in the UI)

Every container has a QR label (`APP_URL/s/<token>`; the token is random and carries no data). Open **Scan** and either point the camera at a label or upload a photo of one. After a scan the app shows the batch (tracking code, category, origin, containers, status) and the **next step permitted for your role**.

- **Sample labels:** the generic page **/demo-labels** still exists for the preloaded sample batches but is no longer linked; use the QR of the batch you created instead. Each synthetic batch there has a large label marked *Sample label · synthetic data · not real waste*. Show it full screen on a second device, or press **Print**. Scanning it resolves to that batch.
- **Camera unavailable** (no permission, no camera, or plain HTTP on a phone): the page explains why and offers the image-upload fallback and, in the sample organization, the batch-QR picker.
- **RFID/NFC and manual code entry** were removed from the UI. The backend endpoints and tables are untouched (`docs/HARDWARE.md`), and were never tested with hardware.

## 9. Deploying

Single container: `docker compose --profile full up -d --build` runs PostgreSQL + the app on port 4000. For a public deployment use any host that runs a Node container plus managed PostgreSQL (Render, Railway, Fly.io, a VPS…), put it behind HTTPS, set `COOKIE_SECURE=true`, `APP_URL=https://your-domain`, `DEMO_MODE=false` and real SMTP settings. This repository has **not** been deployed online; Docker files were written but could not be run in the build environment (see Known limitations).

## 10. Known limitations

- Not a regulatory compliance tool; default categories follow India's BMW Rules 2016 colour coding as an editable template only.
- RFID/NFC exist only as backend endpoints (no UI) and were never tested with hardware.
- Dates: all day-based filters and scheduling rules use the organization's timezone. Pickups may be set from 10 minutes ago to 90 days ahead; deadlines at most 30 days after pickup; disposal cannot precede receipt or be in the future; nothing before 2000. The API rejects violations with field errors.
- Demo mode is for demonstration: with `DEMO_MODE=true` anyone who can reach the server can open the demo org.
- Verified only in the Linux build sandbox (Chromium automation). Not verified: your Windows machine, Docker, a real phone camera/GPS, SMTP.
- GPS requires the transporter to keep the page open (browsers pause background location). A native app would be needed for background tracking.
- Live updates run in one API process (in-memory event bus). Multiple API instances would need PostgreSQL LISTEN/NOTIFY (see Architecture).
- `docker-compose.yml` / `Dockerfile` were not executed in the build environment (no Docker daemon there) — verify on your machine.
- `npm audit` reports a moderate advisory in `drizzle-kit`'s bundled esbuild; it is a development-only migration generator, not part of the running app.

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| API exits with “Failed to start. Is PostgreSQL running…” | `docker compose up -d db` (or start the PostgreSQL service) and check `DATABASE_URL` |
| `--env-file-if-exists` error | Node is older than 22.9 — upgrade Node |
| Port 5432/4000/5173 already in use | Stop the other program, or change `PORT` / the compose port mapping |
| Camera or GPS doesn't work on a phone | Use HTTPS (see section 7); allow permission in site settings |
| No reset / invite email arrives | SMTP not configured — the link is printed in the API terminal; invite links are also shown to the admin |
| Map is grey | No internet access to the tile server, or `VITE_MAP_TILE_URL` is wrong |
| Tests refuse to run | Set `TEST_DATABASE_URL` to a separate database (tests wipe it) |

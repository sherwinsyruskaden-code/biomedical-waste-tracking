# BWTS — Smart Biomedical Waste Tracking System

Track biomedical waste from the ward to final disposal: QR-labelled containers, a scanned chain of custody, live transport GPS, threshold alerts and audit-ready CSV/PDF reports. Built as an individual academic project, structured to grow into a real product.

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
npm run db:seed                    # OPTIONAL: demo organization with synthetic data
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

- **Create an account → Register an organization:** you become its **organization admin**. The organization starts **pending**: you can sign in and see its status, but nothing operational works until a **platform administrator** approves it. After approval, follow the dashboard checklist: add a treatment plant, invite hospital staff, plant staff and transporters, register the first batch.
- **Joining an organization (hospital staff, treatment-plant staff, transporters):** you never pick your own role. Your organization admin invites you (*Team → Invite*, a one-time link valid 7 days, with the role and facility already set). Open the link, or use *Already have an invitation? Accept invitation* and paste it. Without SMTP configured, the admin copies the link and sends it themselves.
- **Platform administrators** review registrations at `/platform`. The flag can only be granted on the server, never via sign-up or the API: create a normal account first, then run `npm run platform-admin -- reviewer@example.org` (`--revoke` to remove). Nobody can review an organization they belong to.
- **The waste journey:** hospital staff register a batch (category, quantity, ward, containers; no destination), verify segregation, then click **Request collection**. The destination is the organization's authorised treatment plant (*Settings → Organization → Collection destination*, or automatic when there is exactly one). A transporter is assigned automatically (the active one with the fewest open jobs) and must **accept**, scan at pickup, start the trip, and scan at the plant. Plant staff then **confirm receipt** and **record treatment/disposal**. The batch keeps one tracking code throughout, and its custody history shows every step with timestamps.
- **Who sees what:** hospital staff see only batches from their own hospital, plus the destination plant's name, address and contact. Plant staff see waste coming to their plant. Transporters see only their own collections, with origin and destination. Organization admins see their whole organization. These rules are enforced in the API queries, not just hidden in the UI.
- **One-click demo** (`DEMO_MODE=true`): the landing page and the *Sign in* page list six demo roles: Hospital staff (Hospital A), Hospital staff (Hospital B), Transporter, Treatment-plant staff, Organization administrator and Platform administrator. Each one signs in with that account's real permissions. The first click on a fresh database creates the demo data automatically, and an outdated demo is recreated automatically. Demo sessions last 4 hours and end when the browser closes. **Set `DEMO_MODE=false` on any public server.**
- **Demo data:** all of it is synthetic and labelled “(demo)”. Map positions are stored and shown as *simulated*. You can sign in normally with password `Demo-pass-2026`:

| Email | Role | Facility |
|---|---|---|
| staff@demo.bwts.local | Hospital staff | Sunrise General Hospital (Hospital A) |
| staff.b@demo.bwts.local | Hospital staff | Sunrise Women & Children Hospital (Hospital B) |
| driver@demo.bwts.local / driver2@demo.bwts.local | Transporter | Their own collections only |
| plant@demo.bwts.local | Treatment-plant staff | GreenCycle CBWTF |
| admin@demo.bwts.local | Organization admin | Sunrise Health Network (all three facilities) |
| platform@demo.bwts.local | Platform administrator | Review queue; no organization |
| lakeview@demo.bwts.local / coastal@demo.bwts.local | Applicants | Two **pending** demo organizations to approve or reject |

In the demo organization, the transporter's collection page also has a **Simulate QR scan (demo)** button. It runs the real pickup/handover with that batch's real QR label, so no second device is needed. The custody history records it as a *simulated QR scan*, never as a physical scan.

Recreate all demo data at any time with `npm run db:seed:reset`.

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
| `ALERT_JOB_INTERVAL_SECONDS` | How often alert thresholds are checked (default 60) |

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
| `npm run test:e2e:landing` / `:scan` / `:dates` / `:motion` | Browser regression suites: landing/signup/session, QR scanning, date pickers and timezones, reduced-motion |
| `node scripts/audit-api-calls.mjs` | Cross-checks every frontend API call against the backend routes (method + path) |
| `npm run db:migrate` | Apply migrations |
| `npm run db:generate --workspace apps/api` | Create a migration after editing `apps/api/src/db/schema.ts` |
| `npm run db:seed` / `npm run db:seed:reset` | Create / recreate the demo data (demo organization, platform reviewer, pending applicants) |
| `npm run platform-admin -- <email> [--revoke]` | Grant / revoke platform-administrator rights (server only) |

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

- **Demo labels:** open **/demo-labels** (also linked from the Scan page) while signed into the demo org. Each synthetic batch has a large label marked *Demo label · synthetic data · not real waste*. Show it full screen on a second device, or press **Print**. Scanning it resolves to that batch.
- **Camera unavailable** (no permission, no camera, or plain HTTP on a phone): the page explains why and offers the image-upload fallback and the demo-labels shortcut.
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

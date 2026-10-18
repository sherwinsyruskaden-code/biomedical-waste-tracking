# BWTS — Smart Biomedical Waste Tracking System

Track biomedical waste from the ward to final disposal: QR-labelled containers, a scanned chain of custody, live transport GPS, threshold alerts and audit-ready CSV/PDF reports. Built as an individual academic project, structured to grow into a real product.

**Stack:** React 19 + TypeScript + Vite + Tailwind · Node.js + Express 5 + TypeScript · PostgreSQL 16 + Drizzle ORM · Leaflet/OpenStreetMap · Server-sent events. No paid services required.

| | |
|---|---|
| Web app (dev) | http://localhost:5173 |
| API (dev) | http://localhost:4000 |
| API docs (OpenAPI) | http://localhost:4000/api/docs · raw: `/api/openapi.json` |
| Health check | http://localhost:4000/api/health |

More detail: [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Demo script](docs/DEMO.md) · [RFID/NFC hardware](docs/HARDWARE.md) · [Project report](FINAL_PROJECT_REPORT.md) · [Viva prep](VIVA_PREPARATION.md) · [Plan & checklist](IMPLEMENTATION_PLAN.md)

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

- **Your own organization:** click *Create organization* on the landing page. You become its **admin**. Follow the setup checklist on the dashboard: add a treatment facility, invite facility staff and a transporter, register the first batch.
- **Invitations:** *Team → Invite* creates a one-time link (valid 7 days). Without SMTP configured, copy the link and send it yourself.
- **Demo data:** after `npm run db:seed`, sign in as any of these (password `Demo-pass-2026`). Everything in the demo org is synthetic and labelled “(demo)”; its map positions are stored and shown as *simulated*.

| Email | Role |
|---|---|
| admin@demo.bwts.local | Admin |
| staff@demo.bwts.local | Facility staff (hospital + clinic) |
| plant@demo.bwts.local | Facility staff (treatment plant) |
| driver@demo.bwts.local / driver2@demo.bwts.local | Transporter |

Recreate the demo org at any time with `npm run db:seed:reset`.

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
| `DEMO_MODE` | `true` enables the admin-only, clearly labelled simulated-trip tool |
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
| `npm run db:migrate` | Apply migrations |
| `npm run db:generate --workspace apps/api` | Create a migration after editing `apps/api/src/db/schema.ts` |
| `npm run db:seed` / `npm run db:seed:reset` | Create / recreate the demo organization |

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

## 8. RFID / NFC

QR scanning works out of the box. RFID/NFC tags can be attached to containers and are resolved through the same API. USB/Bluetooth readers in **keyboard-wedge mode** work in the *RFID reader* scan tab; Web NFC works on Android Chrome. **Neither was tested with physical hardware in this project.** See [docs/HARDWARE.md](docs/HARDWARE.md).

## 9. Deploying

Single container: `docker compose --profile full up -d --build` runs PostgreSQL + the app on port 4000. For a public deployment use any host that runs a Node container plus managed PostgreSQL (Render, Railway, Fly.io, a VPS…), put it behind HTTPS, set `COOKIE_SECURE=true`, `APP_URL=https://your-domain`, `DEMO_MODE=false` and real SMTP settings. This repository has **not** been deployed online; Docker files were written but could not be run in the build environment (see Known limitations).

## 10. Known limitations

- Not a regulatory compliance tool; default categories follow India's BMW Rules 2016 colour coding as an editable template only.
- RFID/NFC hardware paths are implemented but untested on hardware.
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

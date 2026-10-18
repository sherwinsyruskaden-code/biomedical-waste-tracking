# Implementation plan & checklist

Legend: ✅ done and verified · ⚠️ done, verification limited (reason given) · ⬜ not done / future

## Phase 0 — Environment & repository
- ✅ Project folder, Git repository, npm workspaces (`apps/api`, `apps/web`)
- ✅ `.env.example` (placeholders only), `.gitignore`, README
- ✅ Identified external needs: SMTP (optional), map tiles (OSM, no key), routing (optional), RFID hardware (optional), HTTPS for phone camera/GPS

## Phase 1–2 — Product definition & stack
- ✅ Stack chosen and justified (docs/ARCHITECTURE.md); Redis/queues deliberately not used

## Phase 3 — Frontend
- ✅ Design system: tokens, Bricolage Grotesque + Instrument Sans (bundled), emerald/lime/cyan palette, reusable UI kit
- ✅ Landing, signup/login/reset, invitation acceptance, onboarding, dashboard, batch list/detail/create/edit, labels, scan, live map, jobs list/detail, receipt & disposal, reports, team, facilities & categories, alerts/incidents/notifications, settings (account, organization, thresholds, audit log), 404/error/empty/loading states
- ✅ Responsive layout (checked at 1440 px and 390 px), keyboard focus styles, reduced-motion support, skip link
- ⬜ Formal WCAG audit with assistive technology

## Phase 4–6 — Auth, organizations, roles, data model
- ✅ Signup creates user + organization + first facility + default categories; Argon2id; HTTP-only session cookie; logout invalidation; rate limiting; CSRF header + origin check
- ✅ Password reset (real SMTP when configured; console-mail mode otherwise)
- ⚠️ Real SMTP delivery not tested (no SMTP account in the build environment)
- ✅ Invitations (one-time link), multi-organization membership and switching, member role/status/facility management, last-admin protection
- ✅ Three roles with facility scoping; organization isolation (404 for foreign records)
- ✅ 22-table schema, migrations, FKs, CHECKs, partial unique indexes, append-only triggers, optimistic locking

## Phase 7–8 — Lifecycle & identification
- ✅ State machine with backend validation, transactions, idempotency keys, explanatory 422 errors, audit + admin alert for blocked attempts
- ✅ Assignments (multi-batch), accept/decline/start/cancel/reassign/remove batch, auto-complete
- ✅ Receipt (accept/reject, weight & condition incidents), disposal (category-allowed methods), reroute of rejected loads
- ✅ Incidents and resolution
- ✅ QR labels (opaque tokens, printable sheet), camera scanner, `/s/:token` deep link
- ⚠️ RFID (keyboard-wedge) and Web NFC scan paths + tag registry implemented; **not tested with hardware**
- ⬜ Fixed-reader gateway and API keys for devices

## Phase 9 — GPS & map
- ✅ Browser Geolocation, explicit start/stop, throttling, offline queue, wake lock, permission/unavailable handling
- ✅ Ingest validation, de-duplication, history, live SSE updates, stale detection, accuracy circles
- ✅ Demo-mode simulation stored and shown as *simulated*
- ⚠️ Tested with a browser's emulated geolocation, not a moving phone
- ⚠️ Planned route needs an OSRM server (`ROUTING_URL`); code path not exercised against a live router
- ⬜ Background tracking with the screen off (needs a native app)

## Phase 10 — Dashboard, alerts, reports
- ✅ Dashboard from live data (pipeline, trend, categories, facilities, attention panel, recent events)
- ✅ Alert job with configurable thresholds, de-duplication, auto-resolve, notifications (in-app + live)
- ✅ 7 report types, filters, CSV and PDF export, scoped by role/facility
- ⬜ Email notifications for alerts

## Phase 11–12 — Security & testing
- ✅ 29 API integration tests against real PostgreSQL (`npm test`)
- ✅ 16-step browser E2E acceptance test (`npm run test:e2e`), passing against dev server and production build
- ✅ Production build, type checks, migrations, restart persistence, backup/restore round trip
- ⚠️ `docker-compose.yml` and `Dockerfile` written but not executed (no Docker daemon in the build environment)

## Phase 13–14 — Delivery
- ✅ README, architecture, API reference (+ live OpenAPI at `/api/docs`), hardware notes, demo script, report, viva preparation
- ✅ Acceptance journey (see FINAL_PROJECT_REPORT.md §6)
- ⬜ Public deployment (not performed)

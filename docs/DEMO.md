# Live demonstration script (≈10 minutes)

Preparation: `docker compose up -d db`, `npm run db:seed:reset`, `npm run dev`. Open two browser windows (one normal, one private) or a laptop + phone.

1. **Landing page** (http://localhost:5173) — tap through the custody rail: what is recorded at each stage and by whom.
2. **Sign in as admin** (`admin@demo.bwts.local` / `Demo-pass-2026`). Dashboard: the pipeline shows real counts per stage; open *Needs attention* (an overdue collection alert from a 30-hour-old batch).
3. **Register waste as staff** (private window: `staff@demo.bwts.local`). *Register batch* → choose Yellow, 12 kg, 2 containers → labels page with two QR codes. Show that the QR contains only a random link.
4. **Scan** the label from a second device (or *Scan → Type it*, paste the link). Verify segregation from the scan result.
5. **Admin creates a job**: *Transport jobs → New job*, pick the new batch, Ravi Kumar, the CBWTF.
6. **Transporter** (`driver@demo.bwts.local`): open the job → *Accept* → *Scan pickup* → *Start sharing* (allow location) → *Start trip*.
   - On a real phone over HTTPS, positions arrive every 15 s while moving. Without a phone, as admin use **Demo mode → Run simulated trip** — the marker is amber and tagged SIMULATED.
7. **Live map** as admin: select the job; show last-fix time, accuracy, stale warning, recorded path. Explain planned route vs recorded path.
8. **Handover** as transporter (*Scan handover*). The job completes and location sharing stops automatically.
9. **Receipt & disposal** as plant staff (`plant@demo.bwts.local`): *Confirm receipt* (enter 11.2 kg to show the weight-tolerance incident), then *Record disposal* — only methods configured for the category are offered.
10. **Batch detail**: the complete, read-only chain of custody with who/when/where/how it was scanned.
11. **Reports**: Batch register → download CSV and PDF.
12. **Security**: try opening the batch URL while signed into a different organization → 404. Mention the database trigger that refuses edits to custody history.

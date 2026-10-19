# Live demonstration script (≈10 minutes)

Preparation: `docker compose up -d db`, then `npm run db:seed:reset` (optional, because the first demo click also creates the data), then `npm run dev`. Open http://localhost:5173. Each demo button signs in with that role's real permissions. Use a second browser window (or a private one) to stay signed in as two roles at once. All data is synthetic.

1. **Landing page:** *Create an account*, *Already have an invitation? Accept invitation*, and the six **Try it as any role** buttons.
2. **Hospital A staff** (*Hospital staff — Hospital A*): the sidebar shows the hospital name, and the navigation is small (no Team or Live map). *Waste batches* lists only Hospital A's batches. *My facility* shows Hospital A in full and the treatment plant in outline only.
3. **Register waste:** *Register batch*, then Yellow, 12 kg, 2 containers, Ward 3. No destination is asked for. The labels page shows two QR codes.
4. **Segregate and request collection:** on the batch page, *Verify segregation*, then **Request collection**. The dialog shows Origin = Hospital A, Destination = GreenCycle CBWTF, and that a transporter will be assigned. The history shows *Collection requested — transporter assigned*.
5. **Hospital B staff:** sign in with *Hospital staff — Hospital B*. None of Hospital A's batches are visible; opening one by URL gives "not found".
6. **Transporter:** *My collections* lists the waiting request from Hospital B (Origin → Destination). Open it, click *Accept request*, then **Simulate QR scan (demo)** (pickup), *Start trip*, and **Simulate QR scan (demo)** again (handover). For a real scan instead, show a label from *Demo QR labels* on another screen and use *Scan pickup*. The batch history marks simulated scans as *Simulated QR scan (demo)*.
7. **Treatment-plant staff:** *Incoming & disposal*, then *Confirm receipt* (try 11.2 kg on a 12 kg batch to raise a weight-tolerance incident), then *Record disposal*. Only treatment methods allowed for the category are offered.
8. **Journey history:** open the batch as Hospital B staff. The custody history shows every step from registration to disposal with timestamps, under the same tracking code.
9. **Organization admin:** dashboard, live map (a simulated trip is under way), *Transport jobs*, *Facilities & categories*, *Team*, *Settings → Collection destination*, reports with CSV/PDF export.
10. **Platform administrator:** *Organization registrations* lists two pending demo applicants with applicant and facility details. Approve one and reject the other (a reason is required). Rejection keeps the organization and its audit history.
11. **New organization:** *Create an account → Register an organization*. After submitting, the app shows *Waiting for approval*, and operational pages are blocked. Approve it as the platform administrator, then click *Check status again*.

Reset everything for the next run: `npm run db:seed:reset`.

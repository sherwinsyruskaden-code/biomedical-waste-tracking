# Walkthrough script (≈10 minutes)

Preparation: `docker compose up -d db`, then (throwaway/test database only) `npm run db:seed:reset`, then `npm run dev`. Open http://localhost:5173. Use a second (private) browser window to stay signed in as two roles at once. All data is synthetic; preloaded batches have codes starting `SMP-`, yours start `BW-` and are listed first.

1. **Landing page:** *Create an account*, *Already have an invitation? Accept invitation*, the role selector (Hospital Staff, Transporter, Treatment Plant Staff, Main Admin) and the five role cards.
2. **Hospital Staff → Hospital A:** register a batch (origin is automatic, quantity is numeric, no destination, no notes). **Its QR code appears immediately.** Click **Present full screen** to show it on the laptop, or **Print QR Label**.
3. **Segregate and request collection:** on the batch page (use **View QR Code** to reopen the same QR), *Verify segregation*, then **Request collection**. Choose a transporter from the list of **available** ones (Ravi Kumar and Latha Nair; Suresh Babu is on the road with an active order, so he is not offered). The destination is the treatment plant.
4. **Hospital Staff → Hospital B** (other window): Hospital A's batch is not visible.
5. **Transporter** (the sample transporter is Ravi Kumar): *My collections* shows the request. *Accept request*, then scan the batch's QR at pickup: point the camera at the presented QR, use *Scan a photo or screenshot*, or choose your batch in **Use a batch's QR** (simulated, clearly marked). *Start trip*, then **Mark arrived at treatment plant** (no scan on arrival). The batch shows **Arrived — awaiting receipt**. To show a rejection instead, click **Decline** before accepting: the hospital gets a notification, the batch shows *Declined*, and you can request it again from another transporter.
6. **Treatment Plant Staff:** the dashboard's **Arrived — awaiting receipt** panel lists it with tracking code, origin hospital, transporter and time. Click **Scan Incoming Batch** and scan the batch's QR (camera, photo, or the labelled simulated picker), then **Confirm receipt** and record the treatment. Plant staff never see batches that are only requested or not yet accepted.
7. **History:** the batch page lists every step with time and person under the same tracking code, and simulated scans are labelled.
8. **Main Admin:** facilities, team, settings, reports, and **Organization approvals** (approve one pending sample organization, reject the other with a reason).

Reset a throwaway database for the next run: `npm run db:seed:reset` (**deletes the sample organization and everything in it**).

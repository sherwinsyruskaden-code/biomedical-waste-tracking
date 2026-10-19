/**
 * End-to-end acceptance test: drives the real UI in a headless browser against the running
 * API + web app (start both first: `npm run dev:api` and `npm run dev:web`).
 *
 *   npm run test:e2e                         # uses http://localhost:5173
 *   $env:E2E_BASE_URL="http://localhost:4000"; npm run test:e2e   # against the production build
 *
 * Browser: set CHROME_PATH to a Chrome/Edge executable, or run `npx playwright install chromium` once.
 * GPS: the browser context is granted geolocation and given fixed coordinates, so the real
 * Geolocation API → upload → map path is exercised. (A real moving phone is still a manual test.)
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";

/** Writes the label's QR code to a PNG, as a printed label photographed or screenshotted would look. */
const qrImage = async (payload) => {
  const file = join(tmpdir(), `bwts-e2e-label-${Date.now().toString(36)}.png`);
  await QRCode.toFile(file, payload, { scale: 8, margin: 4 });
  return file;
};

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const PASSWORD = "E2e-Passw0rd-123";
const run = Date.now().toString(36);
const shotsDir = new URL("./screenshots/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
mkdirSync(shotsDir, { recursive: true });

async function browserPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch {}
  try {
    const spart = (await import("@sparticuz/chromium")).default;
    return { path: await spart.executablePath(), args: spart.args };
  } catch {}
  for (const p of [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ])
    if (existsSync(p)) return p;
  throw new Error("No browser found. Set CHROME_PATH or run `npx playwright install chromium`.");
}

let step = 0;
const results = [];
async function check(name, fn) {
  step++;
  const t = Date.now();
  try {
    await fn();
    results.push({ ok: true, name });
    console.log(`  ✓ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ ok: false, name });
    console.log(`  ✗ ${name}\n      ${String(e.message ?? e).split("\n").slice(0, 4).join("\n      ")}`);
    throw e;
  }
}

const bp = await browserPath();
// One browser process per user keeps every session completely separate.
const browsers = [];
const launch = async () => {
  const b = await chromium.launch({ executablePath: typeof bp === "string" ? bp : bp.path, args: typeof bp === "string" ? [] : bp.args, headless: true });
  browsers.push(b);
  return b;
};
const HOSPITAL = { latitude: 12.9249, longitude: 80.1275 };
const ctxOpts = { viewport: { width: 1360, height: 900 }, baseURL: BASE, permissions: ["geolocation"], geolocation: HOSPITAL };

const newUser = async () => {
  const ctx = await (await launch()).newContext(ctxOpts);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  return { ctx, page };
};
// API calls are made from inside the page so they use the browser's own session cookie.
const api = (page) => ({
  get: (url) => page.evaluate(async (u) => (await fetch(u)).json(), url),
  status: (url) => page.evaluate(async (u) => (await fetch(u)).status, url),
  post: (url, data) => page.evaluate(async ([u, d]) => (await fetch(u, { method: "POST", headers: { "content-type": "application/json", "x-bwts-csrf": "1" }, body: JSON.stringify(d) })).status, [url, data]),
});

/** Waits for a success toast; on failure reports what the dialog is showing instead. */
async function expectToast(page, text, dialog) {
  try {
    await page.getByText(text, { exact: true }).first().waitFor({ timeout: 15000 });
  } catch (e) {
    const shown = dialog ? await dialog.innerText().catch(() => "(dialog closed)") : "";
    throw new Error(`No "${text}" confirmation. Dialog shows: ${shown.slice(0, 300)}`);
  }
}

async function acceptInvite(link, name) {
  const u = await newUser();
  await u.page.goto(new URL(link).pathname);
  await u.page.getByLabel("Full name").fill(name);
  await u.page.getByLabel("Create a password").fill(PASSWORD);
  await u.page.getByRole("checkbox").check();
  await u.page.getByRole("button", { name: "Accept invitation" }).click();
  await u.page.waitForURL("**/dashboard");
  return u;
}

console.log(`\nBWTS end-to-end acceptance — ${BASE}\n`);
const adminEmail = `admin-${run}@e2e.test`;
const admin = await newUser();
let staff, plant, driver, platform, batchId, labelPayload, assignmentId, staffEmail;
const orgName = `E2E Hospital ${run}`;

try {
  await check("1. A new user registers an organization (it starts pending, with no operational access)", async () => {
    await admin.page.goto("/signup");
    await admin.page.getByLabel("Full name").fill("Esha E2E Admin");
    await admin.page.getByLabel("Work email").fill(adminEmail);
    await admin.page.getByLabel(/^Password/).fill(PASSWORD);
    await admin.page.getByLabel("Confirm password").fill(PASSWORD);
    await admin.page.getByLabel("Organization name").fill(orgName);
    await admin.page.getByLabel("Facility name").fill("E2E General Hospital");
    await admin.page.getByLabel("Address").fill("1 Test Road, Tambaram");
    await admin.page.getByLabel("Latitude").fill(String(HOSPITAL.latitude));
    await admin.page.getByLabel("Longitude").fill(String(HOSPITAL.longitude));
    await admin.page.getByRole("checkbox", { name: /terms/ }).check();
    await admin.page.getByRole("button", { name: "Register organization" }).click();
    await admin.page.waitForURL("**/dashboard**");
    await admin.page.getByTestId("pending-approval").waitFor();
    assert.equal(await api(admin.page).status("/api/batches"), 403);
  });

  await check("1b. A platform administrator reviews the registration and approves it", async () => {
    platform = await newUser();
    await platform.page.goto("/");
    await platform.page.locator('[data-demo="platform"]').click();
    await platform.page.waitForURL("**/platform", { timeout: 90000 });
    const card = platform.page.getByTestId("org-review").filter({ hasText: orgName });
    await card.getByText(adminEmail).first().waitFor();
    await card.getByRole("button", { name: "Approve" }).click();
    await platform.page.getByRole("dialog").getByRole("button", { name: "Approve organization" }).click();
    await platform.page.getByText(`${orgName} approved`).waitFor();
    await admin.page.getByRole("button", { name: "Check status again" }).click();
    await admin.page.getByText("Finish setting up").waitFor();
  });

  await check("2. Admin adds an authorised treatment facility", async () => {
    await admin.page.goto("/facilities");
    await admin.page.getByRole("button", { name: "Add facility" }).first().click();
    const d = admin.page.getByRole("dialog");
    await d.getByLabel("Facility name").fill("E2E Treatment Plant");
    await d.getByLabel("Facility type").selectOption("treatment");
    await d.getByLabel("Address").fill("Plot 9, SIPCOT");
    await d.getByLabel("Latitude").fill("12.9716");
    await d.getByLabel("Longitude").fill("79.9864");
    await d.getByRole("button", { name: "Add facility" }).click();
    await admin.page.getByText("E2E Treatment Plant").waitFor();
  });

  const invite = async (email, role, facility) => {
    await admin.page.goto("/team");
    await admin.page.getByRole("button", { name: "Invite" }).click();
    const d = admin.page.getByRole("dialog");
    await d.getByLabel("Email").fill(email);
    await d.getByLabel("Role").selectOption(role);
    if (facility) await d.getByRole("checkbox", { name: new RegExp(facility) }).check();
    await d.getByRole("button", { name: "Create invitation" }).click();
    const link = await d.getByLabel("Invitation link").inputValue();
    await d.getByRole("button", { name: "Done" }).click();
    return link;
  };

  await check("3. Admin invites facility staff (hospital), plant staff and a transporter; they join", async () => {
    staffEmail = `staff-${run}@e2e.test`;
    const l1 = await invite(staffEmail, "facility_staff", "E2E General Hospital");
    const l2 = await invite(`plant-${run}@e2e.test`, "facility_staff", "E2E Treatment Plant");
    const l3 = await invite(`driver-${run}@e2e.test`, "transporter");
    staff = await acceptInvite(l1, "Sam Staff");
    plant = await acceptInvite(l2, "Priya Plant");
    driver = await acceptInvite(l3, "Dev Driver");
    const me = await api(driver.page).get("/api/auth/me");
    if (!me.membership) throw new Error("me: " + JSON.stringify(me).slice(0, 200));
    assert.equal(me.membership.role, "transporter");
  });

  await check("4–5. Facility staff register a waste batch and get QR labels", async () => {
    const p = staff.page;
    await p.goto("/batches/new");
    await p.getByRole("radio", { name: /Yellow/ }).check({ force: true });
    await p.getByLabel("Quantity").fill("14.5");
    await p.getByLabel("Number of containers").fill("2");
    await p.getByLabel("Ward / department").fill("Ward 7");
    await p.getByRole("button", { name: "Register & create labels" }).click();
    await p.waitForURL(/\/batches\/[0-9a-f-]+\/labels/);
    batchId = p.url().split("/batches/")[1].split("/")[0];
    await p.getByRole("img", { name: /QR code for/ }).first().waitFor();
    const labels = await api(p).get(`/api/batches/${batchId}/labels`);
    assert.equal(labels.labels.length, 2);
    labelPayload = labels.labels[0].payload;
    await p.screenshot({ path: shotsDir + "labels.png" });
  });

  await check("6. Scanning the QR label (read from an image of it) finds the right batch", async () => {
    const p = staff.page;
    await p.goto("/scan");
    await p.getByTestId("scanner-image-input").setInputFiles(await qrImage(labelPayload));
    await p.getByText("Label recognised").waitFor();
    assert.match(await p.locator("a[href^='/batches/']").first().getAttribute("href"), new RegExp(batchId));
  });

  await check("7. Staff verify segregation", async () => {
    const p = staff.page;
    await p.getByRole("button", { name: "Verify segregation" }).click();
    const d = p.getByRole("dialog");
    await d.getByRole("checkbox").first().check();
    await d.getByRole("button", { name: "Verify segregation" }).click();
    await p.getByText("Segregation verified").first().waitFor();
  });

  await check("8a. Hospital staff request collection; it goes to the treatment plant and a transporter", async () => {
    const p = staff.page;
    await p.goto(`/batches/${batchId}`);
    await p.getByTestId("request-collection").getByText("E2E Treatment Plant").waitFor();
    await p.getByRole("button", { name: "Request collection" }).click();
    const d = p.getByRole("dialog");
    await d.getByText("E2E Treatment Plant", { exact: true }).waitFor();
    await d.getByRole("button", { name: "Send request" }).click();
    await p.getByText("Collection requested — transporter assigned").first().waitFor();
    const b = await api(p).get(`/api/batches/${batchId}`);
    assert.equal(b.destination.name, "E2E Treatment Plant");
    assert.equal(b.currentAssignment.transporterName, "Dev Driver");
    assignmentId = b.currentAssignment.id;
  });

  await check("8b. Transporter accepts and takes custody by scanning at pickup", async () => {
    const p = driver.page;
    await p.goto(`/assignments/${assignmentId}`);
    await p.getByTestId("route").getByText("E2E General Hospital").waitFor();
    await p.getByTestId("route").getByText("E2E Treatment Plant").waitFor();
    await p.getByRole("button", { name: "Accept request" }).click();
    await p.getByRole("button", { name: "Scan pickup" }).click();
    const d = p.getByRole("dialog");
    await d.getByTestId("scanner-image-input").setInputFiles(await qrImage(labelPayload));
    await d.getByText("QR label captured").waitFor();
    await d.getByRole("button", { name: "Confirm pickup" }).click();
    await p.getByText("Collected").first().waitFor();
  });

  await check("9. Transporter shares GPS and starts the trip; the backend stores the device positions", async () => {
    const p = driver.page;
    await p.getByRole("button", { name: "Start sharing" }).click();
    await p.getByText("Receiving fixes").waitFor();
    await p.getByRole("button", { name: "Start trip" }).click();
    await p.getByText("On the road").first().waitFor();
    await driver.ctx.setGeolocation({ latitude: 12.95, longitude: 80.05 });
    await p.waitForTimeout(16000); // throttled to one stored fix per 15 s when stationary
    const pts = await api(admin.page).get(`/api/assignments/${assignmentId}/locations`);
    assert.ok(pts.length >= 1, "expected at least one stored location point");
    assert.equal(pts[0].source, "device");
  });

  await check("10. Admin's live map shows the latest position and how old it is", async () => {
    const p = admin.page;
    await p.goto("/tracking");
    await p.getByRole("button", { name: /TR-/ }).first().click();
    await p.getByText("Last fix", { exact: true }).waitFor();
    const live = await api(p).get("/api/tracking/live");
    const row = live.assignments.find((a) => a.id === assignmentId);
    assert.ok(row.latestPoint, "live endpoint returns the latest point");
    assert.ok(Date.now() - new Date(row.latestPoint.recordedAt).getTime() < 120000);
    await p.screenshot({ path: shotsDir + "tracking.png" });
  });

  await check("11. Transporter hands over at the destination (scan); job completes and sharing stops", async () => {
    const p = driver.page;
    await p.getByRole("button", { name: "Scan handover" }).click();
    const d = p.getByRole("dialog");
    await d.getByTestId("scanner-image-input").setInputFiles(await qrImage(labelPayload));
    await d.getByText("QR label captured").waitFor();
    await d.getByRole("button", { name: "Hand over at destination" }).click();
    await p.getByText("Completed").first().waitFor();
    const a = await api(p).get(`/api/assignments/${assignmentId}`);
    assert.equal(a.trackingActive, false);
  });

  await check("12. Plant staff confirm receipt and record disposal", async () => {
    const p = plant.page;
    await p.goto("/receiving");
    await p.getByRole("button", { name: "Confirm receipt" }).first().click();
    let d = p.getByRole("dialog");
    await d.getByLabel("Weighed quantity").fill("14.4");
    await d.getByRole("button", { name: "Confirm receipt" }).click();
    await expectToast(p, "Receipt recorded", d);
    await p.goto("/receiving?tab=received");
    await p.getByRole("button", { name: "Record disposal" }).first().click();
    d = p.getByRole("dialog");
    await d.getByLabel("Plant log / document reference").fill(`E2E-${run}`);
    await d.getByRole("button", { name: "Record disposal" }).click();
    await expectToast(p, "Disposal recorded", d);
  });

  await check("13. The complete lifecycle history is shown on the batch", async () => {
    const p = admin.page;
    await p.goto(`/batches/${batchId}`);
    for (const t of ["Batch registered", "Segregation verified", "Collection requested — transporter assigned", "Picked up — custody to transporter", "Trip started", "Handed over at destination", "Receipt confirmed", "Disposal recorded"]) await p.getByText(t, { exact: true }).first().waitFor();
    await p.screenshot({ path: shotsDir + "batch-detail.png", fullPage: true });
  });

  await check("14. Dashboard statistics reflect the disposal and reports export as CSV and PDF", async () => {
    const p = admin.page;
    const dash = await api(p).get("/api/dashboard");
    assert.equal(dash.kpis.disposedLast30Days, 1);
    await p.goto("/reports");
    const [csv] = await Promise.all([p.waitForEvent("download"), p.getByRole("link", { name: "CSV" }).click()]);
    assert.match(csv.suggestedFilename(), /\.csv$/);
    const [pdf] = await Promise.all([p.waitForEvent("download"), p.getByRole("link", { name: "PDF" }).click()]);
    assert.match(pdf.suggestedFilename(), /\.pdf$/);
  });

  await check("15. Another organization cannot open this batch", async () => {
    const other = await newUser();
    await other.page.goto("/");
    const r = await api(other.page).post("/api/auth/signup", { fullName: "Other Admin", email: `other-${run}@e2e.test`, password: PASSWORD, confirmPassword: PASSWORD, organization: { name: `Other Org ${run}`, type: "clinic" }, acceptTerms: true });
    assert.equal(r, 201);
    const otherOrg = (await api(other.page).get("/api/auth/me")).organization.id;
    assert.equal(await api(platform.page).post(`/api/platform/organizations/${otherOrg}/approve`, {}), 200);
    assert.equal(await api(other.page).status(`/api/batches/${batchId}`), 404);
    await other.page.goto(`/batches/${batchId}`);
    await other.page.getByText("Batch not found").waitFor();
    await other.ctx.close();
  });

  await check("16. Records survive sign-out and sign-in", async () => {
    const p = staff.page;
    await p.goto("/dashboard");
    await p.getByRole("button", { name: "Account menu" }).click();
    await p.getByRole("menuitem", { name: "Sign out" }).click();
    await p.waitForURL("**/login");
    await p.getByLabel("Work email").fill(staffEmail);
    await p.getByLabel("Password").fill(PASSWORD);
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.waitForURL("**/dashboard");
    await p.goto(`/batches/${batchId}`);
    await p.getByText("Disposed").first().waitFor();
  });
} catch {
  // failure already reported
} finally {
  await Promise.all(browsers.map((b) => b.close()));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} steps passed${failed ? " — FAILED" : ""}. Screenshots: ${shotsDir}\n`);
  process.exitCode = failed || results.length < 17 ? 1 : 0;
}

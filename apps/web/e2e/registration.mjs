/**
 * Browser checks for: organization registration (Hospital/Lab, Facility Registration ID, no invitations needed), the
 * approvals panel, show/hide password on every password form, the invitee "Name" label, and a declined collection
 * (notification + visible Declined status + request again). Needs the server running with DEMO_MODE=true.
 *   E2E_BASE_URL=http://localhost:4000 npm run test:e2e:registration
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";
async function browserPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try { const p = chromium.executablePath(); if (p && existsSync(p)) return p; } catch {}
  for (const p of ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]) if (existsSync(p)) return p;
  throw new Error("No browser found. Set CHROME_PATH or run `npx playwright install chromium` once.");
}
const browser = await chromium.launch({ executablePath: await browserPath(), headless: true });
const fresh = async () => {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 }, baseURL: BASE })).newPage();
  page.setDefaultTimeout(30000);
  return page;
};
const open = async (group, key) => {
  const page = await fresh();
  await page.goto("/");
  if (group) await page.locator(`[data-demo="${group}"]`).click();
  await page.locator(`[data-demo="${key}"]`).click();
  await page.waitForURL("**/dashboard", { timeout: 90000 });
  return page;
};
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n      ${String(e.message ?? e).split("\n").slice(0, 6).join("\n      ")}`); }
}
const run = Date.now().toString(36);
const PASSWORD = "Reg-test-1234";

/** Show/hide works with the mouse and the keyboard, keeps the typed value, and starts masked. */
async function assertToggle(page, input, name) {
  const btn = page.getByRole("button", { name });
  await input.fill("Secr3t-value");
  assert.equal(await input.getAttribute("type"), "password", `${name}: not masked by default`);
  await btn.click();
  assert.equal(await input.getAttribute("type"), "text", `${name}: not revealed`);
  assert.equal(await input.inputValue(), "Secr3t-value", `${name}: value changed`);
  assert.equal(await page.getByRole("button", { name: name.replace("Show", "Hide") }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: name.replace("Show", "Hide") }).click();
  assert.equal(await input.getAttribute("type"), "password", `${name}: not masked again`);
  assert.equal(await input.inputValue(), "Secr3t-value");
  await btn.focus();
  await page.keyboard.press("Space"); // keyboard operable
  assert.equal(await input.getAttribute("type"), "text", `${name}: keyboard`);
  await page.keyboard.press("Space");
  assert.equal(await input.getAttribute("type"), "password");
}

console.log("Registration form");
const reg = await fresh();
await check("the facility type has only Hospital and Lab, and the Facility Registration ID is required", async () => {
  await reg.goto("/signup");
  await reg.getByLabel("Facility type").locator("option").nth(1).waitFor({ state: "attached" });
  const options = await reg.getByLabel("Facility type").locator("option").allInnerTexts();
  assert.deepEqual(options, ["Hospital", "Lab"]);
  assert.equal(await reg.getByLabel("Facility Registration ID").count(), 1);
  assert.equal(await reg.getByText("Add my first facility now").count(), 0, "the facility is no longer optional");
  assert.equal(await reg.getByText(/invite/i).filter({ hasText: /must|required|transporter/i }).count(), 0, "registration mentions required invitations");
});
await check("show/hide password works on the login, sign-up and reset forms", async () => {
  await reg.goto("/signup");
  await assertToggle(reg, reg.getByLabel(/^Password/).first(), "Show password");
  await assertToggle(reg, reg.getByLabel(/^Confirm password/), "Show confirm password");
  const login = await fresh();
  await login.goto("/login");
  await assertToggle(login, login.getByLabel("Password", { exact: true }), "Show password");
  const reset = await fresh();
  await reset.goto("/reset-password?token=abcdefghijklmnopqrstuvwxyz0123456789");
  await assertToggle(reset, reset.getByLabel(/^New password/), "Show password");
  await assertToggle(reset, reset.getByLabel(/^Confirm password/), "Show confirm password");
});

console.log("Register an organization without inviting anyone, then review it");
const email = `Admin.${run}@Gmail.com`;
const orgName = `Lab Org ${run}`;
const regId = `LAB/${run.toUpperCase()}-77`;
await check("a Lab registers with its own registration ID and address; no transporter or staff is required", async () => {
  await reg.goto("/signup");
  await reg.getByLabel("Full name").fill("Dr. Meera Krishnan");
  await reg.getByLabel("Work email").fill(email);
  await reg.getByLabel(/^Password/).first().fill(PASSWORD);
  await reg.getByLabel(/^Confirm password/).fill(PASSWORD);
  await reg.getByLabel("Organization name").fill(orgName);
  await reg.getByLabel("Facility type").selectOption("lab");
  await reg.getByLabel("Facility name").fill(`Krishna Lab ${run}`);
  await reg.getByLabel("Facility Registration ID").fill(regId);
  await reg.getByLabel("Address").fill("7 Gandhi Road, T. Nagar");
  await reg.getByLabel("City").fill("Chennai");
  await reg.getByLabel("State").fill("Tamil Nadu");
  await reg.getByLabel("Postal code").fill("600017");
  await reg.getByLabel("Contact phone").fill("+91 98765 43210");
  await reg.getByRole("checkbox", { name: /terms/ }).check();
  await reg.getByRole("button", { name: "Register organization" }).click();
  await reg.waitForURL("**/dashboard**");
  await reg.getByTestId("pending-approval").waitFor();
});
await check("the Main Admin's approvals panel shows exactly what was submitted, and it can be found by registration ID", async () => {
  const admin = await open(null, "admin");
  await admin.getByRole("link", { name: /Organization approvals/ }).click();
  await admin.waitForURL("**/approvals");
  await admin.getByLabel("Search registrations").fill(regId);
  const card = admin.getByTestId("org-review");
  await admin.waitForFunction(() => document.querySelectorAll('[data-testid="org-review"]').length === 1); // the search has narrowed the queue
  assert.equal(await card.count(), 1, "search did not narrow the queue");
  assert.equal((await card.getByTestId("review-org-name").innerText()).trim(), orgName);
  assert.equal((await card.getByTestId("review-admin-name").innerText()).trim(), "Dr. Meera Krishnan");
  assert.equal((await card.getByTestId("review-admin-email").innerText()).trim(), email.toLowerCase());
  assert.equal((await card.getByTestId("review-registration-id").innerText()).trim(), regId);
  const text = await card.innerText();
  for (const expected of ["Lab", `Krishna Lab ${run}`, "7 Gandhi Road, T. Nagar", "Chennai, Tamil Nadu, 600017", "+91 98765 43210", "Pending", "has not been verified"]) assert.ok(text.includes(expected), `panel is missing "${expected}"`);
  const facilityText = await card.getByTestId("review-facility").innerText();
  assert.ok(!facilityText.includes("Not provided"), "a submitted facility field is shown as 'Not provided'");
  assert.ok(text.includes("Not provided"), "the administrator's phone was never collected and must not be invented"); // honest, not fabricated
  await admin.getByLabel("Search registrations").fill("NO-SUCH-ID-123");
  await admin.getByText("No registration matches your search").waitFor();
  await admin.getByLabel("Search registrations").fill(regId);
  await card.waitFor();
  await card.getByRole("button", { name: `Approve ${orgName}` }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Approve organization" }).click();
  await admin.getByText(`${orgName} approved`).waitFor();
});
await check("after approval the administrator works with no team: no invitation steps are asked for", async () => {
  await reg.getByRole("button", { name: "Check status again" }).click();
  await reg.getByText("Finish setting up").waitFor();
  const text = await reg.locator("main").innerText();
  assert.ok(!/Invite facility staff|Invite a transporter/.test(text), "the checklist still asks for invitations");
  await reg.goto("/team");
  await reg.getByRole("button", { name: "Invite" }).click();
  const d = reg.getByRole("dialog");
  await d.getByLabel("Name", { exact: true }).waitFor();
  assert.equal(await d.getByText("(optional)").count(), 0, "the invitee name still says (optional)");
});
await check("show/hide password works on the invitation and password-change forms", async () => {
  const d = reg.getByRole("dialog");
  await d.getByLabel("Email").fill(`staff-${run}@example.org`);
  await d.getByLabel("Role").selectOption("transporter"); // needs no facility
  await d.getByRole("button", { name: "Create invitation" }).click();
  const link = await d.getByLabel("Invitation link").inputValue();
  const inv = await fresh();
  await inv.goto(new URL(link).pathname);
  await assertToggle(inv, inv.getByLabel("Create a password"), "Show password");
  await reg.goto("/settings?tab=account");
  await assertToggle(reg, reg.getByLabel(/^Current password/), "Show current password");
  await assertToggle(reg, reg.getByLabel(/^New password/), "Show new password");
});

console.log("My facility is gone");
const hospital = await open("hospital", "staff");
await check("hospital staff have no My facility page, link or disclaimer text", async () => {
  const nav = await hospital.getByRole("navigation", { name: "Main" }).first().innerText();
  assert.ok(!nav.includes("My facility"));
  await hospital.goto("/facilities");
  await hospital.waitForURL("**/dashboard");
  assert.equal(await hospital.getByText("Records support traceability. They are not a regulatory certificate.").count(), 0);
});

console.log("A declined collection");
const state = {};
await check("hospital staff request collection from an available transporter", async () => {
  await hospital.goto("/batches?status=segregated");
  const ready = await hospital.evaluate(async () => (await (await fetch("/api/batches?status=segregated&pageSize=50")).json()).items.find((x) => !x.currentAssignmentId));
  assert.ok(ready, "no ready batch in the sample data (run db:seed:reset on a throwaway database)");
  state.id = ready.id;
  state.code = ready.trackingCode;
  await hospital.goto(`/batches/${state.id}`);
  await hospital.getByRole("button", { name: "Request collection" }).click();
  const d = hospital.getByRole("dialog");
  await d.getByLabel("Assign transporter").locator("option").nth(1).waitFor({ state: "attached" });
  const options = await d.getByLabel("Assign transporter").locator("option").allInnerTexts();
  assert.ok(options.some((o) => o.includes("Ravi Kumar")) && !options.some((o) => o.includes("Suresh Babu")), options.join(" | "));
  await d.getByLabel("Assign transporter").selectOption({ label: options.find((o) => o.includes("Ravi Kumar")) });
  await d.getByRole("button", { name: "Send request" }).click();
  await hospital.getByText("Collection requested — transporter assigned").first().waitFor();
  state.assignment = await hospital.evaluate(async (i) => (await (await fetch(`/api/batches/${i}`)).json()).currentAssignment.id, state.id);
});
await check("the transporter declines; the hospital sees a notification and Declined (not Sent/Pending)", async () => {
  const ravi = await open(null, "driver");
  await ravi.goto(`/assignments/${state.assignment}`);
  await ravi.getByRole("button", { name: "Decline", exact: true }).click();
  const d = ravi.getByRole("dialog");
  await d.getByLabel("Reason").fill("Vehicle breakdown");
  await d.getByRole("button", { name: "Decline job" }).click();
  await ravi.getByTestId("declined-banner").waitFor();
  assert.equal(await ravi.getByRole("button", { name: "Accept request" }).count(), 0, "the declined order can still be accepted");
  // the hospital: notification (persisted), assignments screen, batch page
  await hospital.goto("/notifications");
  const note = hospital.getByText(`Collection declined: ${state.code}`).first();
  await note.waitFor();
  const body = await hospital.locator("main").innerText();
  assert.match(body, /Ravi Kumar/);
  assert.match(body, /Vehicle breakdown/);
  assert.match(body, /request collection again/i);
  await hospital.goto("/assignments?status=");
  await hospital.getByTestId("declined-note").first().waitFor();
  await hospital.goto("/assignments?status=assigned,accepted,in_progress");
  await hospital.waitForLoadState("networkidle");
  assert.equal(await hospital.locator(`a[href="/assignments/${state.assignment}"]`).count(), 0, "the declined request is still listed as active");
  await hospital.goto(`/batches/${state.id}`);
  await hospital.getByTestId("declined-collection").waitFor();
  await hospital.getByRole("button", { name: "Request collection" }).waitFor();
});
await check("the same batch can be sent again to an available transporter, and the declined record stays in the history", async () => {
  await hospital.getByRole("button", { name: "Request collection" }).click();
  const d = hospital.getByRole("dialog");
  await d.getByLabel("Assign transporter").locator("option").nth(1).waitFor({ state: "attached" });
  const options = await d.getByLabel("Assign transporter").locator("option").allInnerTexts();
  assert.ok(options.some((o) => o.includes("Latha Nair")), options.join(" | "));
  await d.getByLabel("Assign transporter").selectOption({ label: options.find((o) => o.includes("Latha Nair")) });
  await d.getByRole("button", { name: "Send request" }).click();
  await hospital.getByText(/Collection requested \(TR-/).first().waitFor(); // the confirmation of THIS request
  await d.waitFor({ state: "detached" });
  const b = await hospital.evaluate(async (i) => (await (await fetch(`/api/batches/${i}`)).json()), state.id);
  assert.deepEqual(b.assignmentHistory.map((h) => h.status), ["declined", "assigned"]);
  assert.equal(b.events.filter((e) => e.eventType === "declined").length, 1);
  await hospital.getByText("Collection declined by transporter").first().waitFor();
});

await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll registration / decline checks passed");
process.exit(failed ? 1 : 0);

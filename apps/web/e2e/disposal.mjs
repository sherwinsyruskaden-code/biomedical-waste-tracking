/**
 * Receipt needs a QR scan by the plant, disposal is recorded with a time from the plant dashboard,
 * and the originating hospital is notified. Uses the sample organization.   npm run test:e2e:disposal
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";
async function browserPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const p of ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]) if (existsSync(p)) return p;
  throw new Error("No browser found. Set CHROME_PATH.");
}
const browser = await chromium.launch({ executablePath: await browserPath(), headless: true });
let failed = 0;
async function check(name, fn) { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n      ${String(e.message ?? e).split("\n").slice(0, 5).join("\n      ")}`); } }
const H = { "x-bwts-csrf": "1", "content-type": "application/json" };

async function as(account) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, baseURL: BASE });
  const r = await ctx.request.post("/api/auth/demo-login", { data: { account }, headers: H });
  assert.ok(r.ok(), `demo login ${account}`);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  return { ctx, page, api: ctx.request };
}
const json = async (r) => (r.ok() ? r.json() : Promise.reject(new Error(`${r.url()} → ${r.status()} ${await r.text()}`)));

const staff = await as("staff");
const plant = await as("plant");
let batch;

await check("set-up: a batch is registered, collected and arrives at the plant (no receipt yet)", async () => {
  const facs = await json(await staff.api.get("/api/facilities"));
  const own = facs.find((f) => f.access === "own");
  const cats = await json(await staff.api.get("/api/categories"));
  batch = await json(await staff.api.post("/api/batches", { data: { originFacilityId: own.id, categoryId: cats[0].id, quantity: 3.5, unit: "kg" }, headers: H }));
  await json(await staff.api.post(`/api/batches/${batch.id}/actions/segregate`, { data: { confirmSegregation: true }, headers: H }));
  const offered = await json(await staff.api.get(`/api/batches/${batch.id}/transporters`));
  assert.ok(offered.items.length > 0, "no free transporter: reset the sample data on a throw-away database");
  const t = offered.items.find((x) => x.fullName.startsWith("Ravi"));
  assert.ok(t, "Ravi (the sample transporter) is busy: reset the sample data on a throw-away database");
  const job = await json(await staff.api.post(`/api/batches/${batch.id}/request-collection`, { data: { transporterUserId: t.userId }, headers: H }));
  const who = await as("driver");
  await json(await who.api.post(`/api/assignments/${job.id}/accept`, { headers: H }));
  await json(await who.api.post(`/api/demo/batches/${batch.id}/simulate-scan`, { data: { action: "pickup" }, headers: H }));
  await json(await who.api.post(`/api/assignments/${job.id}/start`, { headers: H }));
  await json(await who.api.post(`/api/batches/${batch.id}/actions/handover`, { data: {}, headers: H }));
});

await check("the server refuses a receipt that has no scan", async () => {
  const r = await plant.api.post(`/api/batches/${batch.id}/actions/receive`, { data: { accepted: true, receivedQuantity: 3.5, unit: "kg", condition: "intact" }, headers: H });
  assert.equal(r.status(), 400);
  assert.match(await r.text(), /Scan the batch/);
});

await check("the receipt dialog asks the plant to scan, and only enables Confirm after a scan", async () => {
  const p = plant.page;
  await p.goto("/dashboard");
  const row = p.getByTestId("plant-arrivals").locator("li").filter({ hasText: batch.trackingCode });
  await row.getByRole("button", { name: "Confirm Receipt" }).click();
  const d = p.getByRole("dialog");
  await d.getByTestId("receipt-scan").waitFor();
  assert.equal(await d.getByRole("button", { name: "Confirm receipt" }).isDisabled(), true, "Confirm is enabled without a scan");
  await d.getByLabel("Batch", { exact: true }).selectOption({ label: `${batch.trackingCode} · delivered` });
  await d.getByRole("button", { name: "Use this batch's QR" }).click();
  await d.getByTestId("receipt-source").getByText(/Simulated scan/).waitFor();
  await d.getByLabel("Weighed quantity").fill("3.5");
  await d.getByRole("button", { name: "Confirm receipt" }).click();
  await p.getByText("Receipt recorded", { exact: true }).first().waitFor();
});

await check("the plant dashboard lists the received batch with a Record disposal button; disposal stores the time", async () => {
  const p = plant.page;
  await p.goto("/dashboard");
  const panel = p.getByTestId("plant-disposals");
  const row = panel.locator("li").filter({ hasText: batch.trackingCode });
  await row.waitFor();
  await row.getByRole("button", { name: "Record disposal" }).click();
  const d = p.getByRole("dialog");
  await d.getByLabel("Disposed on (date and time)").waitFor();
  await d.getByLabel("Plant log / document reference").fill("E2E-DISPOSAL");
  await d.getByRole("button", { name: "Record disposal" }).click();
  await p.getByText("Disposal recorded", { exact: true }).first().waitFor();
  const after = await json(await plant.api.get(`/api/batches/${batch.id}`));
  assert.equal(after.status, "disposed");
  assert.ok(after.disposal.disposedAt, "no disposal time on the record");
  await panel.locator("li").filter({ hasText: batch.trackingCode }).waitFor({ state: "detached" });
});

await check("the hospital is notified that the waste was disposed, with method and time", async () => {
  const p = staff.page;
  await p.goto("/notifications");
  const item = p.getByText(`Disposed: ${batch.trackingCode}`).first();
  await item.waitFor();
  const text = await p.locator("main").innerText();
  assert.match(text, /Treated by .* at .* on /);
});

await Promise.all(browser.contexts().map((c) => c.close()));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll receipt / disposal checks passed");
process.exit(failed ? 1 : 0);

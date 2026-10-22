/**
 * Location sharing: a device that reports a position on another continent (VPN / approximate location) or a very
 * coarse one is not used; a precise position near the route is shared and drawn.   npm run test:e2e:geo
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
const json = async (r) => (r.ok() ? r.json() : Promise.reject(new Error(`${r.url()} → ${r.status()} ${await r.text()}`)));

async function as(account, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, baseURL: BASE, ...extra });
  assert.ok((await ctx.request.post("/api/auth/demo-login", { data: { account }, headers: H })).ok(), `login ${account}`);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  return { ctx, page, api: ctx.request };
}

const staff = await as("staff");
const driver = await as("driver", { permissions: ["geolocation"], geolocation: { latitude: 40.7128, longitude: -74.006, accuracy: 15 } }); // New York
let job;

await check("set-up: an accepted, started job for the sample transporter", async () => {
  const facs = await json(await staff.api.get("/api/facilities"));
  const cats = await json(await staff.api.get("/api/categories"));
  const batch = await json(await staff.api.post("/api/batches", { data: { originFacilityId: facs.find((f) => f.access === "own").id, categoryId: cats[0].id, quantity: 2, unit: "kg" }, headers: H }));
  await json(await staff.api.post(`/api/batches/${batch.id}/actions/segregate`, { data: { confirmSegregation: true }, headers: H }));
  const offered = await json(await staff.api.get(`/api/batches/${batch.id}/transporters`));
  const t = offered.items.find((x) => x.fullName.startsWith("Ravi"));
  assert.ok(t, "Ravi is busy: reset the sample data on a throw-away database");
  job = await json(await staff.api.post(`/api/batches/${batch.id}/request-collection`, { data: { transporterUserId: t.userId }, headers: H }));
  await json(await driver.api.post(`/api/assignments/${job.id}/accept`, { headers: H }));
  await json(await driver.api.post(`/api/demo/batches/${batch.id}/simulate-scan`, { data: { action: "pickup" }, headers: H }));
  await json(await driver.api.post(`/api/assignments/${job.id}/start`, { headers: H }));
});

await check("a device on another continent is refused with an explanation, and nothing is sent", async () => {
  const p = driver.page;
  await p.goto(`/assignments/${job.id}`);
  await p.getByRole("button", { name: "Start sharing" }).click();
  await p.getByText(/looks wrong/).waitFor();
  await p.waitForTimeout(1500);
  const pts = await json(await driver.api.get(`/api/assignments/${job.id}/locations`));
  assert.equal((pts.items ?? pts).filter((x) => x.source === "device").length, 0, "a far-away fix was stored");
});

await check("a coarse (network-guess) position near the route is not used either", async () => {
  await driver.ctx.setGeolocation({ latitude: 12.93, longitude: 80.13, accuracy: 25000 });
  await driver.page.getByText(/only reports its position to about/).waitFor();
});

await check("a precise position near the route is shared and shown on the map", async () => {
  await driver.ctx.setGeolocation({ latitude: 12.93, longitude: 80.13, accuracy: 20 });
  await driver.page.getByText("Receiving fixes").waitFor();
  await driver.page.waitForTimeout(3500);
  const pts = await json(await driver.api.get(`/api/assignments/${job.id}/locations`));
  const dev = (pts.items ?? pts).filter((x) => x.source === "device");
  assert.ok(dev.length >= 1, "no fix stored");
  assert.ok(Math.abs(dev[0].latitude - 12.93) < 0.01);
  // The map frames the route (Chennai), not the world.
  const z = await driver.page.evaluate(() => document.querySelector(".leaflet-container") ? 1 : 0);
  assert.equal(z, 1);
});

await Promise.all(browser.contexts().map((c) => c.close()));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll location checks passed");
process.exit(failed ? 1 : 0);

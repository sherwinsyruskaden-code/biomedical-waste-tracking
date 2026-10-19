/**
 * Date-picker behaviour in a real browser. Needs `npm run dev` running.  npm run test:e2e:dates
 * The browser is deliberately set to a DIFFERENT timezone (Los Angeles) from the demo organization
 * (Asia/Kolkata) so any silent use of the browser's timezone shows up as a failure.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const ORG_TZ = "Asia/Kolkata";
async function browserPath() {
  if (process.env.CHROME_PATH) return { path: process.env.CHROME_PATH, args: [] };
  try { const p = chromium.executablePath(); if (p && existsSync(p)) return { path: p, args: [] }; } catch {}
  try { const s = (await import("@sparticuz/chromium")).default; return { path: await s.executablePath(), args: s.args }; } catch {}
  for (const p of ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]) if (existsSync(p)) return { path: p, args: [] };
  throw new Error("No browser found. Set CHROME_PATH or run `npx playwright install chromium`.");
}
const bp = await browserPath();
const b = await chromium.launch({ executablePath: bp.path, args: bp.args, headless: true });
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, baseURL: BASE, timezoneId: "America/Los_Angeles" });
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
const requests = [];
page.on("request", (r) => { if (r.url().includes("/api/")) requests.push(r.url()); });
// People type one field at a time; give React a beat between fills so the URL-backed filters settle.
const fill = async (loc, v) => { await loc.fill(v); await page.waitForTimeout(350); };
const sent = (needle) => requests.filter((u) => u.includes(needle));

const orgNow = (offsetMs = 0) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(Date.now() + offsetMs)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, wall: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` };
};
const addDay = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

let failed = 0;
async function check(name, fn) { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n      ${String(e.message ?? e).split("\n").slice(0, 6).join("\n      ")}`); } }

await page.goto("/login");
await page.getByRole("button", { name: /Organization administrator/ }).click();
await page.waitForURL("**/dashboard", { timeout: 90000 });
console.log(`Browser timezone: ${await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)}   Organization timezone: ${ORG_TZ}`);

console.log("Batch list filters");
await page.goto("/batches");
const from = page.getByLabel("Registered from");
const to = page.getByLabel("Registered to");
await check("pickers carry a minimum year and a maximum of today (org time)", async () => {
  assert.equal(await from.getAttribute("min"), "2000-01-01");
  assert.equal(await from.getAttribute("max"), orgNow().day);
  assert.equal(await to.getAttribute("max"), orgNow().day);
});
await check("year 3000 shows an error and is NOT sent to the server", async () => {
  requests.length = 0;
  await fill(from, "3000-01-01");
  await page.getByRole("alert").filter({ hasText: /future/i }).waitFor();
  await page.waitForTimeout(800);
  assert.equal(sent("from=3000").length, 0, "year 3000 reached the API");
});
await check("a year before 2000 is refused", async () => {
  await fill(from, "1999-05-05");
  await page.getByRole("alert").filter({ hasText: /before 2000/ }).waitFor();
});
await check("tomorrow (org time) is refused, today is accepted", async () => {
  await fill(from, "");
  await fill(to, addDay(orgNow().day, 1));
  await page.getByRole("alert").filter({ hasText: /future/i }).waitFor();
  requests.length = 0;
  await fill(to, orgNow().day);
  await page.getByRole("alert").filter({ hasText: /future|before/ }).waitFor({ state: "detached" });
});
await check("reversed range is refused", async () => {
  await fill(from, "2026-03-10");
  await fill(to, "2026-03-01");
  await page.getByRole("alert").filter({ hasText: /on or before/ }).waitFor();
});
await check("a valid past range is sent as plain days (no browser-timezone shifting)", async () => {
  requests.length = 0;
  await fill(from, "2026-01-01");
  const resp = page.waitForResponse((r) => r.url().includes("/api/batches") && r.url().includes("from=2026-01-01") && r.url().includes("to=2026-01-31") && r.status() === 200);
  await fill(to, "2026-01-31");
  await resp;
  assert.ok(!sent("/api/batches").some((u) => /from=[^&]*T/.test(u)), "an ISO timestamp (browser tz) was sent");
});

console.log("Reports");
await page.goto("/reports");
await check("defaults are today and 30 days ago in org time", async () => {
  assert.equal(await page.locator("#rt").inputValue(), orgNow().day);
  assert.equal(await page.locator("#rf").inputValue(), addDay(orgNow().day, -30));
});
await check("a future 'To' date disables the exports and explains why", async () => {
  await fill(page.locator("#rt"), "3000-12-31");
  await page.getByTestId("report-date-error").waitFor();
  assert.equal(await page.locator("a", { hasText: "CSV" }).getAttribute("aria-disabled"), "true");
  assert.equal(await page.locator("a", { hasText: "CSV" }).getAttribute("href"), null);
  await fill(page.locator("#rt"), orgNow().day);
  await page.getByTestId("report-date-error").waitFor({ state: "detached" });
  assert.ok((await page.locator("a", { hasText: "CSV" }).getAttribute("href"))?.includes(`to=${orgNow().day}`));
});
await check("the report itself loads for a valid range", async () => {
  const resp = page.waitForResponse((r) => r.url().includes("/api/reports") && r.url().includes("from=2026-01-01") && r.status() === 200);
  await fill(page.locator("#rf"), "2026-01-01");
  await resp;
});

console.log("New transport job");
await page.goto("/assignments");
await page.getByRole("button", { name: "New job" }).click();
const pickup = page.locator("#ap");
const due = page.locator("#adue");
await check("default pickup is 30 min from now in ORG time, not browser time", async () => {
  const exp = orgNow(30 * 60_000).wall;
  const got = await pickup.inputValue();
  const diff = Math.abs(Date.parse(got + ":00Z") - Date.parse(exp + ":00Z"));
  assert.ok(diff <= 2 * 60_000, `expected ≈ ${exp}, got ${got}`);
});
await check("pickup in year 3000 is refused and blocks the Create button", async () => {
  await fill(pickup, "3000-01-01T09:00");
  await page.getByRole("alert").filter({ hasText: /Choose a time between/ }).first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Create job" }).isDisabled(), true);
});
await check("pickup in the past (yesterday) is refused", async () => {
  await fill(pickup, orgNow(-26 * 3600_000).wall);
  await page.getByRole("alert").filter({ hasText: /Choose a time between/ }).first().waitFor();
});
await check("a pickup more than 90 days ahead is refused", async () => {
  await fill(pickup, orgNow(95 * 86400_000).wall);
  await page.getByRole("alert").filter({ hasText: /Choose a time between/ }).first().waitFor();
});
await check("a due time before the pickup is refused; a sensible one clears the errors", async () => {
  await fill(pickup, orgNow(3600_000).wall);
  await fill(due, orgNow(1800_000).wall);
  await page.getByRole("alert").filter({ hasText: /Choose a time between/ }).first().waitFor();
  await fill(due, orgNow(5 * 3600_000).wall);
  await page.getByRole("alert").filter({ hasText: /Choose a time between/ }).waitFor({ state: "detached" });
});

await b.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll date-picker checks passed");
process.exit(failed ? 1 : 0);

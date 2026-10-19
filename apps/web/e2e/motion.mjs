/**
 * Motion behaviour: numbers count up and settle on the true value; with "reduce motion" on, nothing animates.
 * Needs `npm run dev` running.  npm run test:e2e:motion
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";
async function browserPath() {
  if (process.env.CHROME_PATH) return { path: process.env.CHROME_PATH, args: [] };
  try { const p = chromium.executablePath(); if (p && existsSync(p)) return { path: p, args: [] }; } catch {}
  try { const s = (await import("@sparticuz/chromium")).default; return { path: await s.executablePath(), args: s.args }; } catch {}
  for (const p of ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]) if (existsSync(p)) return { path: p, args: [] };
  throw new Error("No browser found. Set CHROME_PATH or run `npx playwright install chromium`.");
}
const bp = await browserPath();
const browsers = [];
const open = async (opts = {}) => {
  const b = await chromium.launch({ executablePath: bp.path, args: bp.args, headless: true });
  browsers.push(b);
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, baseURL: BASE, ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  return page;
};
let failed = 0;
async function check(name, fn) { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n      ${String(e.message ?? e).split("\n").slice(0, 5).join("\n      ")}`); } }
const signInAdmin = async (p) => { await p.goto("/login"); await p.getByRole("button", { name: /Organization administrator/ }).click(); await p.waitForURL("**/dashboard", { timeout: 90000 }); };
const counters = (p) => p.locator("[data-value]").evaluateAll((els) => els.map((e) => ({ shown: e.textContent.trim(), value: e.getAttribute("data-value") })));

console.log("Normal motion");
const p1 = await open();
await signInAdmin(p1);
await check("dashboard numbers settle on the true values", async () => {
  await p1.waitForFunction(() => document.querySelectorAll("[data-value]").length >= 4);
  await p1.waitForTimeout(1200); // longer than the count-up
  const c = await counters(p1);
  assert.ok(c.length >= 4, `only ${c.length} animated numbers found`);
  for (const x of c) assert.equal(x.shown, Number(x.value).toLocaleString("en-US"), `shows ${x.shown}, true value ${x.value}`);
});
await check("a route change plays the soft entrance and leaves no lingering transform", async () => {
  await p1.getByRole("link", { name: "Alerts & incidents" }).first().click();
  await p1.waitForURL("**/alerts");
  await p1.waitForTimeout(700);
  const t = await p1.evaluate(() => getComputedStyle(document.querySelector("main > div")).transform);
  assert.equal(t, "none", "a leftover transform would trap fixed-position children");
});

console.log("Reduced motion");
const p2 = await open({ reducedMotion: "reduce" });
await signInAdmin(p2);
await check("numbers show their final value immediately", async () => {
  await p2.waitForFunction(() => document.querySelectorAll("[data-value]").length >= 4);
  const c = await counters(p2); // read at once, no waiting for an animation
  for (const x of c) assert.equal(x.shown, Number(x.value).toLocaleString("en-US"));
});
await check("no entrance animation runs", async () => {
  const d = await p2.evaluate(() => getComputedStyle(document.querySelector("main > div")).animationDuration);
  assert.ok(parseFloat(d) < 0.01, `animation-duration is ${d}`);
});
await check("landing card does not tilt toward the pointer", async () => {
  const p = await open({ reducedMotion: "reduce" });
  await p.goto("/");
  const card = p.getByText("How one batch moves").locator("xpath=ancestor::div[contains(@class,'shadow-lift')][1]");
  await card.hover({ position: { x: 20, y: 20 } });
  await p.waitForTimeout(500);
  const t = await card.evaluate((e) => { let n = e; const out = []; while (n && n.tagName !== "SECTION") { out.push(getComputedStyle(n).transform); n = n.parentElement; } return out; });
  assert.ok(t.every((x) => x === "none"), `transforms: ${t.join(" | ")}`);
});

console.log("Normal motion, landing");
await check("the landing card tilts a few degrees toward the mouse and settles back", async () => {
  const p = await open();
  await p.goto("/");
  const card = p.getByText("How one batch moves").locator("xpath=ancestor::div[contains(@class,'shadow-lift')][1]");
  await card.hover({ position: { x: 20, y: 20 } });
  await p.waitForTimeout(700);
  const tilted = await card.evaluate((e) => getComputedStyle(e.parentElement).transform);
  assert.notEqual(tilted, "none", "no tilt applied");
  await p.mouse.move(5, 5);
  await p.waitForTimeout(1500);
  const rest = await card.evaluate((e) => getComputedStyle(e.parentElement).transform);
  const m = rest.match(/matrix3d\((.+)\)/)?.[1].split(",").map(Number);
  if (m) assert.ok(Math.abs(m[1]) < 0.01 && Math.abs(m[2]) < 0.01, `still tilted: ${rest}`);
});

await Promise.all(browsers.map((b) => b.close()));
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll motion checks passed");
process.exit(failed ? 1 : 0);

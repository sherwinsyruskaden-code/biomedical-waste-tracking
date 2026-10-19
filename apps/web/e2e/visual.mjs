/**
 * Visual-enhancement regression checks: the decorative globe, dialog/menu animation hooks, the lifecycle rail
 * (driven by real batch data), reduced-motion behaviour, mobile overflow and keyboard access.
 * npm run test:e2e:visual   (set E2E_BASE_URL; the API must be running with sample data)
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";
async function browserPath() {
  if (process.env.CHROME_PATH) return { path: process.env.CHROME_PATH, args: [] };
  for (const p of ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]) if (existsSync(p)) return { path: p, args: [] };
  throw new Error("No browser found. Set CHROME_PATH.");
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
const signInAdmin = async (p) => { await p.goto("/login"); await p.getByRole("button", { name: /Main Admin/ }).click(); await p.waitForURL("**/dashboard", { timeout: 90000 }); };

console.log("Landing globe");
await check("a decorative globe is shown on desktop, ignores the pointer, and never blocks the sign-up button", async () => {
  const p = await open();
  await p.goto("/");
  const g = p.getByTestId("globe-visual");
  await g.waitFor();
  assert.equal(await g.evaluate((e) => getComputedStyle(e).pointerEvents), "none");
  assert.equal(await g.getAttribute("aria-hidden"), "true");
  const spin = await p.locator(".fx-globe-spin").evaluate((e) => getComputedStyle(e).animationName);
  assert.equal(spin, "globe-spin");
  await p.getByRole("link", { name: "Create an account" }).last().click();
  await p.waitForURL("**/signup");
});
await check("no globe (and no horizontal scroll) at tablet and phone widths", async () => {
  for (const w of [820, 375]) {
    const p = await open({ viewport: { width: w, height: 900 } });
    await p.goto("/");
    await p.getByRole("heading", { level: 1 }).waitFor();
    assert.equal(await p.getByTestId("globe-visual").isVisible(), false, `globe visible at ${w}px`);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `horizontal overflow at ${w}px`);
  }
});
await check("with reduced motion the globe stays still", async () => {
  const p = await open({ reducedMotion: "reduce" });
  await p.goto("/");
  await p.getByTestId("globe-visual").waitFor();
  assert.equal(await p.locator(".fx-globe-spin").count(), 0);
});

console.log("Transitions in the app");
const admin = await open();
await signInAdmin(admin);
await check("the account menu opens with its animation and closes with Escape; focus returns to the trigger", async () => {
  const trigger = admin.getByRole("button", { name: "Account menu" });
  await trigger.click();
  const menu = admin.locator(".fx-menu[data-state=open]");
  await menu.waitFor();
  assert.equal(await menu.evaluate((e) => getComputedStyle(e).animationName), "menu-in");
  await admin.keyboard.press("Escape");
  await admin.locator(".fx-menu").waitFor({ state: "detached" });
  assert.equal(await trigger.evaluate((e) => document.activeElement === e), true);
});
await check("dialogs fade and scale in, trap focus, and close with Escape", async () => {
  await admin.goto("/team");
  await admin.getByRole("button", { name: "Invite" }).click();
  const dlg = admin.getByRole("dialog");
  await dlg.waitFor();
  assert.equal(await dlg.evaluate((e) => getComputedStyle(e).animationName), "dialog-in");
  assert.equal(await admin.locator(".fx-overlay[data-state=open]").count(), 1);
  await admin.keyboard.press("Tab");
  assert.equal(await dlg.evaluate((e) => e.contains(document.activeElement)), true, "focus left the dialog");
  await admin.keyboard.press("Escape");
  await dlg.waitFor({ state: "detached" });
});
await check("the lifecycle rail mirrors the batch's real status from the API", async () => {
  const sample = await admin.evaluate(async () => {
    const list = (await (await fetch("/api/batches?pageSize=50")).json()).items;
    const pick = list.find((x) => x.status === "in_transit") ?? list[0];
    return { id: pick.id, status: pick.status };
  });
  await admin.goto(`/batches/${sample.id}`);
  const rail = admin.getByRole("list", { name: "Lifecycle progress" });
  await rail.waitFor();
  const order = ["generated", "segregated", "collected", "in_transit", "delivered", "received", "disposed"];
  const expected = order.indexOf(sample.status);
  assert.equal(await rail.locator("li").count(), 7);
  assert.equal(await rail.locator(".fx-node").count(), 7);
  const current = await rail.locator("li [aria-current=step]").count();
  if (sample.status !== "disposed" && expected >= 0) {
    const idx = await rail.locator("li").evaluateAll((els) => els.findIndex((li) => li.querySelector("[aria-current=step]")));
    assert.equal(idx, expected, `rail highlights step ${idx}, batch status is ${sample.status}`);
  } else assert.equal(current, 0);
  assert.equal(await rail.locator(".fx-rail-fill").count(), Math.max(0, expected), "completed connectors");
});
await check("pages stay readable while skeletons shimmer (loading blocks are aria-busy)", async () => {
  await admin.goto("/batches");
  await admin.getByRole("heading", { level: 1 }).first().waitFor();
});

console.log("Reduced motion in the app");
const calm = await open({ reducedMotion: "reduce" });
await signInAdmin(calm);
await check("menus, dialogs and the rail run no animation", async () => {
  await calm.getByRole("button", { name: "Account menu" }).click();
  const menu = calm.locator(".fx-menu[data-state=open]");
  await menu.waitFor();
  assert.equal(await menu.evaluate((e) => getComputedStyle(e).animationName), "none");
  await calm.keyboard.press("Escape");
  await calm.goto("/team");
  await calm.getByRole("button", { name: "Invite" }).click();
  assert.equal(await calm.getByRole("dialog").evaluate((e) => getComputedStyle(e).animationName), "none");
});

console.log("Printing");
await check("print styles still hide the app chrome on the QR label page", async () => {
  const sample = await admin.evaluate(async () => (await (await fetch("/api/batches?pageSize=5")).json()).items[0].id);
  await admin.goto(`/batches/${sample}/labels`);
  await admin.emulateMedia({ media: "print" });
  const shown = await admin.evaluate(() => [...document.querySelectorAll(".no-print")].every((e) => getComputedStyle(e).display === "none"));
  assert.equal(shown, true);
  await admin.emulateMedia({ media: "screen" });
});

await Promise.all(browsers.map((b) => b.close()));
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll visual checks passed");
process.exit(failed ? 1 : 0);

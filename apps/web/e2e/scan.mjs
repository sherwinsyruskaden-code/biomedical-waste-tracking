/**
 * QR-only scanning test. Needs `npm run dev` running and ffmpeg (for the fake camera part).
 *   npm run test:e2e:scan
 * 1. Shows a demo QR label on screen, photographs it, and feeds that picture to Chromium as a FAKE CAMERA,
 *    so the real qr-scanner decode path runs against the real label.
 * 2. Without a camera, checks the error message, the photo/screenshot fallback and the demo shortcut.
 * A physical phone camera is still a manual test.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const open = async (extraArgs = [], perms = []) => {
  const b = await chromium.launch({ executablePath: bp.path, args: [...bp.args, ...extraArgs], headless: true });
  browsers.push(b);
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, baseURL: BASE, permissions: perms });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  return { ctx, page };
};
const demoLogin = async (page, role) => {
  await page.goto("/login");
  await page.getByRole("button", { name: role }).click();
  await page.waitForURL("**/dashboard", { timeout: 90000 });
};
let failed = 0, skipped = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { if (e.skip) { skipped++; console.log(`  - ${name} (skipped: ${e.message})`); } else { failed++; console.log(`  ✗ ${name}\n      ${String(e.message ?? e).split("\n").slice(0, 8).join("\n      ")}`); } }
}

const dir = join(tmpdir(), "bwts-scan-test");
mkdirSync(dir, { recursive: true });
const qrPng = join(dir, "label-qr.png");
const y4m = join(dir, "camera.y4m");
let code = "";

console.log("Demo label page");
const d = await open();
await check("demo QR label shows on screen and is clearly marked as a demo", async () => {
  await demoLogin(d.page, /Transporter/);
  await d.page.goto("/demo-labels");
  const label = d.page.getByTestId("demo-label");
  await label.waitFor();
  assert.match(await label.innerText(), /Demo label · synthetic data · not real waste/i);
  code = (await label.locator("p.font-mono").innerText()).trim();
  assert.match(code, /^[A-Z0-9-]{6,}$/);
  await label.locator('[role="img"]').screenshot({ path: qrPng });
});
await check("it can be shown full screen and printed (print button present)", async () => {
  await d.page.getByRole("button", { name: "Show full screen" }).click();
  await d.page.getByRole("dialog", { name: "Full-screen demo label" }).waitFor();
  await d.page.getByRole("button", { name: "Close" }).click();
  assert.equal(await d.page.getByRole("button", { name: "Print this label" }).count(), 1);
});

console.log("Scan page (no camera)");
await check("scan screen offers QR only — no RFID, NFC or typed-code options", async () => {
  await d.page.goto("/scan");
  await d.page.getByRole("heading", { name: /Scan a container.s QR code/ }).waitFor();
  const text = (await d.page.locator("main").innerText()).toLowerCase();
  for (const bad of ["rfid", "nfc", "type it", "enter the code", "keyboard"]) assert.ok(!text.includes(bad), `scan page still mentions "${bad}"`);
  assert.equal(await d.page.getByRole("tab").count(), 0);
});
await check("no camera → useful error, photo fallback and demo shortcut (no broken screen)", async () => {
  await d.page.getByRole("alert").filter({ hasText: /camera/i }).first().waitFor();
  await d.page.getByRole("button", { name: "Scan a photo or screenshot" }).waitFor();
  await d.page.getByTestId("demo-shortcut").waitFor();
});
await check("uploading a screenshot of the label resolves to the right batch and shows next step", async () => {
  await d.page.getByTestId("scanner-image-input").setInputFiles(qrPng);
  await d.page.getByText("Label recognised").waitFor();
  await d.page.getByRole("link", { name: code }).waitFor();
  await d.page.getByText(/Next step for your role|Nothing for your role/).waitFor();
});
await check("an image with no QR code gives a clear message", async () => {
  const blank = join(dir, "blank.png");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=white:s=300x300", "-frames:v", "1", blank]);
  await d.page.getByTestId("scanner-image-input").setInputFiles(blank);
  await d.page.getByText("No QR code was found in that image").waitFor();
});
await check("a QR code that is not a BWTS label is rejected", async () => {
  const other = join(dir, "other.png");
  const { default: QRCode } = await import("qrcode").catch(() => ({ default: null }));
  if (!QRCode) { const e = new Error("qrcode package not available"); e.skip = true; throw e; }
  await QRCode.toFile(other, "https://example.com/not-a-label", { scale: 8, margin: 4 });
  await d.page.getByTestId("scanner-image-input").setInputFiles(other);
  await d.page.getByRole("alert").filter({ hasText: /not a BWTS|not registered|Label/i }).first().waitFor();
});
await check("demo shortcut recognises a demo label", async () => {
  await d.page.goto("/scan");
  await d.page.getByTestId("demo-shortcut").waitFor();
  await d.page.getByRole("button", { name: "Use this demo label" }).click();
  await d.page.getByText("Label recognised").waitFor();
});

console.log("Scan page (fake camera showing the label)");
await check("live camera decodes the on-screen demo label and shows the correct batch", async () => {
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", qrPng, "-t", "4", "-r", "10", "-vf", "scale=250:250:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p", y4m]);
  } catch { const e = new Error("ffmpeg not available"); e.skip = true; throw e; }
  const c = await open(["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`], ["camera"]);
  await demoLogin(c.page, /Transporter/);
  await c.page.goto("/scan");
  await c.page.getByTestId("scanner-video").waitFor();
  await c.page.getByText("Label recognised").waitFor({ timeout: 45000 });
  await c.page.getByRole("link", { name: code }).waitFor();
});

console.log("Transporter demo: simulated QR scans (no second device)");
await check("transporter accepts a collection request and completes it with clearly-labelled simulated scans", async () => {
  const t = await open();
  await demoLogin(t.page, /Transporter/);
  const waiting = await t.page.evaluate(async () => (await (await fetch("/api/assignments?status=assigned")).json()).items);
  if (!waiting.length) { const e = new Error("no waiting demo collection left — run `npm run db:seed:reset` to recreate the demo"); e.skip = true; throw e; }
  await t.page.goto(`/assignments/${waiting[0].id}`);
  await t.page.getByTestId("route").getByText(/Hospital B/).waitFor();
  await t.page.getByRole("button", { name: "Accept request" }).click();
  await t.page.getByRole("button", { name: "Simulate QR scan (demo)" }).click();
  await t.page.getByText(/Simulated QR scan of .* \(demo — no camera used\)/).first().waitFor();
  await t.page.getByRole("button", { name: "Start trip" }).click();
  await t.page.getByText("On the road").first().waitFor();
  await t.page.getByRole("button", { name: "Simulate QR scan (demo)" }).click();
  await t.page.getByText("Completed").first().waitFor();
  const batchId = await t.page.evaluate(async (id) => (await (await fetch(`/api/assignments/${id}`)).json()).batches[0].id, waiting[0].id);
  await t.page.goto(`/batches/${batchId}`);
  await t.page.getByText("Simulated QR scan (demo)").nth(1).waitFor();
  await t.page.getByText("Delivered").first().waitFor();
});

await Promise.all(browsers.map((b) => b.close()));
console.log(failed ? `\n${failed} check(s) FAILED` : `\nAll scan checks passed${skipped ? ` (${skipped} skipped)` : ""}`);
process.exit(failed ? 1 : 0);

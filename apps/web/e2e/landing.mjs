/**
 * Regression test: the public landing page must always offer sign-up and sign-in to logged-out
 * visitors, and a leftover session must never hide them. Needs `npm run dev` running.
 *   npm run test:e2e:landing
 * Browser: CHROME_PATH, or `npx playwright install chromium` once.
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
const profile = async () => {
  const b = await chromium.launch({ executablePath: bp.path, args: bp.args, headless: true });
  browsers.push(b);
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, baseURL: BASE });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  return { ctx, page };
};

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n      ${String(e.message ?? e).split("\n").slice(0, 3).join("\n      ")}`); }
}

/** Waits for the page to settle, then reports what a visitor can see. */
async function landing(page) {
  await page.goto("/");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.waitForLoadState("networkidle");
  return {
    createAccount: await page.getByRole("link", { name: "Create an account" }).count(),
    acceptInvite: await page.getByRole("link", { name: "Accept invitation" }).count(),
    signIn: await page.getByRole("link", { name: "Sign in" }).count(),
    dashboard: await page.getByRole("link", { name: "Open dashboard" }).count(),
    note: await page.getByTestId("signed-in-note").count(),
  };
}
const assertPublic = (s, label) => { assert.equal(s.createAccount, 2, `${label}: header + hero "Create an account" links missing`); assert.equal(s.acceptInvite, 1, `${label}: "Accept invitation" link missing`); assert.equal(s.signIn, 1, `${label}: "Sign in" link missing`); };
const ADMIN = { name: /Main Admin/ };

const A = await profile();
const B = await profile(); // a completely separate browser profile (own cookie jar)

console.log("Landing page / sign-up visibility");
await check("fresh visitor sees sign-up and sign-in, no dashboard link", async () => {
  const s = await landing(A.page);
  assertPublic(s, "fresh");
  assert.equal(s.dashboard, 0); assert.equal(s.note, 0);
});
await check("stays that way across 3 refreshes", async () => {
  for (let i = 0; i < 3; i++) { await A.page.reload(); const s = await landing(A.page); assertPublic(s, `refresh ${i + 1}`); assert.equal(s.dashboard, 0); }
});
await check("sign-up and sign-in pages open for a fresh visitor", async () => {
  await A.page.goto("/signup");
  await A.page.getByRole("heading", { name: "Create an account" }).waitFor();
  assert.equal(await A.page.getByTestId("signed-in-notice").count(), 0);
  await A.page.goto("/login");
  await A.page.getByRole("heading", { name: "Sign in" }).waitFor();
});
await check("landing still offers sign-up when /api/auth/me fails or is slow", async () => {
  const x = await profile();
  await x.ctx.route("**/api/auth/me", (r) => r.abort());
  assertPublic(await landing(x.page), "me aborted");
  await x.ctx.unroute("**/api/auth/me");
  await x.ctx.route("**/api/auth/me", async (r) => { await new Promise((ok) => setTimeout(ok, 1500)); await r.continue(); });
  await x.page.goto("/");
  await x.page.getByRole("heading", { level: 1 }).waitFor(); // landing renders without waiting for /me
  assertPublic({ createAccount: await x.page.getByRole("link", { name: "Create an account" }).count(), acceptInvite: await x.page.getByRole("link", { name: "Accept invitation" }).count(), signIn: await x.page.getByRole("link", { name: "Sign in" }).count() }, "me slow (while loading)");
});

console.log("Landing content, account creation and role selection");
await check("footer reads 'Biomedical Waste Tracking System' and 'Terms & Privacy'", async () => {
  await landing(A.page);
  const footer = await A.page.locator("footer").innerText();
  assert.ok(footer.includes("Biomedical Waste Tracking System"), footer);
  assert.ok(!footer.includes("academic project"), footer);
  assert.equal(await A.page.getByRole("link", { name: "Terms & Privacy", exact: true }).count(), 1);
  assert.equal(await A.page.getByRole("link", { name: "Terms & privacy", exact: true }).count(), 0);
});
await check("the redundant 'Just looking?' text is gone; the role selector shows only four choices", async () => {
  await landing(A.page);
  assert.equal(await A.page.getByText(/Just looking\?/).count(), 0);
  assert.equal(await A.page.getByText(/pick another demo role/).count(), 0);
  assert.equal(await A.page.getByText("I have an invitation").count(), 0);
  const roles = await A.page.getByTestId("demo-roles").locator("button").allInnerTexts();
  assert.equal(roles.length, 4, `expected 4 primary choices, got: ${roles.join(" | ")}`);
  for (const r of ["Hospital Staff", "Transporter", "Treatment Plant Staff", "Main Admin"]) assert.ok(roles.some((t) => t.includes(r)), `missing ${r}`);
  assert.equal(await A.page.locator('[data-demo="staff"]').count(), 0, "Hospital A visible before choosing Hospital Staff");
  assert.equal(await A.page.locator('[data-demo="staffB"]').count(), 0, "Hospital B visible before choosing Hospital Staff");
  assert.equal(await A.page.getByRole("button", { name: /Platform/i }).count(), 0, "a platform role is still offered");
});
await check("Hospital Staff reveals Hospital A and Hospital B", async () => {
  await A.page.locator('[data-demo="hospital"]').click();
  await A.page.locator('[data-demo="staff"]').waitFor();
  await A.page.locator('[data-demo="staffB"]').waitFor();
  const roles = await A.page.getByTestId("demo-roles").locator("button").allInnerTexts();
  assert.equal(roles.length, 6);
  await A.page.locator('[data-demo="hospital"]').click();
  await A.page.locator('[data-demo="staff"]').waitFor({ state: "detached" });
});
await check("the sign-in page shows the same four choices", async () => {
  await A.page.goto("/login");
  await A.page.getByTestId("demo-roles").waitFor();
  assert.equal(await A.page.getByTestId("demo-roles").locator("button").count(), 4);
});
await check("'Create an account' explains both paths with the simplified invitation text", async () => {
  await A.page.goto("/");
  await A.page.getByRole("link", { name: "Create an account" }).last().click();
  await A.page.getByRole("heading", { name: "Create an account" }).waitFor();
  assert.equal(await A.page.getByLabel("Role").count(), 0); // roles are never self-assigned
  await A.page.getByRole("radio", { name: /Join my organization/ }).click();
  const box = A.page.getByTestId("join-by-invitation");
  await box.waitFor();
  const text = await box.innerText();
  assert.match(text, /added by that organization's administrator, who chooses their role and facility\./);
  for (const gone of ["invited to their hospital", "invited to their approved treatment plant", "invited by the organization that dispatches them", "Team → Invite", "nobody can give themselves extra access"]) assert.ok(!text.includes(gone), `still shows: ${gone}`);
  await A.page.getByRole("link", { name: /I have an invitation/ }).click();
  await A.page.getByRole("heading", { name: "Accept an invitation" }).waitFor();
  await A.page.getByLabel("Invitation link or code").fill("http://localhost:5173/invite/not-a-real-invitation-token-123");
  await A.page.getByRole("button", { name: "Continue" }).click();
  await A.page.getByRole("heading", { name: "Invitation unavailable" }).waitFor();
});
await check("sign-up accepts a 4-character password and rejects 3 characters in the form", async () => {
  await A.page.goto("/signup");
  await A.page.getByLabel("Full name").fill("Pia Pass");
  await A.page.getByLabel("Work email").fill(`pass-${Date.now().toString(36)}@e2e.test`);
  await A.page.getByLabel(/^Password/).fill("abc");
  await A.page.getByText("Password must be at least 4 characters.").first().waitFor();
  await A.page.getByLabel(/^Password/).fill("abcd");
  assert.equal(await A.page.getByText("Password must be at least 4 characters.").count(), 0);
});
await check("Hospital A and Hospital B staff each see only their own hospital", async () => {
  for (const [key, label] of [["staff", "Hospital A"], ["staffB", "Hospital B"]]) {
    const x = await profile();
    await x.page.goto("/");
    await x.page.locator('[data-demo="hospital"]').click();
    await x.page.locator(`[data-demo="${key}"]`).click();
    await x.page.waitForURL("**/dashboard", { timeout: 90000 });
    await x.page.getByTestId("workplace").filter({ hasText: label }).first().waitFor();
    await x.page.goto("/batches");
    await x.page.locator("tbody tr").first().waitFor();
    const rows = await x.page.locator("tbody tr").allInnerTexts();
    const preloaded = rows.filter((r) => r.includes("SMP-"));
    assert.ok(preloaded.length <= 3, `too many preloaded batches for one hospital: ${preloaded.length}`);
    assert.ok(rows.every((r) => r.includes(label)), `${key} sees another hospital`);
    const nav = await x.page.getByRole("navigation", { name: "Main" }).first().innerText();
    assert.ok(nav.includes("Collection requests") && !nav.includes("My facility"), "hospital nav");
    assert.ok(!nav.includes("Team") && !nav.includes("Live map") && !nav.includes("Organization approvals"), "hospital staff see unneeded modules");
    await x.page.goto("/approvals");
    await x.page.waitForURL("**/dashboard"); // no review permission: bounced
  }
});
await check("Main Admin has the Organization approvals section; it lists pending organizations", async () => {
  const x = await profile();
  await x.page.goto("/");
  await x.page.locator('[data-demo="admin"]').click();
  await x.page.waitForURL("**/dashboard", { timeout: 90000 });
  await x.page.getByRole("link", { name: /Organization approvals/ }).click();
  await x.page.waitForURL("**/approvals");
  await x.page.getByRole("heading", { name: "Organization approvals" }).waitFor();
  await x.page.getByTestId("org-review").filter({ hasText: "sample applicant" }).first().waitFor();
  await x.page.goto("/platform");
  await x.page.waitForURL("**/approvals"); // the old address is redirected
});
await check("no user-facing text contains the word 'demo' on any role's main screens", async () => {
  const pages = ["/dashboard", "/batches", "/assignments", "/facilities", "/alerts", "/reports", "/settings", "/scan", "/demo-labels", "/tracking", "/receiving", "/team", "/approvals", "/batches/new"];
  const seen = [];
  for (const [role, via] of [["staff", "hospital"], ["driver"], ["plant"], ["admin"]]) {
    const x = await profile();
    await x.page.goto("/");
    if (via) await x.page.locator(`[data-demo="${via}"]`).click();
    await x.page.locator(`[data-demo="${role}"]`).click();
    await x.page.waitForURL("**/dashboard", { timeout: 90000 });
    for (const path of pages) {
      await x.page.goto(path);
      await x.page.waitForLoadState("networkidle");
      const text = await x.page.locator("body").innerText();
      const hit = text.match(/.{0,40}\bdemo\b.{0,40}/i);
      if (hit) seen.push(`${role} ${path}: …${hit[0]}…`);
      if (/Records support traceability\. They are not a regulatory certificate\./.test(text)) seen.push(`${role} ${path}: regulatory disclaimer`);
      if (/My facility/.test(text)) seen.push(`${role} ${path}: My facility`);
    }
  }
  for (const path of ["/", "/login", "/signup", "/invite", "/terms"]) {
    await A.page.goto(path);
    await A.page.waitForLoadState("networkidle");
    const hit = (await A.page.locator("body").innerText()).match(/.{0,40}\bdemo\b.{0,40}/i);
    if (hit) seen.push(`public ${path}: …${hit[0]}…`);
  }
  assert.deepEqual(seen, []);
});

console.log("After a quick sign-in");
await check("demo login reaches the dashboard", async () => {
  await A.page.goto("/");
  await A.page.getByRole("button", ADMIN).click();
  await A.page.waitForURL("**/dashboard", { timeout: 60000 });
});
await check("demo session is a browser-session cookie (no multi-day login)", async () => {
  const c = (await A.ctx.cookies()).find((k) => k.name === "bwts_session");
  assert.ok(c, "no session cookie"); assert.equal(c.expires, -1, `cookie has an expiry: ${c.expires}`);
});
await check("landing STILL shows sign-up + sign-in, plus an Open dashboard link", async () => {
  const s = await landing(A.page);
  assertPublic(s, "signed in"); assert.equal(s.dashboard, 1); assert.equal(s.note, 1);
});
await check("sign-up page is reachable (not redirected) and shows a signed-in notice", async () => {
  await A.page.goto("/signup");
  await A.page.getByRole("heading", { name: "Create an account" }).waitFor();
  assert.ok(A.page.url().endsWith("/signup"));
  await A.page.getByTestId("signed-in-notice").waitFor();
});
await check("sign-in page is reachable while signed in", async () => {
  await A.page.goto("/login");
  await A.page.getByRole("heading", { name: "Sign in" }).waitFor();
  assert.ok(A.page.url().endsWith("/login"));
});
await check("a separate browser profile is unaffected (still logged out)", async () => {
  const s = await landing(B.page); assertPublic(s, "profile B"); assert.equal(s.dashboard, 0); assert.equal(s.note, 0);
});
await check("signing out from the notice returns a clean public landing", async () => {
  await A.page.getByRole("button", { name: "Sign out" }).click();
  await A.page.getByTestId("signed-in-notice").waitFor({ state: "detached" });
  const s = await landing(A.page); assertPublic(s, "after sign out"); assert.equal(s.dashboard, 0);
  await A.page.goto("/dashboard"); await A.page.waitForURL(/\/login/);
});
await check("sign out from inside the app, then landing is public", async () => {
  await A.page.goto("/login");
  await A.page.getByRole("button", { name: /Transporter/ }).click();
  await A.page.waitForURL("**/dashboard");
  await A.page.getByRole("button", { name: /account|menu|profile/i }).first().click().catch(() => {});
  await A.page.getByRole("menuitem", { name: /Sign out/ }).click();
  await A.page.waitForURL(/\/login/);
  const s = await landing(A.page); assertPublic(s, "after in-app sign out"); assert.equal(s.dashboard, 0);
});
await check("expired/cleared cookie → public landing again", async () => {
  await A.page.goto("/login"); await A.page.getByRole("button", ADMIN).click(); await A.page.waitForURL("**/dashboard");
  await A.ctx.clearCookies();
  const s = await landing(A.page); assertPublic(s, "cleared cookie"); assert.equal(s.dashboard, 0);
});

console.log("Session ends while the app is open");
await check("an expired session sends the user to sign-in with a message and returns them after", async () => {
  await A.page.goto("/login");
  await A.page.getByRole("button", ADMIN).click();
  await A.page.waitForURL("**/dashboard", { timeout: 60000 });
  await A.page.getByRole("link", { name: "Waste batches" }).first().waitFor(); // the app has fully loaded
  await A.ctx.clearCookies(); // the server no longer recognises this browser
  // A background refresh may notice first; either way the user must land on sign-in.
  await A.page.getByRole("link", { name: "Waste batches" }).first().dispatchEvent("click", undefined, { timeout: 3000 }).catch(() => {});
  await A.page.waitForURL(/\/login\?next=%2F(batches|dashboard)/).catch(async (e) => { throw new Error(`${e.message.split("\n")[0]} — page is at ${A.page.url()}`); });
  await A.page.getByText("Your session has ended").waitFor();
  await A.page.getByRole("button", ADMIN).click();
  await A.page.waitForURL("**/dashboard", { timeout: 60000 });
});
await check("a wrong password on the sign-in page is a normal form error, not a 'session ended' redirect", async () => {
  const x = await profile();
  await x.page.goto("/login");
  await x.page.getByLabel("Work email").fill("nobody@example.test");
  await x.page.getByLabel("Password", { exact: true }).fill("wrong-password-123");
  await x.page.getByRole("button", { name: "Sign in", exact: true }).click();
  // The login rate limiter may answer instead when this suite has been run many times in 15 minutes; both are plain form errors.
  await x.page.getByText(/Invalid email or password|Too many/).waitFor();
  assert.ok(x.page.url().endsWith("/login"));
  assert.equal(await x.page.getByText("Your session has ended").count(), 0);
});

await Promise.all(browsers.map((b) => b.close()));
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll landing/sign-up regression checks passed");
process.exit(failed ? 1 : 0);

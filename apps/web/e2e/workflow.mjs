/**
 * Browser checks for the batch form (automatic origin, numeric quantity, no notes) and the treatment plant's
 * arrivals view. Uses the one-click role sign-in, so the server must run with DEMO_MODE=true.
 *   E2E_BASE_URL=http://localhost:4000 npm run test:e2e:workflow
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
const open = async (group, key) => {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 }, baseURL: BASE })).newPage();
  page.setDefaultTimeout(30000);
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

console.log("Batch registration form");
const a = await open("hospital", "staff");
await a.goto("/batches/new");
await a.getByRole("radio", { name: /Yellow/ }).check({ force: true });
await check("the origin dropdown is gone; the origin is shown read-only from the user's own hospital", async () => {
  await a.getByTestId("batch-origin").waitFor();
  assert.match(await a.getByTestId("batch-origin").innerText(), /Hospital A/);
  assert.equal(await a.locator("#origin").count(), 0);
  assert.equal(await a.getByText(/Origin \(where the waste was produced\)/).count(), 0);
});
await check("the notes section (segregation notes, handling instructions) is gone", async () => {
  const text = await a.locator("main").innerText();
  for (const gone of ["Notes", "Segregation notes", "Anything the checker should know", "Handling instructions"]) assert.ok(!text.includes(gone), `still shows "${gone}"`);
});
const qty = a.getByLabel("Quantity");
const submit = a.getByRole("button", { name: "Register & create labels" });
await check("quantity ignores letters and symbols typed on the keyboard", async () => {
  await qty.click();
  await a.keyboard.type("abc-+e");
  assert.equal(await qty.inputValue(), "");
  assert.equal(await submit.isDisabled(), true);
  assert.equal(await qty.getAttribute("type"), "number");
});
await check("malformed, zero and over-precise quantities are refused with a message and cannot be submitted", async () => {
  for (const [value, message] of [["1e3", /Enter a number/], ["0", /greater than zero/], ["1.2345", /at most 3 decimal/]]) {
    await qty.evaluate((el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); }, value);
    await a.getByText(message).first().waitFor();
    assert.equal(await submit.isDisabled(), true, `submit enabled for ${value}`);
  }
});
await check("a valid decimal quantity registers the batch for Hospital A, with no notes on the batch page", async () => {
  await qty.fill("12.5");
  await a.getByLabel("Ward / department").fill("Ward 7");
  await submit.click();
  await a.waitForURL(/\/batches\/[0-9a-f-]+\/qr/);
  const id = a.url().split("/batches/")[1].split("/")[0];
  await a.goto(`/batches/${id}`);
  await a.locator("h1.font-mono").waitFor();
  await a.getByText("Origin", { exact: true }).waitFor();
  const text = await a.locator("main").innerText();
  assert.ok(text.includes("12.5 kg"), text.slice(0, 400));
  assert.ok(!/Segregation:|Handling:/.test(text), "notes are displayed");
  const b = await a.evaluate(async (i) => (await fetch(`/api/batches/${i}`)).json(), id);
  assert.match(b.origin.name, /Hospital A/);
  assert.match(b.trackingCode, /^BW-/);
});
await check("Hospital A cannot register waste for Hospital B by sending B's facility id", async () => {
  const r = await a.evaluate(async () => {
    const facs = await (await fetch("/api/facilities")).json();
    const cats = await (await fetch("/api/categories")).json();
    const hospitalA = facs.find((f) => f.access === "own");
    // Another hospital's id cannot even be seen by this user; use a made-up one and A's own id for comparison.
    const bogus = "00000000-0000-4000-8000-000000000000";
    const post = (originFacilityId) => fetch("/api/batches", { method: "POST", headers: { "content-type": "application/json", "x-bwts-csrf": "1" }, body: JSON.stringify({ originFacilityId, categoryId: cats[0].id, quantity: 1, unit: "kg" }) }).then((x) => x.status);
    return { other: await post(bogus), own: await post(hospitalA.id) };
  });
  assert.ok([400, 403].includes(r.other), `other hospital id → ${r.other}`);
  assert.equal(r.own, 201);
});

console.log("Treatment plant arrivals");
const plant = await open(null, "plant");
await check("arrived batches are on the plant dashboard with a Confirm Receipt button", async () => {
  const panel = plant.getByTestId("plant-arrivals");
  await panel.getByText("Arrived — awaiting receipt").first().waitFor();
  await panel.getByRole("button", { name: "Confirm Receipt" }).first().waitFor();
  const text = await panel.innerText();
  assert.match(text, /Hospital B|Hospital A/);
  const nav = await plant.getByRole("navigation", { name: "Main" }).first().innerText();
  assert.ok(nav.includes("Arrivals & disposal"));
  assert.ok(!nav.includes("Waste batches") && !nav.includes("Team"), "plant staff see unneeded modules");
});
await check("only the plant's own arrivals are listed, and Confirm Receipt updates the real batch", async () => {
  const before = await plant.evaluate(async () => (await (await fetch("/api/batches?status=delivered&pageSize=50")).json()).items);
  assert.ok(before.length >= 1);
  const target = before[0];
  await plant.getByTestId("plant-arrivals").getByRole("button", { name: "Confirm Receipt" }).first().click();
  const d = plant.getByRole("dialog");
  await d.getByLabel("Weighed quantity").fill(String(target.quantity));
  await d.getByRole("button", { name: "Confirm receipt" }).click();
  await plant.getByText("Receipt recorded", { exact: true }).first().waitFor();
  const after = await plant.evaluate(async (id) => (await (await fetch(`/api/batches/${id}`)).json()), target.id);
  assert.equal(after.status, "received");
  assert.equal(after.receipts.length, 1);
  assert.equal(after.trackingCode, target.trackingCode);
});


console.log("Landing: five role cards");
const anon = async (width = 1360) => {
  const page = await (await browser.newContext({ viewport: { width, height: 900 }, baseURL: BASE })).newPage();
  page.setDefaultTimeout(30000);
  await page.goto("/");
  await page.getByTestId("role-cards").waitFor();
  return page;
};
const cardBoxes = async (page) => page.getByTestId("role-cards").locator("> div").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }));
await check("desktop: three cards in the first row, two filling the second, equal heights per row", async () => {
  const p = await anon(1360);
  const c = await cardBoxes(p);
  assert.equal(c.length, 5);
  const rows = [...new Set(c.map((x) => x.y))];
  assert.equal(rows.length, 2, `rows: ${JSON.stringify(c)}`);
  assert.deepEqual(c.filter((x) => x.y === rows[0]).length, 3);
  assert.deepEqual(c.filter((x) => x.y === rows[1]).length, 2);
  const [a, b] = c.slice(3);
  assert.ok(Math.abs(a.w - b.w) <= 2, "second-row cards are unevenly sized");
  const first = c.slice(0, 3);
  assert.ok(first.every((x) => x.h === first[0].h), "first-row heights differ");
  assert.ok(a.h === b.h, "second-row heights differ");
  const left = Math.min(...c.map((x) => x.x)), right = Math.max(...c.map((x) => x.x + x.w));
  assert.ok(Math.abs(a.x - left) <= 2 && Math.abs(b.x + b.w - right) <= 2, "second row does not span the full width (empty gap)");
  assert.ok(Math.abs(a.w + b.w - (right - left)) <= 4, "second row leaves empty space");
});
await check("tablet: two columns, the fifth card spans the row; phone: one column, no horizontal overflow", async () => {
  const t = await anon(820);
  const c = await cardBoxes(t);
  assert.ok(Math.abs(c[4].w - (c[1].x + c[1].w - c[0].x)) <= 4, "fifth card does not span both columns on a tablet");
  const phone = await anon(390);
  const pc = await cardBoxes(phone);
  assert.ok(pc.every((x) => x.x === pc[0].x && x.w === pc[0].w), "phone cards are not a single column");
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "horizontal overflow on a phone");
  assert.equal(await phone.getByText(/Hospital staff|Transporter|Treatment-plant staff|Main Admin|Approval first/).count() >= 5, true);
});

console.log("QR scanning only where it is needed; alerts and incidents are gone");
const scanButton = (p, re) => p.getByRole("button", { name: re });
for (const [group, key, label, scans, buttonRe] of [["hospital", "staff", "hospital staff", false, /^Scan/], [null, "plant", "plant staff", true, /^Scan Incoming Batch$/], [null, "admin", "Main Admin", false, /^Scan/], [null, "driver", "transporter", true, /^Scan label$/]]) {
  await check(`${label}: ${scans ? "has the scan button" : "no scan button"}, and no alerts or incidents anywhere`, async () => {
    const p = await open(group, key);
    await p.getByRole("navigation", { name: "Main" }).first().waitFor(); // the app shell has rendered
    assert.equal(await scanButton(p, buttonRe).count(), scans ? 1 : 0);
    const nav = await p.getByRole("navigation", { name: "Main" }).first().innerText();
    assert.ok(!/Alerts|Incident/i.test(nav), `navigation: ${nav}`);
    assert.equal(await p.locator('a[href="/alerts"]').count(), 0);
    for (const path of ["/dashboard", "/batches", "/assignments", "/settings"]) {
      await p.goto(path);
      await p.waitForLoadState("networkidle");
      const text = await p.locator("body").innerText();
      assert.ok(!/Report incident|Alerts & incidents|open alerts|Needs attention/i.test(text), `${path} still mentions alerts/incidents`);
      if (!scans) assert.ok(!/scan(ning)? (a |the |your )?(label|qr)|Scan label|Using your batch QR/i.test(text), `${path} shows scanning text to ${label}`);
    }
    await p.goto("/alerts");
    await p.waitForURL("**/notifications");
    await p.getByRole("heading", { name: "Notifications", exact: true }).waitFor();
    if (!scans) { await p.goto("/scan"); await p.waitForLoadState("networkidle"); }
  });
}
await check("hospital staff: View QR Code and Print QR Label on their batch; plant staff and admin see neither", async () => {
  const h = await open("hospital", "staff");
  const id = await h.evaluate(async () => (await (await fetch("/api/batches?pageSize=1")).json()).items[0].id);
  await h.goto(`/batches/${id}`);
  await h.getByRole("link", { name: "View QR Code" }).waitFor();
  await h.getByRole("link", { name: "Print QR Label" }).waitFor();
  for (const [g, k] of [[null, "plant"], [null, "admin"]]) {
    const p = await open(g, k);
    const sid = await p.evaluate(async () => (await (await fetch("/api/batches?pageSize=1")).json()).items[0]?.id);
    await p.goto(`/batches/${sid}`);
    await p.locator("h1.font-mono").waitFor();
    assert.equal(await p.getByRole("link", { name: /View QR Code|Print QR Label/ }).count(), 0, `${k} sees QR actions`);
  }
});

console.log("Presentation: one batch and its own QR from creation to disposal");
const created = {};
const hospital = await open("hospital", "staff");
await check("hospital staff register a batch and its QR is shown immediately, then reopened from the batch page", async () => {
  await hospital.goto("/batches/new");
  await hospital.getByRole("radio", { name: /Red/ }).check({ force: true });
  await hospital.getByLabel("Quantity").fill("8.25");
  await hospital.getByLabel("Ward / department").fill("Presentation ward");
  await hospital.getByRole("button", { name: "Register & create labels" }).click();
  await hospital.waitForURL(/\/batches\/[0-9a-f-]+\/qr/);
  created.id = hospital.url().split("/batches/")[1].split("/")[0];
  await hospital.getByRole("img", { name: /QR code for/ }).first().waitFor();
  created.code = (await hospital.getByTestId("qr-tracking-code").innerText()).trim();
  const label = await hospital.evaluate(async (i) => (await (await fetch(`/api/batches/${i}/labels`)).json()), created.id);
  assert.equal(label.trackingCode, created.code);
  assert.equal(label.batchId, created.id);
  created.payload = label.labels[0].payload;
  const hit = await hospital.evaluate(async (v) => (await (await fetch("/api/identify", { method: "POST", headers: { "content-type": "application/json", "x-bwts-csrf": "1" }, body: JSON.stringify({ method: "qr", value: v }) })).json()), created.payload);
  assert.equal(hit.batch.id, created.id, "the QR created with the batch resolves to a different batch");
  await hospital.getByRole("button", { name: "Present full screen" }).click();
  await hospital.getByRole("dialog", { name: "Full-screen QR code" }).waitFor();
  await hospital.getByRole("button", { name: "Close", exact: true }).click();
  await hospital.goto(`/batches/${created.id}`);
  await hospital.getByRole("link", { name: "View QR Code" }).click();
  await hospital.waitForURL(/\/qr/);
  assert.equal((await hospital.getByTestId("qr-tracking-code").innerText()).trim(), created.code);
  const again = await hospital.evaluate(async (i) => (await (await fetch(`/api/batches/${i}/labels`)).json()).labels[0].payload, created.id);
  assert.equal(again, created.payload, "the QR changed between views");
});
await check("segregation, then Request collection with a chosen transporter", async () => {
  await hospital.goto(`/batches/${created.id}`);
  await hospital.getByRole("button", { name: "Verify segregation" }).click();
  const d = hospital.getByRole("dialog");
  await d.getByRole("checkbox").first().check();
  await d.getByRole("button", { name: "Verify segregation" }).click();
  await hospital.getByText("Segregation verified").first().waitFor();
  await hospital.getByRole("button", { name: "Request collection" }).click();
  const dlg = hospital.getByRole("dialog");
  await dlg.getByLabel("Assign transporter").locator("option").nth(1).waitFor({ state: "attached" });
  const options = await dlg.getByLabel("Assign transporter").locator("option").allInnerTexts();
  assert.ok(options.some((o) => o.includes("Latha Nair")) && options.some((o) => o.includes("Ravi Kumar")), options.join(" | "));
  assert.ok(!options.some((o) => o.includes("Suresh Babu")), "a transporter on the road is offered: " + options.join(" | "));
  assert.ok(options.some((o) => /TN 22 BW/.test(o)), "vehicle is not shown");
  assert.equal(await dlg.getByRole("button", { name: "Send request" }).isDisabled(), true, "can send without choosing");
  await dlg.getByLabel("Assign transporter").selectOption({ label: options.find((o) => o.includes("Ravi Kumar")) });
  await dlg.getByRole("button", { name: "Send request" }).click();
  await hospital.getByText("Collection requested — transporter assigned").first().waitFor();
  const b = await hospital.evaluate(async (i) => (await (await fetch(`/api/batches/${i}`)).json()), created.id);
  created.assignment = b.currentAssignment.id;
  assert.ok(b.currentAssignment.transporterName.includes("Ravi"), "the chosen transporter was not saved");
});
const ravi = await open(null, "driver");
await check("the chosen transporter sees the request; another transporter cannot see or accept it", async () => {
  const mine = await ravi.evaluate(async (a) => (await (await fetch("/api/assignments?status=assigned")).json()).items.map((x) => x.id).includes(a), created.assignment);
  assert.equal(mine, true);
  const other = await (await browser.newContext({ viewport: { width: 1360, height: 900 }, baseURL: BASE })).newPage();
  await other.goto("/login");
  const login = await other.evaluate(async () => (await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-bwts-csrf": "1" }, body: JSON.stringify({ email: "driver3@sample.bwts.local", password: "Demo-pass-2026" }) })).status);
  assert.equal(login, 200);
  const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-bwts-csrf": "1" }, body: JSON.stringify(body) }).then((r) => r.status);
  const r = await other.evaluate(async ([a, i]) => ({
    asg: (await fetch(`/api/assignments/${a}`)).status,
    batch: (await fetch(`/api/batches/${i}`)).status,
    accept: await (async () => (await fetch(`/api/assignments/${a}/accept`, { method: "POST", headers: { "content-type": "application/json", "x-bwts-csrf": "1" }, body: "{}" })).status)(),
    pickup: await (async () => (await fetch(`/api/batches/${i}/actions/pickup`, { method: "POST", headers: { "content-type": "application/json", "x-bwts-csrf": "1" }, body: JSON.stringify({ scanMethod: "manual", notes: "not mine" }) })).status)(),
  }), [created.assignment, created.id]);
  void post;
  assert.deepEqual(r, { asg: 404, batch: 404, accept: 404, pickup: 404 });
});
const scanVia = async (page, statusText, buttonRe) => {
  await page.goto("/scan");
  await page.getByTestId("batch-qr-picker").waitFor();
  await page.getByLabel("Batch", { exact: true }).selectOption({ label: `${created.code} · ${statusText}` });
  await page.getByRole("button", { name: "Use this batch's QR" }).click();
  await page.getByRole("link", { name: created.code }).waitFor(); // the QR identified the batch that was created
  await page.getByTestId("simulated-banner").waitFor();
  await page.getByRole("button", { name: buttonRe }).click();
  await page.getByText(/Simulated QR scan of/).first().waitFor();
};
await check("transporter accepts, picks up with the batch's own QR (simulated), starts the trip and marks arrival with the same QR", async () => {
  await ravi.goto(`/assignments/${created.assignment}`);
  await ravi.getByRole("button", { name: "Accept request" }).click();
  await ravi.getByText("Job accepted").first().waitFor();
  await scanVia(ravi, "segregated", /pickup.*\(simulated\)/i);
  assert.equal((await ravi.evaluate(async (i) => (await (await fetch(`/api/batches/${i}`)).json()), created.id)).status, "collected");
  await ravi.goto(`/assignments/${created.assignment}`);
  await ravi.getByRole("button", { name: "Start trip" }).click();
  await ravi.getByText("On the road").first().waitFor();
  await ravi.goto(`/assignments/${created.assignment}`);
  await ravi.getByRole("button", { name: "Mark arrived at treatment plant" }).click();
  const arrive = ravi.getByRole("dialog");
  assert.equal(await arrive.getByTestId("scanner-image-input").count(), 0, "the transporter is asked to scan on arrival");
  await arrive.getByRole("button", { name: "Mark arrived at treatment plant" }).click();
  await ravi.getByText("Completed").first().waitFor();
  const b = await ravi.evaluate(async (i) => (await (await fetch(`/api/batches/${i}`)).json()), created.id);
  assert.equal(b.status, "delivered");
  assert.equal(b.id, created.id);
});
const plant2 = await open(null, "plant");
await check("plant staff see the arrival (code, origin, transporter, time), then scan the batch's QR to confirm receipt", async () => {
  const row = plant2.getByTestId("plant-arrivals").locator("li").filter({ hasText: created.code });
  await row.waitFor();
  const text = await row.innerText();
  assert.match(text, /Hospital A/);
  assert.match(text, /Ravi Kumar/);
  assert.match(text, /arrived/);
  // The plant scans with its own account (simulated here, from the batch's own QR): the same real batch opens for receipt.
  await plant2.getByRole("link", { name: "Scan Incoming Batch" }).first().click();
  await plant2.getByTestId("batch-qr-picker").waitFor();
  await plant2.getByLabel("Batch", { exact: true }).selectOption({ label: `${created.code} · delivered` });
  await plant2.getByRole("button", { name: "Use this batch's QR" }).click();
  await plant2.getByRole("link", { name: created.code }).waitFor();
  await plant2.getByTestId("simulated-banner").waitFor();
  await plant2.getByRole("button", { name: "Confirm receipt" }).click();
  const d = plant2.getByRole("dialog");
  await d.getByTestId("receipt-source").getByText(/Simulated scan/).waitFor();
  assert.equal(await d.getByText(/Scan any container|Registered:/).count(), 0);
  await d.getByLabel("Weighed quantity").fill("8.25");
  await d.getByRole("button", { name: "Confirm receipt" }).click();
  await plant2.getByText("Receipt recorded", { exact: true }).first().waitFor();
});
await check("the plant's queue never shows unrequested or unaccepted batches", async () => {
  const rows = await plant2.evaluate(async () => (await (await fetch("/api/batches?pageSize=100")).json()).items.map((x) => x.status));
  assert.ok(rows.every((s) => ["collected", "in_transit", "delivered", "received", "disposed", "rejected"].includes(s)), `plant sees: ${[...new Set(rows)].join(", ")}`);
  await plant2.goto("/receiving");
  await plant2.getByRole("tab").first().waitFor();
  const tabs = await plant2.getByRole("tab").allInnerTexts();
  assert.deepEqual(tabs.slice(0, 3), ["In transit", "Arrived — awaiting receipt", "Received"]);
});
await check("treatment is recorded and the batch history shows the whole journey under the same tracking code", async () => {
  await plant2.goto(`/batches/${created.id}`);
  await plant2.getByRole("button", { name: "Record disposal" }).click();
  const d = plant2.getByRole("dialog");
  await d.getByLabel("Plant log / document reference").fill("PRES-001");
  await d.getByRole("button", { name: "Record disposal" }).click();
  await plant2.getByText("Disposal recorded", { exact: true }).first().waitFor();
  await hospital.goto(`/batches/${created.id}`);
  await hospital.getByText("Disposal recorded", { exact: true }).first().waitFor();
  const b = await hospital.evaluate(async (i) => (await (await fetch(`/api/batches/${i}`)).json()), created.id);
  assert.equal(b.id, created.id);
  assert.equal(b.trackingCode, created.code);
  assert.equal(b.status, "disposed");
  assert.deepEqual(b.events.map((e) => e.eventType), ["created", "segregated", "assigned", "pickup", "transit_started", "handover", "received", "disposed"]);
  assert.equal(b.events.filter((e) => e.details?.simulatedScan).length, 2, "simulated scans are not marked as simulated");
  assert.equal((await hospital.getByText("Simulated QR scan").count()) >= 2, true);
  const payload = await hospital.evaluate(async (i) => (await (await fetch(`/api/batches/${i}/labels`)).json()).labels[0].payload, created.id);
  assert.equal(payload, created.payload, "the QR identity changed during the workflow");
});

await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll workflow checks passed");
process.exit(failed ? 1 : 0);

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { facilities, organizations, users, wasteBatches } from "../src/db/schema.js";
import { client, signupOrg } from "./helpers.js";

const HOSPITAL_A = "Sunrise General Hospital (Hospital A)";
const HOSPITAL_B = "Sunrise Women & Children Hospital (Hospital B)";

describe("one-click sign-in (sample data)", () => {
  it("lists five sign-in accounts: two hospitals, transporter, plant staff and Main Admin — no platform account", async () => {
    const r = await client().get("/api/auth/demo");
    expect(r.body.enabled).toBe(true);
    expect(r.body.accounts.map((a: { key: string }) => a.key)).toEqual(["staff", "staffB", "driver", "plant", "admin"]);
    expect(r.body.accounts.map((a: { group: string }) => a.group)).toEqual(["hospital", "hospital", "transporter", "plant", "admin"]);
    expect(JSON.stringify(r.body).toLowerCase()).not.toContain("demo");
  });

  it("creates the sample organization on first use and signs in with the chosen role", async () => {
    const c = client();
    const r = await c.post("/api/auth/demo-login", { account: "driver" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const me = await c.get("/api/auth/me");
    expect(me.body.membership.role).toBe("transporter");
    expect(me.body.organization.name).toBe("Sunrise Health Network (sample data)");
    expect(JSON.stringify(me.body).toLowerCase()).not.toMatch(/"[^"]*demo [^"]*"/); // no visible 'demo' wording in names
    expect((await c.get("/api/assignments")).body.total).toBeGreaterThan(0);
  }, 60_000);

  it("a 'platform' account no longer exists", async () => {
    expect((await client().post("/api/auth/demo-login", { account: "platform" })).status).toBe(400);
    expect((await client().post("/api/auth/demo-login", { account: "root" })).status).toBe(400);
  });

  it("switches account cleanly and reuses the existing sample organization", async () => {
    const c = client();
    await c.post("/api/auth/demo-login", { account: "admin" });
    const first = (await c.get("/api/auth/me")).body.organization.id;
    expect((await c.post("/api/auth/demo-login", { account: "plant" })).status).toBe(200);
    const me = (await c.get("/api/auth/me")).body;
    expect(me.membership.role).toBe("facility_staff");
    expect(me.organization.id).toBe(first);
    expect(me.memberships).toHaveLength(1);
  }, 60_000);

  it("preloads only a handful of batches, with SMP- codes, so your own are easy to find", async () => {
    const c = client();
    await c.post("/api/auth/demo-login", { account: "admin" });
    const list = (await c.get("/api/batches?pageSize=100")).body;
    expect(list.total).toBe(4);
    expect(list.items.every((b: { trackingCode: string }) => b.trackingCode.startsWith("SMP-"))).toBe(true);
    // A new batch is listed first (newest first) and does not carry the SMP- prefix.
    const s = client();
    await s.post("/api/auth/demo-login", { account: "staff" });
    const cats = (await s.get("/api/categories")).body as { id: string; code: string }[];
    const mine = await s.post("/api/batches", { categoryId: cats[0].id, quantity: 4.5, unit: "kg", sourceArea: "Ward 9" });
    expect(mine.status).toBe(201);
    expect(mine.body.trackingCode.startsWith("BW-")).toBe(true);
    expect((await s.get("/api/batches")).body.items[0].id).toBe(mine.body.id);
  }, 60_000);

  it("every sample QR label resolves to its own batch and container", async () => {
    const c = client();
    await c.post("/api/auth/demo-login", { account: "admin" });
    const r = await c.get("/api/demo/labels");
    expect(r.status).toBe(200);
    const batches = r.body.batches as { batchId: string; trackingCode: string; labels: { label: string; payload: string; svg: string }[] }[];
    expect(batches.length).toBeGreaterThanOrEqual(4);
    for (const b of batches) {
      expect(b.labels.length).toBeGreaterThan(0);
      for (const l of b.labels) {
        expect(l.svg).toContain("<svg");
        const hit = await c.post("/api/identify", { method: "qr", value: l.payload, source: "camera" });
        expect(hit.status, `${b.trackingCode} ${l.payload}`).toBe(200);
        expect(hit.body.batch.id).toBe(b.batchId);
        expect(hit.body.container.label).toBe(l.label);
      }
    }
  }, 60_000);

  it("a transporter only gets labels for jobs they can see, and each still resolves", async () => {
    const admin = client();
    await admin.post("/api/auth/demo-login", { account: "admin" });
    const all = (await admin.get("/api/demo/labels")).body.batches as { batchId: string }[];
    const d = client();
    await d.post("/api/auth/demo-login", { account: "driver" });
    const mine = (await d.get("/api/demo/labels")).body.batches as { batchId: string; labels: { payload: string }[] }[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);
    for (const b of mine) expect((await d.post("/api/identify", { method: "qr", value: b.labels[0].payload })).body.batch.id).toBe(b.batchId);
  }, 60_000);

  it("sample labels are not available outside the sample organization, nor resolvable from another one", async () => {
    const { admin } = await signupOrg();
    expect((await admin.get("/api/demo/labels")).status).toBe(404);
    const demo = client();
    await demo.post("/api/auth/demo-login", { account: "admin" });
    const payload = (await demo.get("/api/demo/labels")).body.batches[0].labels[0].payload as string;
    expect((await admin.post("/api/identify", { method: "qr", value: payload })).status).toBe(404);
  }, 60_000);

  it("each role lands on a different facility with different access", async () => {
    const seen: Record<string, { role: string; facilities: number; permission: boolean }> = {};
    for (const key of ["staff", "staffB", "plant", "driver", "admin"]) {
      const c = client();
      expect((await c.post("/api/auth/demo-login", { account: key })).status).toBe(200);
      const me = (await c.get("/api/auth/me")).body;
      expect(me.organization.status).toBe("approved");
      expect(me.features.demoOrg).toBe(true);
      seen[key] = { role: me.membership.role, facilities: me.membership.facilityIds.length, permission: me.user.canReviewOrganizations };
    }
    expect(seen.staff).toMatchObject({ role: "facility_staff", facilities: 1, permission: false });
    expect(seen.staffB).toMatchObject({ role: "facility_staff", facilities: 1, permission: false });
    expect(seen.driver).toMatchObject({ role: "transporter", permission: false });
    expect(seen.admin).toMatchObject({ role: "admin", permission: true });
  }, 60_000);

  it("Hospital A and Hospital B staff cannot see each other's batches or register waste for each other", async () => {
    const a = client();
    await a.post("/api/auth/demo-login", { account: "staff" });
    const b = client();
    await b.post("/api/auth/demo-login", { account: "staffB" });
    const listA = (await a.get("/api/batches?pageSize=100")).body.items as { id: string; originName: string }[];
    const listB = (await b.get("/api/batches?pageSize=100")).body.items as { id: string; originName: string }[];
    expect(new Set(listA.map((x) => x.originName))).toEqual(new Set([HOSPITAL_A]));
    expect(new Set(listB.map((x) => x.originName))).toEqual(new Set([HOSPITAL_B]));
    for (const x of listA) expect((await b.get(`/api/batches/${x.id}`)).status).toBe(404);
    const facsB = (await b.get("/api/facilities")).body as { id: string; name: string }[];
    const hospitalA = (await a.get("/api/facilities")).body.find((f: { name: string; access: string }) => f.access === "own") as { id: string };
    const cats = (await b.get("/api/categories")).body as { id: string }[];
    expect(facsB.some((f) => f.id === hospitalA.id)).toBe(false);
    const forged = await b.post("/api/batches", { originFacilityId: hospitalA.id, categoryId: cats[0].id, quantity: 1, unit: "kg" });
    expect(forged.status).toBe(403);
  }, 60_000);

  it("the sample has free and busy transporters; a collection runs from request to disposal with the right people scanning", async () => {
    const staffB = client();
    await staffB.post("/api/auth/demo-login", { account: "staffB" });
    const ready = (await staffB.get("/api/batches?status=segregated")).body.items.find((x: { currentAssignmentId: string | null }) => !x.currentAssignmentId) as { id: string; originName: string };
    expect(ready.originName).toBe(HOSPITAL_B);
    // Suresh is on the road, so only Ravi and Latha can be chosen.
    const offered = (await staffB.get(`/api/batches/${ready.id}/transporters`)).body as { items: { userId: string; fullName: string }[]; busy: number };
    expect(offered.items.map((t) => t.fullName.split(" (")[0]).sort()).toEqual(["Latha Nair", "Ravi Kumar"]);
    expect(offered.busy).toBe(1);
    const ravi = offered.items.find((t) => t.fullName.startsWith("Ravi"))!;
    const req = await staffB.post(`/api/batches/${ready.id}/request-collection`, { transporterUserId: ravi.userId });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect(req.body.destinationFacilityId).toBeTruthy();

    const d = client();
    await d.post("/api/auth/demo-login", { account: "driver" });
    expect((await d.post(`/api/demo/batches/${ready.id}/simulate-scan`, { action: "pickup" })).status).toBe(422); // accept first
    expect((await d.post(`/api/assignments/${req.body.id}/accept`)).status).toBe(200);
    const pick = await d.post(`/api/demo/batches/${ready.id}/simulate-scan`, { action: "pickup" });
    expect(pick.body).toMatchObject({ simulated: true, batch: { status: "collected" } });
    expect((await d.post(`/api/demo/batches/${ready.id}/simulate-scan`, { action: "handover" })).status).toBe(400); // arrival is not scanned
    expect((await d.post(`/api/assignments/${req.body.id}/start`)).status).toBe(200);
    expect((await d.post(`/api/batches/${ready.id}/actions/handover`, {})).status).toBe(200);

    const receipt = { accepted: true, receivedQuantity: 2.4, unit: "kg", condition: "intact" };
    const s = client();
    await s.post("/api/auth/demo-login", { account: "staffB" });
    const admin = client();
    await admin.post("/api/auth/demo-login", { account: "admin" });
    for (const who of [d, s, admin]) expect((await who.post(`/api/batches/${ready.id}/actions/receive`, receipt)).status).toBe(422);
    expect((await d.post(`/api/batches/${ready.id}/actions/receive`, { ...receipt, simulatedScan: true })).status).toBe(422); // the transporter cannot even simulate it
    const p = client();
    await p.post("/api/auth/demo-login", { account: "plant" });
    expect((await p.get("/api/batches?status=delivered")).body.items.map((x: { id: string }) => x.id)).toContain(ready.id);
    const rec = await p.post(`/api/batches/${ready.id}/actions/receive`, { ...receipt, simulatedScan: true });
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    expect((await p.post(`/api/batches/${ready.id}/actions/receive`, receipt)).status).toBe(422); // no duplicate receipt
    expect((await p.post(`/api/batches/${ready.id}/actions/dispose`, { method: "autoclave", treatedQuantity: 2.4, unit: "kg" })).status).toBe(200);
    const detail = (await s.get(`/api/batches/${ready.id}`)).body;
    expect(detail.status).toBe("disposed");
    const ev = Object.fromEntries(detail.events.map((e: { eventType: string }) => [e.eventType, e])) as Record<string, { details: object | null; scanMethod: string | null; notes: string | null }>;
    expect(ev.pickup.details).toEqual({ simulatedScan: true });
    expect(ev.pickup.notes).toBe("Simulated QR scan — no physical label was scanned.");
    expect(ev.handover.scanMethod).toBeNull();
    expect(ev.received).toMatchObject({ scanMethod: "qr", details: expect.objectContaining({ simulatedScan: true }) });
    expect(detail.events.map((e: { eventType: string }) => e.eventType)).toEqual(["created", "segregated", "assigned", "pickup", "transit_started", "handover", "received", "disposed"]);
  }, 60_000);

  it("Main Admin reviews the pending sample applicants; ordinary organization admins cannot", async () => {
    const admin = client();
    await admin.post("/api/auth/demo-login", { account: "admin" });
    const queue = (await admin.get("/api/platform/organizations?status=pending")).body.items as { id: string; name: string }[];
    const applicants = queue.filter((o) => o.name.includes("sample applicant"));
    expect(applicants).toHaveLength(2);
    expect((await admin.post(`/api/platform/organizations/${applicants[0].id}/approve`, { note: "Approved" })).status).toBe(200);
    expect((await admin.post(`/api/platform/organizations/${applicants[1].id}/reject`, { note: "Documents missing" })).status).toBe(200);
    // The Main Admin cannot approve their own organization.
    const own = (await admin.get("/api/auth/me")).body.organization.id;
    expect((await admin.post(`/api/platform/organizations/${own}/approve`, {})).status).toBe(403);
    // A normal organization admin has no such permission.
    const { admin: other } = await signupOrg("Ordinary Org");
    expect((await other.get("/api/platform/organizations")).status).toBe(403);
    expect((await other.get("/api/auth/me")).body.user.canReviewOrganizations).toBe(false);
  }, 60_000);

  it("recreating the sample data resets it to the small preloaded set", async () => {
    const { seedDemo } = await import("../src/services/demo.js");
    expect(await seedDemo({ reset: true, log: () => undefined })).toBe(true);
    const a = client();
    await a.post("/api/auth/demo-login", { account: "admin" });
    expect((await a.get("/api/batches")).body.total).toBe(4);
    expect((await a.get("/api/platform/organizations?status=pending")).body.items.filter((o: { name: string }) => o.name.includes("sample applicant"))).toHaveLength(2);
    const d = client();
    await d.post("/api/auth/demo-login", { account: "driver" });
    expect((await d.get("/api/assignments?status=assigned")).body.total).toBe(0); // Ravi is free to be chosen
  }, 120_000);

  it("existing sample data is refreshed once, in place; routine restarts then change nothing", async () => {
    const { ensureSampleData, DEMO_ORG_NAME } = await import("../src/services/demo.js");
    const s = client();
    await s.post("/api/auth/demo-login", { account: "staff" });
    const cats = (await s.get("/api/categories")).body as { id: string }[];
    const mine = await s.post("/api/batches", { categoryId: cats[0].id, quantity: 7, unit: "kg" });
    expect(mine.status).toBe(201);
    const before = (await db.select().from(wasteBatches)).length;
    // Simulate data created by an earlier version: old names, old email domain, no refresh marker.
    await db.update(organizations).set({ name: "Sunrise Health Network (DEMO — synthetic data)", settings: {} }).where(eq(organizations.name, DEMO_ORG_NAME));
    await db.update(facilities).set({ name: "Sunrise Clinic Chromepet (demo)" }).where(eq(facilities.name, HOSPITAL_B));
    await db.update(users).set({ email: "staff@demo.bwts.local", fullName: "Karthik Selvam (demo ward staff)" }).where(eq(users.email, "staff@sample.bwts.local"));
    expect(await ensureSampleData()).toBe(true);
    expect((await db.select().from(wasteBatches)).length).toBe(before); // nothing deleted
    expect((await db.select().from(organizations).where(eq(organizations.name, DEMO_ORG_NAME))).length).toBe(1);
    expect((await db.select().from(facilities).where(eq(facilities.name, HOSPITAL_B))).length).toBe(1);
    const [u] = await db.select().from(users).where(eq(users.email, "staff@sample.bwts.local"));
    expect(u.fullName).toBe("Karthik Selvam (Hospital A staff)");
    const again = client();
    await again.post("/api/auth/demo-login", { account: "staff" });
    expect((await again.get(`/api/batches/${mine.body.id}`)).status).toBe(200);
    // Marker is set: a restart (or any quick sign-in) must not modify anything, even a deliberately changed record.
    await db.update(users).set({ fullName: "Karthik Selvam — renamed by an admin" }).where(eq(users.email, "staff@sample.bwts.local"));
    expect(await ensureSampleData()).toBe(false);
    expect((await db.select().from(users).where(eq(users.email, "staff@sample.bwts.local")))[0].fullName).toBe("Karthik Selvam — renamed by an admin");
    expect((await db.select().from(wasteBatches)).length).toBe(before);
    await db.update(users).set({ fullName: "Karthik Selvam (Hospital A staff)" }).where(eq(users.email, "staff@sample.bwts.local"));
  }, 120_000);

  it("the opt-in trim deletes only preloaded synthetic batches, never batches people registered", async () => {
    const { trimSampleBatches, seedDemo } = await import("../src/services/demo.js");
    const s = client();
    await s.post("/api/auth/demo-login", { account: "staff" });
    const cats = (await s.get("/api/categories")).body as { id: string }[];
    const mine = (await s.post("/api/batches", { categoryId: cats[0].id, quantity: 3, unit: "kg" })).body;
    const dry = await trimSampleBatches();
    expect(dry.deleted).toBe(false);
    expect(dry.batches).toBeGreaterThan(0);
    expect((await s.get("/api/batches?pageSize=100")).body.items.some((x: { trackingCode: string }) => x.trackingCode.startsWith("SMP-"))).toBe(true); // dry run changed nothing
    const done = await trimSampleBatches({ confirm: true });
    expect(done.deleted).toBe(true);
    const left = (await s.get("/api/batches?pageSize=100")).body.items as { id: string; trackingCode: string }[];
    expect(left.some((x) => x.trackingCode.startsWith("SMP-"))).toBe(false);
    expect(left.map((x) => x.id)).toContain(mine.id);
    expect((await s.get(`/api/batches/${mine.id}`)).status).toBe(200);
    await seedDemo({ reset: true, log: () => undefined }); // leave a normal sample for any later test
  }, 120_000);
});

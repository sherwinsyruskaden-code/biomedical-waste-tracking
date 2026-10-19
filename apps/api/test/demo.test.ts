import { describe, expect, it } from "vitest";
import { client, signupOrg } from "./helpers.js";

describe("one-click demo sign-in", () => {
  it("lists demo accounts when DEMO_MODE is on", async () => {
    const r = await client().get("/api/auth/demo");
    expect(r.body.enabled).toBe(true);
    expect(r.body.accounts.map((a: { key: string }) => a.key)).toEqual(["staff", "staffB", "driver", "plant", "admin", "platform"]);
  });

  it("creates the synthetic demo org on first use and signs in with the chosen role", async () => {
    const c = client();
    const r = await c.post("/api/auth/demo-login", { account: "driver" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const me = await c.get("/api/auth/me");
    expect(me.body.membership.role).toBe("transporter");
    expect(me.body.organization.name).toMatch(/DEMO/);
    const jobs = await c.get("/api/assignments");
    expect(jobs.body.total).toBeGreaterThan(0);
  }, 60_000);

  it("switches account cleanly and reuses the existing demo org", async () => {
    const c = client();
    await c.post("/api/auth/demo-login", { account: "admin" });
    const first = (await c.get("/api/auth/me")).body.organization.id;
    expect((await c.post("/api/auth/demo-login", { account: "plant" })).status).toBe(200);
    const me = (await c.get("/api/auth/me")).body;
    expect(me.membership.role).toBe("facility_staff");
    expect(me.organization.id).toBe(first);
    expect(me.memberships).toHaveLength(1);
  }, 60_000);

  it("rejects unknown demo accounts", async () => {
    expect((await client().post("/api/auth/demo-login", { account: "root" })).status).toBe(400);
  });

  it("every demo QR label resolves to its own batch and container", async () => {
    const c = client();
    await c.post("/api/auth/demo-login", { account: "admin" });
    const r = await c.get("/api/demo/labels");
    expect(r.status).toBe(200);
    const batches = r.body.batches as { batchId: string; trackingCode: string; labels: { label: string; payload: string; svg: string }[] }[];
    expect(batches.length).toBeGreaterThanOrEqual(6);
    let checked = 0;
    for (const b of batches) {
      expect(b.labels.length).toBeGreaterThan(0);
      for (const l of b.labels) {
        expect(l.svg).toContain("<svg");
        const hit = await c.post("/api/identify", { method: "qr", value: l.payload, source: "camera" });
        expect(hit.status, `${b.trackingCode} ${l.payload}`).toBe(200);
        expect(hit.body.batch.id).toBe(b.batchId);
        expect(hit.body.batch.trackingCode).toBe(b.trackingCode);
        expect(hit.body.container.label).toBe(l.label);
        expect(hit.body.batch.category.name).toBeTruthy();
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(batches.length);
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

  it("demo labels are not available outside the demo organization", async () => {
    const { admin } = await signupOrg();
    expect((await admin.get("/api/demo/labels")).status).toBe(404);
  });

  it("a demo QR label from another organization cannot be resolved", async () => {
    const demo = client();
    await demo.post("/api/auth/demo-login", { account: "admin" });
    const payload = (await demo.get("/api/demo/labels")).body.batches[0].labels[0].payload as string;
    const { admin } = await signupOrg();
    expect((await admin.post("/api/identify", { method: "qr", value: payload })).status).toBe(404);
  }, 60_000);

  it("each demo role signs into a different facility with different access", async () => {
    const roles: Record<string, { role: string | null; facilities: number }> = {};
    for (const key of ["staff", "staffB", "plant", "driver", "admin"]) {
      const c = client();
      expect((await c.post("/api/auth/demo-login", { account: key })).status).toBe(200);
      const me = (await c.get("/api/auth/me")).body;
      expect(me.organization.status).toBe("approved");
      expect(me.features.demoOrg).toBe(true);
      roles[key] = { role: me.membership.role, facilities: me.membership.facilityIds.length };
    }
    expect(roles.staff).toEqual({ role: "facility_staff", facilities: 1 });
    expect(roles.staffB).toEqual({ role: "facility_staff", facilities: 1 });
    expect(roles.driver.role).toBe("transporter");
    expect(roles.admin.role).toBe("admin");
  }, 60_000);

  it("Hospital A and Hospital B demo staff cannot see each other's batches", async () => {
    const a = client();
    await a.post("/api/auth/demo-login", { account: "staff" });
    const b = client();
    await b.post("/api/auth/demo-login", { account: "staffB" });
    const listA = (await a.get("/api/batches?pageSize=100")).body.items as { id: string; originName: string }[];
    const listB = (await b.get("/api/batches?pageSize=100")).body.items as { id: string; originName: string }[];
    expect(listA.length).toBeGreaterThan(0);
    expect(listB.length).toBeGreaterThan(0);
    expect(new Set(listA.map((x) => x.originName))).toEqual(new Set(["Sunrise General Hospital (demo · Hospital A)"]));
    expect(new Set(listB.map((x) => x.originName))).toEqual(new Set(["Sunrise Women & Children Hospital (demo · Hospital B)"]));
    for (const x of listA.slice(0, 3)) expect((await b.get(`/api/batches/${x.id}`)).status).toBe(404);
  }, 60_000);

  it("the transporter completes a collection with simulated QR scans, and the plant receives and disposes", async () => {
    const d = client();
    await d.post("/api/auth/demo-login", { account: "driver" });
    const jobs = (await d.get("/api/assignments?status=assigned")).body.items as { id: string; originName: string; destinationName: string }[];
    expect(jobs.length).toBe(1);
    expect(jobs[0].originName).toMatch(/Hospital B/);
    expect(jobs[0].destinationName).toMatch(/treatment plant/);
    const job = (await d.get(`/api/assignments/${jobs[0].id}`)).body;
    const batchId = job.batches[0].id as string;
    // Not before accepting — the real rules apply to simulated scans too.
    expect((await d.post(`/api/demo/batches/${batchId}/simulate-scan`, { action: "pickup" })).status).toBe(422);
    expect((await d.post(`/api/assignments/${job.id}/accept`)).status).toBe(200);
    const pick = await d.post(`/api/demo/batches/${batchId}/simulate-scan`, { action: "pickup" });
    expect(pick.status, JSON.stringify(pick.body)).toBe(200);
    expect(pick.body).toMatchObject({ simulated: true, batch: { status: "collected" } });
    expect((await d.post(`/api/assignments/${job.id}/start`)).status).toBe(200);
    const drop = await d.post(`/api/demo/batches/${batchId}/simulate-scan`, { action: "handover" });
    expect(drop.body.batch.status).toBe("delivered");
    // Hospital staff cannot use the transporter's simulator.
    const s = client();
    await s.post("/api/auth/demo-login", { account: "staffB" });
    expect((await s.post(`/api/demo/batches/${batchId}/simulate-scan`, { action: "handover" })).status).toBe(403);
    const p = client();
    await p.post("/api/auth/demo-login", { account: "plant" });
    expect((await p.post(`/api/batches/${batchId}/actions/receive`, { accepted: true, receivedQuantity: 2.4, unit: "kg", condition: "intact" })).status).toBe(200);
    expect((await p.post(`/api/batches/${batchId}/actions/dispose`, { method: "autoclave", treatedQuantity: 2.4, unit: "kg" })).status).toBe(200);
    const detail = (await s.get(`/api/batches/${batchId}`)).body;
    const scans = detail.events.filter((e: { eventType: string }) => e.eventType === "pickup" || e.eventType === "handover");
    expect(scans).toHaveLength(2);
    for (const e of scans) {
      expect(e.scanMethod).toBe("qr");
      expect(e.details).toEqual({ simulatedScan: true });
      expect(e.notes).toMatch(/Simulated QR scan/);
    }
    expect(detail.status).toBe("disposed");
  }, 60_000);

  it("the demo platform administrator reviews the pending demo applicants", async () => {
    const p = client();
    const r = await p.post("/api/auth/demo-login", { account: "platform" });
    expect(r.body.home).toBe("/platform");
    const me = (await p.get("/api/auth/me")).body;
    expect(me.user.isPlatformAdmin).toBe(true);
    expect(me.membership).toBeNull();
    const queue = (await p.get("/api/platform/organizations?status=pending")).body.items as { id: string; name: string; applicant: { email: string } }[];
    const demoApplicants = queue.filter((o) => o.name.includes("DEMO applicant"));
    expect(demoApplicants).toHaveLength(2);
    expect((await p.post(`/api/platform/organizations/${demoApplicants[0].id}/approve`, { note: "Demo approval" })).status).toBe(200);
    expect((await p.post(`/api/platform/organizations/${demoApplicants[1].id}/reject`, { note: "Demo rejection: documents missing" })).status).toBe(200);
    // The organization admin of the demo network is not a platform admin.
    const admin = client();
    await admin.post("/api/auth/demo-login", { account: "admin" });
    expect((await admin.get("/api/platform/organizations")).status).toBe(403);
  }, 60_000);

  it("demo data can be recreated reliably", async () => {
    const { seedDemo } = await import("../src/services/demo.js");
    expect(await seedDemo({ reset: true, log: () => undefined })).toBe(true);
    const p = client();
    await p.post("/api/auth/demo-login", { account: "platform" });
    const pending = (await p.get("/api/platform/organizations?status=pending")).body.items.filter((o: { name: string }) => o.name.includes("DEMO applicant"));
    expect(pending).toHaveLength(2);
    const d = client();
    await d.post("/api/auth/demo-login", { account: "driver" });
    expect((await d.get("/api/assignments?status=assigned")).body.total).toBe(1);
  }, 120_000);
});

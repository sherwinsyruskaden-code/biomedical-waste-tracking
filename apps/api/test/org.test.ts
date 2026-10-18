import { beforeAll, describe, expect, it } from "vitest";
import { PASSWORD, addMember, client, signupOrg, uniq, type Client } from "./helpers.js";

let a: Awaited<ReturnType<typeof signupOrg>>;
let b: Awaited<ReturnType<typeof signupOrg>>;
let batchA: { id: string };
let staffA: Client;

beforeAll(async () => {
  a = await signupOrg("Org A");
  b = await signupOrg("Org B");
  staffA = (await addMember(a.admin, "facility_staff", [a.hospitalId])).c;
  const yellow = a.categories.find((c) => c.code === "YELLOW")!.id;
  batchA = (await staffA.post("/api/batches", { originFacilityId: a.hospitalId, categoryId: yellow, quantity: 3, unit: "kg" })).body;
});

describe("organization isolation", () => {
  it("never exposes another organization's records, even by direct id", async () => {
    expect((await b.admin.get(`/api/batches/${batchA.id}`)).status).toBe(404);
    expect((await b.admin.get(`/api/batches/${batchA.id}/labels`)).status).toBe(404);
    expect((await b.admin.post(`/api/batches/${batchA.id}/actions/segregate`, { confirmSegregation: true })).status).toBe(404);
    const list = await b.admin.get("/api/batches?pageSize=100");
    expect(list.body.items.find((x: { id: string }) => x.id === batchA.id)).toBeUndefined();
    const facs = await b.admin.get("/api/facilities");
    expect(facs.body.find((f: { id: string }) => f.id === a.hospitalId)).toBeUndefined();
    expect((await b.admin.patch(`/api/facilities/${a.hospitalId}`, { name: "Hijack", type: "generator", address: "Somewhere 1" })).status).toBe(404);
    const report = await b.admin.get("/api/reports?type=batches");
    expect(report.body.rows.length).toBe(0);
  });

  it("does not resolve another organization's QR labels", async () => {
    const lbl = (await staffA.get(`/api/batches/${batchA.id}/labels`)).body.labels[0];
    const r = await b.admin.post("/api/identify", { method: "qr", value: lbl.payload });
    expect(r.status).toBe(404);
  });

  it("cannot assign another organization's batches, facilities or transporters", async () => {
    const tB = await addMember(b.admin, "transporter");
    const r = await b.admin.post("/api/assignments", { transporterUserId: tB.userId, originFacilityId: a.hospitalId, destinationFacilityId: b.plantId, batchIds: [batchA.id], scheduledPickupAt: new Date().toISOString(), dueBy: new Date(Date.now() + 3600_000).toISOString() });
    expect(r.status).toBe(400);
  });

  it("rejects malformed ids without leaking errors", async () => {
    const r = await a.admin.get("/api/batches/not-a-uuid");
    expect(r.status).toBe(400);
  });
});

describe("roles and team management", () => {
  it("enforces admin-only operations on the backend", async () => {
    expect((await staffA.post("/api/facilities", { name: "Sneaky", type: "generator", address: "1 Road Street" })).status).toBe(403);
    expect((await staffA.post("/api/invitations", { email: `x-${uniq()}@x.test`, role: "admin" })).status).toBe(403);
    expect((await staffA.put("/api/organization/settings", {})).status).toBe(403);
    expect((await staffA.get("/api/audit-logs")).status).toBe(403);
    const members = await staffA.get("/api/members");
    expect(members.body[0]).not.toHaveProperty("email"); // contact details are admin-only
  });

  it("staff without a facility assignment cannot register waste there", async () => {
    const s = await addMember(a.admin, "facility_staff", []);
    const yellow = a.categories.find((c) => c.code === "YELLOW")!.id;
    const r = await s.c.post("/api/batches", { originFacilityId: a.hospitalId, categoryId: yellow, quantity: 1, unit: "kg" });
    expect(r.status).toBe(403);
  });

  it("keeps at least one active admin and disables members immediately", async () => {
    const me = await a.admin.get("/api/members");
    const adminRow = me.body.find((m: { role: string }) => m.role === "admin");
    const demote = await a.admin.patch(`/api/members/${adminRow.id}`, { role: "facility_staff", status: "active", facilityIds: [] });
    expect(demote.status).toBe(400);
    const t = await addMember(a.admin, "transporter");
    const row = (await a.admin.get("/api/members")).body.find((m: { userId: string }) => m.userId === t.userId);
    expect((await t.c.get("/api/assignments")).status).toBe(200);
    await a.admin.patch(`/api/members/${row.id}`, { role: "transporter", status: "disabled", facilityIds: [] });
    expect((await t.c.get("/api/assignments")).status).toBe(403);
  });

  it("invitation links are single-use and an existing account must sign in to accept", async () => {
    const email = `dual-${uniq()}@x.test`;
    const inv = await a.admin.post("/api/invitations", { email, role: "facility_staff", facilityIds: [a.hospitalId] });
    const token = inv.body.link.split("/invite/")[1];
    const info = await client().get(`/api/invitations/lookup/${token}`);
    expect(info.body.existingAccount).toBe(false);
    const c = client();
    expect((await c.post("/api/invitations/accept", { token, fullName: "New Person", password: PASSWORD, acceptTerms: true })).status).toBe(200);
    expect((await client().post("/api/invitations/accept", { token, fullName: "Again", password: PASSWORD, acceptTerms: true })).status).toBe(400);
    // Now invite the same person to org B: they must be signed in as themselves
    const inv2 = await b.admin.post("/api/invitations", { email, role: "transporter" });
    const token2 = inv2.body.link.split("/invite/")[1];
    expect((await client().post("/api/invitations/accept", { token: token2, acceptTerms: true })).status).toBe(403);
    expect((await c.post("/api/invitations/accept", { token: token2, acceptTerms: true })).status).toBe(200);
    const me = await c.get("/api/auth/me");
    expect(me.body.memberships).toHaveLength(2);
    expect(me.body.membership.role).toBe("transporter"); // switched to the new org
    const back = me.body.memberships.find((m: { role: string }) => m.role === "facility_staff");
    expect((await c.post("/api/auth/switch-organization", { organizationId: back.organizationId })).status).toBe(200);
    expect((await c.get("/api/auth/me")).body.membership.role).toBe("facility_staff");
  });

  it("records an audit trail for critical operations", async () => {
    const logs = await a.admin.get("/api/audit-logs?pageSize=100");
    const actions = logs.body.items.map((l: { action: string }) => l.action);
    expect(actions).toContain("auth.signup");
    expect(actions).toContain("invitation.create");
    expect(actions).toContain("batch.create");
  });
});

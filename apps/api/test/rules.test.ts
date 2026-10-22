import { beforeAll, describe, expect, it } from "vitest";
import { addMember, client, lastMailTo, PASSWORD, registrationFacility, signupOrg, uniq, type Client } from "./helpers.js";

describe("minimum password length is 4 everywhere", () => {
  const signup = (c: Client, password: string) => c.post("/api/auth/signup", { fullName: "Pat Tester", email: `pw-${uniq()}@x.test`, password, confirmPassword: password, organization: { name: `PW Org ${uniq()}`, type: "clinic" }, facility: registrationFacility(), acceptTerms: true });

  it("registration", async () => {
    const short = await signup(client(), "abc");
    expect(short.status).toBe(400);
    expect(short.body.error.details.fields.password).toMatch(/at least 4/);
    expect((await signup(client(), "abcd")).status).toBe(201);
    expect((await signup(client(), "1234")).status).toBe(201);
  });

  it("password change", async () => {
    const c = client();
    const email = `chg-${uniq()}@x.test`;
    await c.post("/api/auth/signup", { fullName: "Pat Tester", email, password: PASSWORD, confirmPassword: PASSWORD, organization: { name: `Chg ${uniq()}`, type: "clinic" }, facility: registrationFacility(), acceptTerms: true });
    expect((await c.post("/api/auth/change-password", { currentPassword: PASSWORD, newPassword: "abc" })).status).toBe(400);
    expect((await c.post("/api/auth/change-password", { currentPassword: PASSWORD, newPassword: "wxyz" })).status).toBe(200);
    expect((await client().post("/api/auth/login", { email, password: "wxyz" })).status).toBe(200);
  });

  it("password reset", async () => {
    const c = client();
    const email = `rst-${uniq()}@x.test`;
    await c.post("/api/auth/signup", { fullName: "Pat Tester", email, password: PASSWORD, confirmPassword: PASSWORD, organization: { name: `Rst ${uniq()}`, type: "clinic" }, facility: registrationFacility(), acceptTerms: true });
    const anon = client();
    await anon.post("/api/auth/forgot-password", { email });
    const token = lastMailTo(email)!.text.match(/token=([A-Za-z0-9_-]+)/)![1];
    expect((await anon.post("/api/auth/reset-password", { token, password: "abc" })).status).toBe(400);
    expect((await anon.post("/api/auth/reset-password", { token, password: "pass" })).status).toBe(200);
    expect((await client().post("/api/auth/login", { email, password: "pass" })).status).toBe(200);
  });

  it("invitation acceptance", async () => {
    const { admin } = await signupOrg("Invite PW");
    const email = `inv-${uniq()}@x.test`;
    const inv = await admin.post("/api/invitations", { email, role: "transporter", facilityIds: [] });
    const token = String(inv.body.link).split("/invite/")[1];
    expect((await client().post("/api/invitations/accept", { token, fullName: "Tia T", password: "abc", acceptTerms: true })).status).toBe(400);
    expect((await client().post("/api/invitations/accept", { token, fullName: "Tia T", password: "abcd", acceptTerms: true })).status).toBe(200);
  });
});

describe("batch registration: origin, quantity, notes", () => {
  let org: Awaited<ReturnType<typeof signupOrg>>;
  let hospitalB: string;
  let staffA: Client, staffB: Client, plantStaff: Client, multi: Client;
  const yellow = () => org.categories.find((c) => c.code === "YELLOW")!.id;
  const reg = (c: Client, body: object) => c.post("/api/batches", { categoryId: yellow(), quantity: 5, unit: "kg", ...body });

  beforeAll(async () => {
    org = await signupOrg("Origin Rules");
    hospitalB = (await org.admin.post("/api/facilities", { name: "Hospital B2", type: "generator", address: "22 Second Street, Chennai" })).body.id;
    staffA = (await addMember(org.admin, "facility_staff", [org.hospitalId])).c;
    staffB = (await addMember(org.admin, "facility_staff", [hospitalB])).c;
    plantStaff = (await addMember(org.admin, "facility_staff", [org.plantId])).c;
    multi = (await addMember(org.admin, "facility_staff", [org.hospitalId, hospitalB])).c;
  });

  it("the origin is derived from the user's own facility", async () => {
    const a = await reg(staffA, {});
    expect(a.status).toBe(201);
    expect(a.body.originFacilityId).toBe(org.hospitalId);
    const b = await reg(staffB, {});
    expect(b.status).toBe(201);
    expect(b.body.originFacilityId).toBe(hospitalB);
  });

  it("a client-supplied origin cannot be used to register waste for another hospital", async () => {
    expect((await reg(staffA, { originFacilityId: hospitalB })).status).toBe(403);
    expect((await reg(staffB, { originFacilityId: org.hospitalId })).status).toBe(403);
    expect((await reg(staffA, { originFacilityId: org.hospitalId })).status).toBe(201); // their own is fine
  });

  it("treatment-plant staff cannot register waste", async () => {
    expect((await reg(plantStaff, {})).status).toBe(403);
    expect((await reg(plantStaff, { originFacilityId: org.plantId })).status).toBe(403);
  });

  it("someone with several facilities must name one of them; admin needs a name when several hospitals exist", async () => {
    const r = await reg(multi, {});
    expect(r.status).toBe(400);
    expect(r.body.error.details.fields.originFacilityId).toBeTruthy();
    expect((await reg(multi, { originFacilityId: hospitalB })).body.originFacilityId).toBe(hospitalB);
    expect((await reg(org.admin, {})).status).toBe(400);
    expect((await reg(org.admin, { originFacilityId: org.hospitalId })).status).toBe(201);
  });

  it("quantity accepts only a positive finite number with at most 3 decimals", async () => {
    for (const q of [1, 0.5, 12.345, 1_000_000]) expect((await reg(staffA, { quantity: q })).status, String(q)).toBe(201);
    const bad: unknown[] = ["abc", "12kg", "", "1e3", "١٢", "NaN", "Infinity", null, true, [], {}, 0, -1, -0.5, 1_000_001, 1.2345];
    for (const q of bad) {
      const r = await reg(staffA, { quantity: q });
      expect(r.status, JSON.stringify(q)).toBe(400);
      expect(r.body.error.details.fields.quantity).toBeTruthy();
    }
    // Raw JSON that parses to Infinity, and a missing quantity.
    const viaAgent = await staffA.agent.post("/api/batches").set("x-bwts-csrf", "1").set("Content-Type", "application/json").send(`{"categoryId":"${yellow()}","quantity":1e999,"unit":"kg"}`);
    expect(viaAgent.status).toBe(400);
    expect((await staffA.agent.post("/api/batches").set("x-bwts-csrf", "1").send({ categoryId: yellow(), unit: "kg" })).status).toBe(400);
  });

  it("editing a batch applies the same quantity rules", async () => {
    const b = await reg(staffA, {});
    for (const q of ["abc", -3, 0]) expect((await staffA.patch(`/api/batches/${b.body.id}`, { categoryId: yellow(), quantity: q, unit: "kg" })).status).toBe(400);
    expect((await staffA.patch(`/api/batches/${b.body.id}`, { categoryId: yellow(), quantity: 6.5, unit: "kg" })).status).toBe(200);
  });

  it("notes and handling instructions are not part of registration (ignored if sent)", async () => {
    const r = await reg(staffA, { segregationNotes: "x".repeat(50), handlingNotes: "heavy" });
    expect(r.status).toBe(201);
    expect(r.body.segregationNotes).toBeNull();
    expect(r.body.handlingNotes).toBeNull();
  });
});

describe("arrival and receipt belong to the right people", () => {
  it("transporter marks arrival; admin, hospital staff and the transporter cannot confirm receipt; plant staff can", async () => {
    const org = await signupOrg("Arrival Rules");
    const staff = (await addMember(org.admin, "facility_staff", [org.hospitalId])).c;
    const plant = (await addMember(org.admin, "facility_staff", [org.plantId])).c;
    const otherPlantOrg = await signupOrg("Other Plant Org");
    const otherPlant = (await addMember(otherPlantOrg.admin, "facility_staff", [otherPlantOrg.plantId])).c;
    const driver = await addMember(org.admin, "transporter");
    const yellow = org.categories.find((c) => c.code === "YELLOW")!.id;
    const b = (await staff.post("/api/batches", { categoryId: yellow, quantity: 9, unit: "kg" })).body;
    const qr = (await staff.get(`/api/batches/${b.id}/labels`)).body.labels[0].payload;
    await staff.post(`/api/batches/${b.id}/actions/segregate`, { confirmSegregation: true });
    const job = (await staff.post(`/api/batches/${b.id}/request-collection`, {})).body;
    expect((await driver.c.post(`/api/assignments/${job.id}/accept`)).status).toBe(200);
    expect((await driver.c.post(`/api/batches/${b.id}/actions/pickup`, { scanMethod: "qr", identifier: qr })).status).toBe(200);
    expect((await driver.c.post(`/api/assignments/${job.id}/start`)).status).toBe(200);
    // Not yet arrived: nobody can receive; only the transporter may record arrival.
    const receipt = { accepted: true, receivedQuantity: 9, unit: "kg", condition: "intact", scanMethod: "qr", identifier: qr };
    expect((await plant.post(`/api/batches/${b.id}/actions/receive`, receipt)).status).toBe(422);
    expect((await org.admin.post(`/api/batches/${b.id}/actions/handover`, { scanMethod: "qr", identifier: qr })).status).toBe(422);
    expect((await plant.post(`/api/batches/${b.id}/actions/handover`, { scanMethod: "qr", identifier: qr })).status).toBe(422);
    expect((await driver.c.post(`/api/batches/${b.id}/actions/handover`, { scanMethod: "qr", identifier: qr })).status).toBe(200);
    expect((await plant.get(`/api/batches/${b.id}`)).body.status).toBe("delivered");
    // Visibility: the plant sees the arrival; another organization's plant does not.
    expect((await plant.get("/api/batches?status=delivered")).body.items.map((x: { id: string }) => x.id)).toContain(b.id);
    expect((await otherPlant.get("/api/batches?status=delivered")).body.items).toHaveLength(0);
    // Receipt and disposal are plant-staff actions only.
    for (const who of [driver.c, staff, org.admin, otherPlant]) expect([404, 422]).toContain((await who.post(`/api/batches/${b.id}/actions/receive`, receipt)).status);
    expect((await plant.get(`/api/batches/${b.id}`)).body.status).toBe("delivered");
    const detail = (await org.admin.get(`/api/batches/${b.id}`)).body;
    expect(detail.availableActions.find((a: { action: string }) => a.action === "receive").enabled).toBe(false);
    expect((await plant.post(`/api/batches/${b.id}/actions/dispose`, { method: "incineration" })).status).toBe(422); // not received yet
    expect((await plant.post(`/api/batches/${b.id}/actions/receive`, receipt)).status).toBe(200);
    expect((await plant.post(`/api/batches/${b.id}/actions/receive`, receipt)).status).toBe(422);
    for (const who of [driver.c, staff, org.admin]) expect([404, 422]).toContain((await who.post(`/api/batches/${b.id}/actions/dispose`, { method: "incineration" })).status);
    expect((await plant.post(`/api/batches/${b.id}/actions/dispose`, { method: "incineration", treatedQuantity: 9, unit: "kg" })).status).toBe(200);
    const done = (await staff.get(`/api/batches/${b.id}`)).body;
    expect(done.trackingCode).toBe(b.trackingCode);
    const trail = done.events.map((e: { eventType: string; actorRole: string }) => `${e.eventType}:${e.actorRole}`);
    expect(trail).toEqual(["created:facility_staff", "segregated:facility_staff", "assigned:facility_staff", "pickup:transporter", "transit_started:transporter", "handover:transporter", "received:facility_staff", "disposed:facility_staff"]);
    expect(done.events.every((e: { createdAt: string }) => !Number.isNaN(Date.parse(e.createdAt)))).toBe(true);
    expect(done.receipts[0].receivedBy).toBeTruthy();
  });
});

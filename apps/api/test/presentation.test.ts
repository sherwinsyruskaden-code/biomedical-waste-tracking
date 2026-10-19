import { beforeAll, describe, expect, it } from "vitest";
import { addMember, signupOrg, type Client } from "./helpers.js";

/** Transporter choice, and one batch's own QR code carried through the whole workflow. */
let org: Awaited<ReturnType<typeof signupOrg>>;
let staff: Client, otherHospitalStaff: Client, plant: Client;
const act = (c: Client, id: string, action: string, body: object = {}) => c.post(`/api/batches/${id}/actions/${action}`, body);

beforeAll(async () => {
  org = await signupOrg("Presentation Org");
  const otherHospital = (await org.admin.post("/api/facilities", { name: "Second Hospital", type: "generator", address: "9 Other Road, Chennai" })).body.id;
  staff = (await addMember(org.admin, "facility_staff", [org.hospitalId])).c;
  otherHospitalStaff = (await addMember(org.admin, "facility_staff", [otherHospital])).c;
  plant = (await addMember(org.admin, "facility_staff", [org.plantId])).c;
});

/** A transporter holds one active order at a time, so every scenario uses its own free transporter. */
const freshDriver = async () => {
  const d = await addMember(org.admin, "transporter");
  return { c: d.c, id: d.userId };
};

const newBatch = async (c = staff) => {
  const yellow = org.categories.find((x) => x.code === "YELLOW")!.id;
  const r = await c.post("/api/batches", { categoryId: yellow, quantity: 6.5, unit: "kg", containerCount: 2, sourceArea: "Ward 2" });
  expect(r.status).toBe(201);
  return r.body as { id: string; trackingCode: string };
};
const segregated = async () => {
  const b = await newBatch();
  await act(staff, b.id, "segregate", { confirmSegregation: true });
  return b;
};

describe("hospital staff choose the transporter", () => {
  it("lists free transporters with useful details, to origin staff only", async () => {
    const d = await freshDriver();
    const b = await newBatch();
    const res = (await staff.get(`/api/batches/${b.id}/transporters`)).body as { items: { userId: string; fullName: string; vehicleReg: string | null }[]; total: number; busy: number };
    expect(res.items.map((t) => t.userId)).toContain(d.id);
    expect(res.items[0]).toHaveProperty("fullName");
    expect(res.items[0]).toHaveProperty("vehicleReg");
    expect(res.items[0]).not.toHaveProperty("email");
    expect(res.total).toBeGreaterThanOrEqual(res.items.length);
    expect((await otherHospitalStaff.get(`/api/batches/${b.id}/transporters`)).status).toBe(404);
    expect((await d.c.get(`/api/batches/${b.id}/transporters`)).status).toBe(403);
    expect((await plant.get(`/api/batches/${b.id}/transporters`)).status).toBe(404);
  });

  it("the chosen transporter gets the request; others cannot see, accept or update it", async () => {
    const chosen = await freshDriver();
    const other = await freshDriver();
    const b = await segregated();
    const r = await staff.post(`/api/batches/${b.id}/request-collection`, { transporterUserId: chosen.id, notes: "Loading bay" });
    expect(r.status).toBe(201);
    expect(r.body.transporterUserId).toBe(chosen.id); // saved, and not replaced by the fallback
    expect((await chosen.c.get("/api/assignments?status=assigned")).body.items.map((x: { id: string }) => x.id)).toContain(r.body.id);
    expect((await other.c.get("/api/assignments")).body.items.map((x: { id: string }) => x.id)).not.toContain(r.body.id);
    expect((await other.c.get(`/api/assignments/${r.body.id}`)).status).toBe(404);
    expect((await other.c.get(`/api/batches/${b.id}`)).status).toBe(404);
    expect((await other.c.post(`/api/assignments/${r.body.id}/accept`)).status).toBe(404);
    expect((await act(other.c, b.id, "pickup", { scanMethod: "manual", notes: "not mine" })).status).toBe(404);
    expect((await chosen.c.post(`/api/assignments/${r.body.id}/accept`)).status).toBe(200);
    expect((await staff.get(`/api/batches/${b.id}`)).body.currentAssignment.transporterName).toBeTruthy();
  });

  it("rejects an ineligible or foreign transporter id on the server", async () => {
    const b = await segregated();
    const staffId = (await staff.get("/api/auth/me")).body.user.id;
    for (const bad of [staffId, "00000000-0000-4000-8000-000000000000"]) {
      const r = await staff.post(`/api/batches/${b.id}/request-collection`, { transporterUserId: bad });
      expect(r.status, bad).toBe(400);
      expect(r.body.error.details.fields.transporterUserId).toBeTruthy();
    }
    const other = await signupOrg("Foreign Org");
    const foreign = await addMember(other.admin, "transporter");
    expect((await staff.post(`/api/batches/${b.id}/request-collection`, { transporterUserId: foreign.userId })).status).toBe(400);
    expect((await staff.get(`/api/batches/${b.id}`)).body.currentAssignmentId).toBeNull(); // nothing was silently created
  });

  it("a disabled transporter is not offered or accepted; with none at all the request is refused clearly", async () => {
    const solo = await signupOrg("No Drivers");
    const s = (await addMember(solo.admin, "facility_staff", [solo.hospitalId])).c;
    const yellow = solo.categories.find((x) => x.code === "YELLOW")!.id;
    const b = (await s.post("/api/batches", { categoryId: yellow, quantity: 2, unit: "kg" })).body;
    await act(s, b.id, "segregate", { confirmSegregation: true });
    expect((await s.get(`/api/batches/${b.id}/transporters`)).body).toMatchObject({ items: [], total: 0, busy: 0 });
    const r = await s.post(`/api/batches/${b.id}/request-collection`, {});
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/No active transporter is available/);
    const d = await addMember(solo.admin, "transporter");
    const row = (await solo.admin.get("/api/members")).body.find((m: { userId: string }) => m.userId === d.userId);
    await solo.admin.patch(`/api/members/${row.id}`, { role: "transporter", status: "disabled", facilityIds: [] });
    expect((await s.get(`/api/batches/${b.id}/transporters`)).body.items).toEqual([]);
    expect((await s.post(`/api/batches/${b.id}/request-collection`, { transporterUserId: d.userId })).status).toBe(400);
  });

  it("without a choice the request goes to a free transporter (API fallback)", async () => {
    const d = await freshDriver();
    const b = await segregated();
    const r = await staff.post(`/api/batches/${b.id}/request-collection`, {});
    expect(r.status).toBe(201);
    expect(typeof r.body.transporterUserId).toBe("string");
    void d;
  });
});

describe("a batch's own QR code is the one used from creation to disposal", () => {
  it("the QR created with the batch resolves to exactly that batch at every stage", async () => {
    const ravi = await freshDriver();
    const b = await newBatch();
    const other = await newBatch(); // a different batch must never be confused with it
    const first = (await staff.get(`/api/batches/${b.id}/labels`)).body;
    expect(first.batchId).toBe(b.id);
    expect(first.trackingCode).toBe(b.trackingCode);
    expect(first.labels).toHaveLength(2);
    const payloads = first.labels.map((l: { payload: string }) => l.payload);
    const qr = payloads[0] as string;
    const otherQr = (await staff.get(`/api/batches/${other.id}/labels`)).body.labels[0].payload as string;
    expect(qr).not.toBe(otherQr);
    const same = async () => (await staff.get(`/api/batches/${b.id}/labels`)).body.labels.map((l: { payload: string }) => l.payload);
    const resolves = async (c: Client) => (await c.post("/api/identify", { method: "qr", value: qr })).body.batch;

    // Hospital: the QR is already valid, then segregation and a collection request to the chosen transporter
    expect((await resolves(staff)).id).toBe(b.id);
    expect((await act(staff, b.id, "segregate", { confirmSegregation: true })).status).toBe(200);
    const job = (await staff.post(`/api/batches/${b.id}/request-collection`, { transporterUserId: ravi.id })).body;
    expect(await same()).toEqual(payloads); // identity never changes
    // The plant cannot even identify it yet: it is only requested, not on its way
    expect((await plant.post("/api/identify", { method: "qr", value: qr })).status).toBe(404);
    // Transporter: accepts, then picks up with THAT QR; another batch's QR is refused
    expect((await ravi.c.post(`/api/assignments/${job.id}/accept`)).status).toBe(200);
    expect((await resolves(ravi.c)).id).toBe(b.id);
    expect((await act(ravi.c, b.id, "pickup", { scanMethod: "qr", identifier: otherQr })).status).toBe(400);
    expect((await act(ravi.c, b.id, "pickup", { scanMethod: "qr", identifier: qr })).status).toBe(200);
    expect((await ravi.c.post(`/api/assignments/${job.id}/start`)).status).toBe(200);
    // Arrival: the transporter records it WITHOUT a scan
    expect((await act(ravi.c, b.id, "handover", {})).status).toBe(200);
    // Plant staff: the arrival lists tracking code, origin hospital, transporter, status and time
    const arrival = (await plant.get("/api/batches?status=delivered")).body.items.find((x: { id: string }) => x.id === b.id);
    expect(arrival).toMatchObject({ trackingCode: b.trackingCode, status: "delivered", transporterName: expect.any(String) });
    expect(arrival.originName).toBe("Main Hospital");
    expect(arrival.statusChangedAt).toBeTruthy();
    // ...then scans the batch's own QR to confirm receipt: it identifies the same batch and is recorded as a QR scan
    expect((await resolves(plant)).id).toBe(b.id);
    const receipt = { accepted: true, receivedQuantity: 6.5, unit: "kg", condition: "intact" };
    expect((await act(plant, b.id, "receive", { ...receipt, scanMethod: "qr", identifier: otherQr })).status).toBe(400); // wrong batch's QR
    expect((await act(plant, b.id, "receive", { ...receipt, scanMethod: "qr", identifier: qr })).status).toBe(200);
    expect((await act(plant, b.id, "dispose", { method: "incineration", treatedQuantity: 6.5, unit: "kg" })).status).toBe(200);
    // Same identity after disposal; the history is the whole journey under one tracking code
    expect(await same()).toEqual(payloads);
    const done = (await staff.get(`/api/batches/${b.id}`)).body;
    expect(done.id).toBe(b.id);
    expect(done.trackingCode).toBe(b.trackingCode);
    expect(done.events.map((e: { eventType: string }) => e.eventType)).toEqual(["created", "segregated", "assigned", "pickup", "transit_started", "handover", "received", "disposed"]);
    const byType = Object.fromEntries(done.events.map((e: { eventType: string; scanMethod: string | null; actorRole: string }) => [e.eventType, e]));
    expect(byType.pickup).toMatchObject({ scanMethod: "qr", actorRole: "transporter" });
    expect(byType.handover.scanMethod).toBeNull(); // the transporter did not scan on arrival
    expect(byType.received).toMatchObject({ scanMethod: "qr", actorRole: "facility_staff" }); // the plant did
    expect((await staff.get(`/api/batches/${other.id}`)).body.status).toBe("generated"); // the other batch was not touched
  });

  it("another hospital's staff cannot read or use this batch's QR", async () => {
    const b = await newBatch();
    const qr = (await staff.get(`/api/batches/${b.id}/labels`)).body.labels[0].payload as string;
    expect((await otherHospitalStaff.get(`/api/batches/${b.id}/labels`)).status).toBe(404);
    expect((await otherHospitalStaff.post("/api/identify", { method: "qr", value: qr })).status).toBe(404);
  });
});

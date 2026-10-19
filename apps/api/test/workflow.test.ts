import { beforeAll, describe, expect, it } from "vitest";
import { addMember, signupOrg, type Client } from "./helpers.js";

/**
 * The main journey across two hospitals of one organization:
 * hospital staff register waste → request collection → transporter accepts, scans, travels, hands over
 * → plant receives and disposes. Hospital A and Hospital B must never see each other's batches.
 */
let org: Awaited<ReturnType<typeof signupOrg>>;
let hospitalB: string;
let staffA: Client, staffB: Client, plantStaff: Client, driver: Client, otherDriver: Client;
let driverId: string, staffBId: string;

beforeAll(async () => {
  org = await signupOrg("Two Hospitals Network");
  const b = await org.admin.post("/api/facilities", { name: "Hospital B", type: "generator", address: "22 Second Street, Chennai", city: "Chennai", latitude: 12.95, longitude: 80.14 });
  hospitalB = b.body.id;
  staffA = (await addMember(org.admin, "facility_staff", [org.hospitalId])).c;
  const sb = await addMember(org.admin, "facility_staff", [hospitalB]);
  staffB = sb.c;
  staffBId = sb.userId;
  plantStaff = (await addMember(org.admin, "facility_staff", [org.plantId])).c;
  const d = await addMember(org.admin, "transporter");
  driver = d.c;
  driverId = d.userId;
  // A second transporter who already has a job, so the request goes to the less busy one.
  otherDriver = (await addMember(org.admin, "transporter")).c;
});

const yellow = () => org.categories.find((c) => c.code === "YELLOW")!.id;
const register = (c: Client, originFacilityId: string, extra: object = {}) => c.post("/api/batches", { originFacilityId, categoryId: yellow(), quantity: 7.5, unit: "kg", containerCount: 1, sourceArea: "Ward 4", ...extra });
const act = (c: Client, id: string, action: string, body: object = {}) => c.post(`/api/batches/${id}/actions/${action}`, body);

describe("facility isolation between hospitals", () => {
  it("hospital staff only see their own hospital's batches", async () => {
    const a = await register(staffA, org.hospitalId);
    const b = await register(staffB, hospitalB);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((await staffB.get(`/api/batches/${a.body.id}`)).status).toBe(404);
    expect((await staffA.get(`/api/batches/${b.body.id}`)).status).toBe(404);
    const listB = (await staffB.get("/api/batches")).body.items as { id: string }[];
    expect(listB.map((x) => x.id)).toContain(b.body.id);
    expect(listB.map((x) => x.id)).not.toContain(a.body.id);
    // Cannot act on, label or register waste for the other hospital either.
    expect((await act(staffB, a.body.id, "segregate", { confirmSegregation: true })).status).toBe(404);
    expect((await staffB.get(`/api/batches/${a.body.id}/labels`)).status).toBe(404);
    expect((await register(staffB, org.hospitalId)).status).toBe(403);
    // The org admin sees both.
    const all = (await org.admin.get("/api/batches")).body.items.map((x: { id: string }) => x.id);
    expect(all).toEqual(expect.arrayContaining([a.body.id, b.body.id]));
  });

  it("facilities: staff see their own facility in full and only transfer partners in outline", async () => {
    const facs = (await staffB.get("/api/facilities")).body as { id: string; access: string; authorizationRef?: string }[];
    const byId = Object.fromEntries(facs.map((f) => [f.id, f]));
    expect(byId[hospitalB].access).toBe("own");
    expect(byId[org.plantId].access).toBe("partner"); // where Hospital B's waste goes
    expect(byId[org.plantId]).not.toHaveProperty("authorizationRef");
    expect(byId[org.hospitalId]).toBeUndefined(); // never another hospital
    const adminView = (await org.admin.get("/api/facilities")).body as { access: string }[];
    expect(adminView.length).toBe(3);
    expect(adminView.every((f) => f.access === "managed")).toBe(true);
    expect((await staffB.get("/api/facilities?includeInactive=true")).body.length).toBe(facs.length);
  });

  it("members: staff see colleagues at their own facility only; transporters see only themselves", async () => {
    const seenByB = (await staffB.get("/api/members")).body as { userId: string; email?: string }[];
    expect(seenByB.map((m) => m.userId)).toEqual([staffBId]);
    expect(seenByB[0]).not.toHaveProperty("email");
    const seenByDriver = (await driver.get("/api/members")).body as { userId: string }[];
    expect(seenByDriver.map((m) => m.userId)).toEqual([driverId]);
  });
});

describe("the full journey: registration → collection request → transport → receipt → disposal", () => {
  let batchId: string;
  let trackingCode: string;
  let qr: string;
  let jobId: string;

  it("batches are registered without a destination", async () => {
    const r = await register(staffA, org.hospitalId, { destinationFacilityId: org.plantId }); // ignored if sent
    expect(r.status).toBe(201);
    expect(r.body.destinationFacilityId).toBeNull();
    batchId = r.body.id;
    trackingCode = r.body.trackingCode;
    qr = (await staffA.get(`/api/batches/${batchId}/labels`)).body.labels[0].payload;
  });

  it("collection can only be requested after segregation, by the origin hospital", async () => {
    const early = await staffA.post(`/api/batches/${batchId}/request-collection`, {});
    expect(early.status).toBe(422);
    const detail = (await staffA.get(`/api/batches/${batchId}`)).body;
    expect(detail.collectionRequest).toMatchObject({ enabled: false, destination: { id: org.plantId } });
    expect((await act(staffA, batchId, "segregate", { confirmSegregation: true })).status).toBe(200);
    expect((await staffB.post(`/api/batches/${batchId}/request-collection`, {})).status).toBe(404);
    expect((await driver.post(`/api/batches/${batchId}/request-collection`, {})).status).toBe(403);
  });

  it("the request goes to the configured treatment plant and the least busy transporter", async () => {
    // The other transporter already has an open job (dispatched by the admin).
    const busy = await register(staffA, org.hospitalId);
    await act(staffA, busy.body.id, "segregate", { confirmSegregation: true });
    const otherId = (await otherDriver.get("/api/auth/me")).body.user.id;
    const now = Date.now();
    const dispatched = await org.admin.post("/api/assignments", { transporterUserId: otherId, originFacilityId: org.hospitalId, destinationFacilityId: org.plantId, batchIds: [busy.body.id], scheduledPickupAt: new Date(now + 60_000).toISOString(), dueBy: new Date(now + 3 * 3600_000).toISOString() });
    expect(dispatched.status).toBe(201);
    const r = await staffA.post(`/api/batches/${batchId}/request-collection`, { notes: "Two bags by the loading bay" });
    expect(r.status).toBe(201);
    expect(r.body.destinationFacilityId).toBe(org.plantId);
    expect(r.body.originFacilityId).toBe(org.hospitalId);
    expect(r.body.transporterUserId).toBe(driverId);
    expect(r.body.status).toBe("assigned");
    jobId = r.body.id;
    const again = await staffA.post(`/api/batches/${batchId}/request-collection`, {});
    expect(again.status).toBe(409);
    const b = (await staffA.get(`/api/batches/${batchId}`)).body;
    expect(b.destination.id).toBe(org.plantId);
    expect(b.currentAssignment.transporterUserId).toBe(driverId);
  });

  it("the treatment plant sees the incoming batch but other transporters do not", async () => {
    const incoming = (await plantStaff.get("/api/batches")).body.items.map((x: { id: string }) => x.id);
    expect(incoming).toContain(batchId);
    expect((await plantStaff.post(`/api/batches/${batchId}/request-collection`, {})).status).toBe(403);
    expect((await otherDriver.get(`/api/batches/${batchId}`)).status).toBe(404);
    expect((await otherDriver.get(`/api/assignments/${jobId}`)).status).toBe(404);
  });

  it("the transporter sees the origin hospital and destination plant, accepts, scans, travels and hands over", async () => {
    const job = (await driver.get(`/api/assignments/${jobId}`)).body;
    expect(job.origin.id).toBe(org.hospitalId);
    expect(job.destination.id).toBe(org.plantId);
    const facs = (await driver.get("/api/facilities")).body.map((f: { id: string }) => f.id);
    expect(facs).toEqual(expect.arrayContaining([org.hospitalId, org.plantId]));
    expect(facs).not.toContain(hospitalB);
    expect((await act(driver, batchId, "pickup", { scanMethod: "qr", identifier: qr })).status).toBe(422); // must accept first
    expect((await driver.post(`/api/assignments/${jobId}/accept`)).status).toBe(200);
    expect((await act(driver, batchId, "pickup", { scanMethod: "qr", identifier: qr })).status).toBe(200);
    expect((await driver.post(`/api/assignments/${jobId}/start`)).status).toBe(200);
    expect((await act(driver, batchId, "handover", { scanMethod: "qr", identifier: qr })).status).toBe(200);
    expect((await driver.get(`/api/assignments/${jobId}`)).body.status).toBe("completed");
    // Simulated scans exist only in the demo organization.
    expect((await driver.post(`/api/demo/batches/${batchId}/simulate-scan`, { action: "pickup" })).status).toBe(404);
  });

  it("the plant confirms receipt and records disposal; history shows the whole journey", async () => {
    expect((await act(staffB, batchId, "receive", { accepted: true, receivedQuantity: 7.5, unit: "kg", condition: "intact" })).status).toBe(404);
    expect((await act(plantStaff, batchId, "receive", { accepted: true, receivedQuantity: 7.5, unit: "kg", condition: "intact" })).status).toBe(200);
    expect((await act(plantStaff, batchId, "dispose", { method: "incineration", treatedQuantity: 7.5, unit: "kg" })).status).toBe(200);
    const b = (await staffA.get(`/api/batches/${batchId}`)).body;
    expect(b.status).toBe("disposed");
    expect(b.trackingCode).toBe(trackingCode);
    expect(b.events.map((e: { eventType: string }) => e.eventType)).toEqual(["created", "segregated", "assigned", "pickup", "transit_started", "handover", "received", "disposed"]);
    for (const e of b.events) expect(new Date(e.createdAt).getTime()).toBeGreaterThan(0);
    expect(b.disposal.facilityName).toBe("Green CBWTF");
  });
});

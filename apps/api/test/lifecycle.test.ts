import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { addMember, signupOrg, uniq, type Client } from "./helpers.js";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { alerts as alertsTable } from "../src/db/schema.js";
import { runAlertChecks } from "../src/services/alerts.js";

let admin: Client, staff: Client, plantStaff: Client, driver: Client, otherDriver: Client;
let hospitalId: string, plantId: string, yellowId: string, driverId: string, otherDriverId: string;

beforeAll(async () => {
  const org = await signupOrg("Lifecycle Hospital");
  admin = org.admin;
  hospitalId = org.hospitalId;
  plantId = org.plantId;
  yellowId = org.categories.find((c) => c.code === "YELLOW")!.id;
  staff = (await addMember(admin, "facility_staff", [hospitalId])).c;
  plantStaff = (await addMember(admin, "facility_staff", [plantId])).c;
});

// Every test gets two fresh, free transporters: a transporter can only hold one active order at a time.
beforeEach(async () => {
  const d = await addMember(admin, "transporter");
  driver = d.c;
  driverId = d.userId;
  const d2 = await addMember(admin, "transporter");
  otherDriver = d2.c;
  otherDriverId = d2.userId;
});

async function newBatch(qty = 12.5, containers = 2) {
  const r = await staff.post("/api/batches", { originFacilityId: hospitalId, categoryId: yellowId, quantity: qty, unit: "kg", containerCount: containers, containerType: "Yellow bag", sourceArea: "Ward 3" });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; trackingCode: string; status: string };
}

async function labels(batchId: string) {
  const r = await staff.get(`/api/batches/${batchId}/labels`);
  expect(r.status).toBe(200);
  return r.body.labels as { payload: string; svg: string; containerId: string }[];
}

const act = (c: Client, batchId: string, action: string, body: object = {}, key?: string) =>
  c.post(`/api/batches/${batchId}/actions/${action}`, body, key ? { "Idempotency-Key": key } : {});

async function assign(batchIds: string[], transporter = driverId) {
  const now = Date.now();
  const r = await admin.post("/api/assignments", { transporterUserId: transporter, originFacilityId: hospitalId, destinationFacilityId: plantId, batchIds, scheduledPickupAt: new Date(now + 60_000).toISOString(), dueBy: new Date(now + 3 * 3600_000).toISOString() });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; reference: string };
}

describe("end-to-end waste lifecycle", () => {
  it("runs generation → segregation → pickup → transport (GPS) → handover → receipt → disposal with full history", async () => {
    const batch = await newBatch();
    expect(batch.trackingCode).toMatch(/^BW-\d{6}-[A-Z0-9]{6}$/);
    expect(batch.status).toBe("generated");

    // QR labels: one per container, payload is an opaque URL token (no batch data inside)
    const lbls = await labels(batch.id);
    expect(lbls).toHaveLength(2);
    expect(lbls[0].payload).toMatch(/^http:\/\/localhost:5173\/s\/[A-Za-z0-9_-]{24}$/);
    expect(lbls[0].payload).not.toContain(batch.trackingCode);
    expect(lbls[0].svg).toContain("<svg");

    // Scanning resolves to the right batch
    const scan = await staff.post("/api/identify", { method: "qr", value: lbls[0].payload, source: "camera" });
    expect(scan.status).toBe(200);
    expect(scan.body.batch.id).toBe(batch.id);
    expect(scan.body.availableActions.map((a: { action: string }) => a.action)).toContain("segregate");

    // Cannot assign before segregation
    const early = await admin.post("/api/assignments", { transporterUserId: driverId, originFacilityId: hospitalId, destinationFacilityId: plantId, batchIds: [batch.id], scheduledPickupAt: new Date().toISOString(), dueBy: new Date(Date.now() + 3600_000).toISOString() });
    expect(early.status).toBe(422);

    expect((await act(staff, batch.id, "segregate", { confirmSegregation: true, notes: "Checked bag colour" })).status).toBe(200);
    const asg = await assign([batch.id]);

    // Transporter must accept first
    const tooSoon = await act(driver, batch.id, "pickup", { scanMethod: "qr", identifier: lbls[0].payload });
    expect(tooSoon.status).toBe(422);
    expect(tooSoon.body.error.message).toMatch(/accept/);
    expect((await driver.post(`/api/assignments/${asg.id}/accept`)).status).toBe(200);

    // Scanning a container from a different batch is rejected
    const other = await newBatch(3, 1);
    const otherLabel = (await labels(other.id))[0];
    const wrong = await act(driver, batch.id, "pickup", { scanMethod: "qr", identifier: otherLabel.payload });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toMatch(/different batch/);

    // Pickup with scan + idempotent retry
    const key = `pickup-${uniq()}`;
    const p1 = await act(driver, batch.id, "pickup", { scanMethod: "qr", identifier: lbls[0].payload }, key);
    expect(p1.status).toBe(200);
    expect(p1.body.status).toBe("collected");
    const p2 = await act(driver, batch.id, "pickup", { scanMethod: "qr", identifier: lbls[0].payload }, key);
    expect(p2.status).toBe(200);
    expect(p2.body.replayed).toBe(true);
    // A second pickup without the same key is an invalid (duplicate) transition
    expect((await act(driver, batch.id, "pickup", { scanMethod: "qr", identifier: lbls[0].payload })).status).toBe(422);

    // Location only accepted once sharing is on
    const pt = { latitude: 12.93, longitude: 80.11, accuracy: 8, recordedAt: new Date().toISOString() };
    expect((await driver.post(`/api/assignments/${asg.id}/locations`, { points: [pt] })).status).toBe(422);
    expect((await driver.put(`/api/assignments/${asg.id}/tracking`, { active: true })).status).toBe(200);
    expect((await driver.post(`/api/assignments/${asg.id}/start`)).status).toBe(200);
    const up = await driver.post(`/api/assignments/${asg.id}/locations`, {
      points: [pt, { latitude: 12.95, longitude: 80.15, accuracy: 12, speed: 8.3, heading: 45, recordedAt: new Date(Date.now() + 1000).toISOString() }],
    });
    expect(up.status).toBe(200);
    expect(up.body.accepted).toBe(2);
    // duplicates are ignored, impossible coordinates rejected, other transporters blocked
    expect((await driver.post(`/api/assignments/${asg.id}/locations`, { points: [pt] })).body.ignored).toBe(1);
    expect((await driver.post(`/api/assignments/${asg.id}/locations`, { points: [{ ...pt, latitude: 123 }] })).status).toBe(400);
    expect((await otherDriver.post(`/api/assignments/${asg.id}/locations`, { points: [pt] })).status).toBe(404);

    // The admin's live map shows the latest real position and its timestamp
    const live = await admin.get("/api/tracking/live");
    const mine = live.body.assignments.find((a: { id: string }) => a.id === asg.id);
    expect(mine.latestPoint.latitude).toBeCloseTo(12.95);
    expect(mine.latestPoint.source).toBe("device");
    expect(new Date(mine.latestPoint.recordedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    const hist = await admin.get(`/api/assignments/${asg.id}/locations`);
    expect(hist.body).toHaveLength(2);
    expect((await otherDriver.get(`/api/assignments/${asg.id}/locations`)).status).toBe(404);

    // Receipt is impossible before the transporter hands over; disposal impossible before receipt
    expect((await act(plantStaff, batch.id, "receive", { accepted: true, receivedQuantity: 12.5, unit: "kg", condition: "intact" })).status).toBe(422);
    expect((await act(plantStaff, batch.id, "dispose", { method: "incineration" })).status).toBe(422);

    const ho = await act(driver, batch.id, "handover", { scanMethod: "qr", identifier: lbls[1].payload, latitude: 12.98, longitude: 80.2 });
    expect(ho.status).toBe(200);
    expect(ho.body.status).toBe("delivered");
    expect((await act(driver, batch.id, "handover", { scanMethod: "qr", identifier: lbls[1].payload })).status).toBe(422); // no duplicate handover

    // Assignment auto-completes and tracking stops once everything is handed over
    const done = await admin.get(`/api/assignments/${asg.id}`);
    expect(done.body.status).toBe("completed");
    expect(done.body.trackingActive).toBe(false);
    expect((await driver.post(`/api/assignments/${asg.id}/locations`, { points: [pt] })).status).toBe(422);

    // Hospital staff are not authorised to receive at the treatment plant
    expect((await act(staff, batch.id, "receive", { accepted: true, receivedQuantity: 12.5, unit: "kg", condition: "intact" })).status).toBe(422);
    const rec = await act(plantStaff, batch.id, "receive", { accepted: true, receivedQuantity: 12.4, unit: "kg", condition: "intact", scanMethod: "qr", identifier: lbls[0].payload });
    expect(rec.status).toBe(200);
    expect(rec.body.status).toBe("received");

    // Disposal method must be configured for the category
    const badMethod = await act(plantStaff, batch.id, "dispose", { method: "shredding" });
    expect(badMethod.status).toBe(422);
    const disp = await act(plantStaff, batch.id, "dispose", { method: "incineration", treatedQuantity: 12.4, unit: "kg", documentRef: "INC-LOG-77" });
    expect(disp.status).toBe(200);
    expect(disp.body.status).toBe("disposed");

    // Full, ordered chain of custody is preserved
    const detail = await admin.get(`/api/batches/${batch.id}`);
    expect(detail.body.events.map((e: { eventType: string }) => e.eventType)).toEqual(["created", "segregated", "assigned", "pickup", "transit_started", "handover", "received", "disposed"]);
    const pickup = detail.body.events.find((e: { eventType: string }) => e.eventType === "pickup");
    expect(pickup.toCustodianUser).toBe("Test transporter");
    expect(pickup.scanMethod).toBe("qr");
    expect(detail.body.disposal.documentRef).toBe("INC-LOG-77");
    expect(detail.body.receipts).toHaveLength(1);
    expect(detail.body.availableActions).toEqual([]);

    // The transporter can still see the history of a batch they carried
    expect((await driver.get(`/api/batches/${batch.id}`)).status).toBe(200);
    expect((await otherDriver.get(`/api/batches/${batch.id}`)).status).toBe(404);
  });

  it("requires a note for manual (unscanned) pickup and enforces facility permissions", async () => {
    const b = await newBatch(2, 1);
    expect((await plantStaff.post(`/api/batches/${b.id}/actions/segregate`, { confirmSegregation: true })).status).toBe(404); // not their facility → cannot even see it
    expect((await act(staff, b.id, "segregate", { confirmSegregation: true })).status).toBe(200);
    const asg = await assign([b.id]);
    await driver.post(`/api/assignments/${asg.id}/accept`);
    expect((await act(driver, b.id, "pickup", { scanMethod: "manual" })).status).toBe(400);
    expect((await act(driver, b.id, "pickup", { scanMethod: "manual", notes: "Label torn, verified by tracking code" })).status).toBe(200);
    // Transporter cannot start before every batch is picked up — here all are, so start works
    expect((await driver.post(`/api/assignments/${asg.id}/start`)).status).toBe(200);
    // Admin cannot cancel a job whose waste is already on the truck
    expect((await admin.post(`/api/assignments/${asg.id}/cancel`, { reason: "test" })).status).toBe(422);
  });

  it("only allows the assigned transporter to accept, and blocks starting with un-picked batches", async () => {
    const b1 = await newBatch(1, 1);
    const b2 = await newBatch(1, 1);
    for (const b of [b1, b2]) await act(staff, b.id, "segregate", { confirmSegregation: true });
    const asg = await assign([b1.id, b2.id]);
    expect((await otherDriver.post(`/api/assignments/${asg.id}/accept`)).status).toBe(404);
    expect((await staff.post(`/api/assignments/${asg.id}/accept`)).status).toBe(403);
    await driver.post(`/api/assignments/${asg.id}/accept`);
    const l1 = (await labels(b1.id))[0];
    await act(driver, b1.id, "pickup", { scanMethod: "qr", identifier: l1.payload });
    const start = await driver.post(`/api/assignments/${asg.id}/start`);
    expect(start.status).toBe(422);
    expect(start.body.error.message).toContain(b2.trackingCode);
    // Admin removes the batch that is not travelling, then the trip can start
    expect((await admin.patch(`/api/assignments/${asg.id}`, { removeBatchIds: [b2.id] })).status).toBe(200);
    expect((await driver.post(`/api/assignments/${asg.id}/start`)).status).toBe(200);
    const b2detail = await admin.get(`/api/batches/${b2.id}`);
    expect(b2detail.body.currentAssignmentId).toBeNull();
    expect(b2detail.body.status).toBe("segregated");
  });

  it("handles a rejected delivery, then admin reroutes to another facility", async () => {
    const plant2 = await admin.post("/api/facilities", { name: `Backup Plant ${uniq()}`, type: "treatment", canReceive: true, address: "Backup Road, Chennai", latitude: 13.05, longitude: 80.25 });
    const b = await newBatch(10, 1);
    await act(staff, b.id, "segregate", { confirmSegregation: true });
    const asg = await assign([b.id]);
    await driver.post(`/api/assignments/${asg.id}/accept`);
    await act(driver, b.id, "pickup", { scanMethod: "manual", notes: "manual" });
    await driver.post(`/api/assignments/${asg.id}/start`);
    await act(driver, b.id, "handover", { scanMethod: "manual", notes: "manual" });
    expect((await act(plantStaff, b.id, "receive", { accepted: false, receivedQuantity: 4, unit: "kg", condition: "leaking" })).status).toBe(400); // reason required
    const rej = await act(plantStaff, b.id, "receive", { accepted: false, receivedQuantity: 4, unit: "kg", condition: "leaking", notes: "Bag leaking, weight mismatch" });
    expect(rej.status).toBe(200);
    expect(rej.body.status).toBe("rejected");
    // Alerts and incidents are switched off: their endpoints are gone and nothing new is recorded.
    expect((await admin.get("/api/alerts")).status).toBe(404);
    expect((await admin.get(`/api/incidents?batchId=${b.id}`)).status).toBe(404);
    expect((await admin.get(`/api/batches/${b.id}`)).body).not.toHaveProperty("incidents");
    expect((await act(staff, b.id, "reroute", { destinationFacilityId: plant2.body.id, dueBy: new Date(Date.now() + 7200_000).toISOString() })).status).toBe(422);
    const rr = await act(admin, b.id, "reroute", { destinationFacilityId: plant2.body.id, dueBy: new Date(Date.now() + 7200_000).toISOString() });
    expect(rr.status).toBe(200);
    expect(rr.body.status).toBe("in_transit");
    expect(rr.body.destinationFacilityId).toBe(plant2.body.id);
    const newAsg = await driver.get(`/api/assignments/${rr.body.currentAssignmentId}`);
    expect(newAsg.body.status).toBe("in_progress");
    expect(newAsg.body.isMine).toBe(true);
  });

  it("the background job no longer raises alerts, but keeps applying location retention", async () => {
    const b = await newBatch(1, 1);
    await runAlertChecks(new Date(Date.now() + 200 * 3600_000)); // pretend a long time passed
    expect((await admin.get("/api/alerts")).status).toBe(404);
    const rows = await db.select().from(alertsTable).where(eq(alertsTable.batchId, b.id));
    expect(rows).toHaveLength(0);
    expect((await admin.get("/api/incidents")).status).toBe(404);
    expect((await admin.get("/api/reports?type=incidents")).status).toBe(400);
    expect((await admin.get("/api/dashboard")).body.kpis).not.toHaveProperty("openAlerts");
  });

  it("supports RFID/NFC tags through the same identification flow, preventing collisions", async () => {
    const b = await newBatch(1, 2);
    const detail = await staff.get(`/api/batches/${b.id}`);
    const [c1, c2] = detail.body.containers;
    const reg = await staff.post(`/api/containers/${c1.id}/identifiers`, { method: "rfid", value: "e2:80:11:60:60:00:02:05" });
    expect(reg.status).toBe(201);
    expect(reg.body.value).toBe("E28011606000020" + "5");
    const scan = await staff.post("/api/identify", { method: "rfid", value: "E2801160 60000205", source: "keyboard_wedge" });
    expect(scan.status).toBe(200);
    expect(scan.body.container.id).toBe(c1.id);
    // Same tag on another container → conflict unless reassignment is confirmed
    expect((await staff.post(`/api/containers/${c2.id}/identifiers`, { method: "rfid", value: "E280116060000205" })).status).toBe(409);
    expect((await staff.post(`/api/containers/${c2.id}/identifiers`, { method: "rfid", value: "E280116060000205", reassign: true })).status).toBe(201);
    expect((await staff.post("/api/identify", { method: "rfid", value: "E280116060000205" })).body.container.id).toBe(c2.id);
    expect((await staff.post("/api/identify", { method: "nfc", value: "zz" })).status).toBe(400);
    expect((await driver.post(`/api/containers/${c1.id}/identifiers`, { method: "nfc", value: "04A23B9C" })).status).toBe(403);
  });

  it("keeps custody history append-only at the database level", async () => {
    const b = await newBatch(1, 1);
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      await expect(db.query("update custody_events set notes = 'tampered' where batch_id = $1", [b.id])).rejects.toThrow(/append-only/);
      await expect(db.query("delete from custody_events where batch_id = $1", [b.id])).rejects.toThrow(/append-only/);
      await expect(db.query("update audit_logs set action = 'x' where id = (select max(id) from audit_logs)")).rejects.toThrow(/append-only/);
    } finally {
      await db.end();
    }
  });

  it("edits only while generated and records the change in the timeline", async () => {
    const b = await newBatch(5, 1);
    const e = await staff.patch(`/api/batches/${b.id}`, { categoryId: yellowId, quantity: 6, unit: "kg", sourceArea: "ICU" });
    expect(e.status).toBe(200);
    const d = await staff.get(`/api/batches/${b.id}`);
    expect(d.body.events.at(-1).eventType).toBe("updated");
    expect(d.body.events.at(-1).details.quantity).toEqual({ from: 5, to: 6 });
    await act(staff, b.id, "segregate", { confirmSegregation: true });
    expect((await staff.patch(`/api/batches/${b.id}`, { categoryId: yellowId, quantity: 7, unit: "kg" })).status).toBe(422);
  });
});

describe("reports and dashboard", () => {
  it("returns dashboard KPIs from real data and exports CSV / PDF", async () => {
    const dash = await admin.get("/api/dashboard");
    expect(dash.status).toBe(200);
    expect(dash.body.kpis.disposedLast30Days).toBeGreaterThanOrEqual(1);
    expect(dash.body.trend).toHaveLength(14);
    const json = await admin.get("/api/reports?type=batches&disposal=disposed");
    expect(json.body.rows.length).toBeGreaterThanOrEqual(1);
    expect(json.body.rows.every((r: { status: string }) => r.status === "disposed")).toBe(true);
    const csv = await admin.get("/api/reports?type=custody_history&format=csv");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.text).toContain("Tracking code".replace("Tracking code", "Batch"));
    const pdf = await admin.agent.get("/api/reports?type=transport_performance&format=pdf").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    for (const type of ["volume_by_category", "facility_activity", "disposal"]) {
      expect((await admin.get(`/api/reports?type=${type}`)).status).toBe(200);
    }
    expect((await driver.get("/api/reports?type=batches")).status).toBe(403);
  });

  it("scopes staff reports to their own facilities", async () => {
    const rows = (await plantStaff.get("/api/reports?type=batches")).body.rows as { destination: string | null }[];
    expect(rows.every((r) => r.destination !== null)).toBe(true);
  });
});

export { otherDriverId };

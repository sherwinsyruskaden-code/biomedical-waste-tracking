import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";
import { assignments, notifications, wasteBatches } from "../src/db/schema.js";
import { addMember, signupOrg, type Client } from "./helpers.js";

/**
 * One active order per transporter (system invariant), declined collections and what a treatment plant may see.
 * "Active" = assigned, accepted or in progress. Completed (arrival recorded), declined and cancelled orders release the transporter.
 */
let org: Awaited<ReturnType<typeof signupOrg>>;
let staff: Client, staffB: Client, plant: Client, plant2: Client;
let plant2Id: string, hospitalBId: string;
// Receipt at the plant now requires a scan of the batch's QR, so tests attach it unless they say otherwise.
const act = async (c: Client, id: string, action: string, body: object = {}) => {
  if (action === "receive" && !("scanMethod" in body)) {
    const qr = (await org.admin.get(`/api/batches/${id}/labels`)).body.labels?.[0]?.payload;
    body = { ...body, scanMethod: "qr", identifier: qr };
  }
  return c.post(`/api/batches/${id}/actions/${action}`, body);
};
const ACTIVE = ["assigned", "accepted", "in_progress"] as const;

beforeAll(async () => {
  org = await signupOrg("Capacity Org");
  hospitalBId = (await org.admin.post("/api/facilities", { name: "Capacity Hospital B", type: "generator", address: "5 Second Road, Chennai" })).body.id;
  plant2Id = (await org.admin.post("/api/facilities", { name: "Second Plant", type: "treatment", canReceive: true, address: "Plot 4, Industrial Estate, Chennai" })).body.id;
  // Two plants exist, so the organization names its default destination (otherwise a request asks the admin to choose).
  expect((await org.admin.put("/api/organization/settings", { defaultTreatmentFacilityId: org.plantId })).status).toBe(200);
  staff = (await addMember(org.admin, "facility_staff", [org.hospitalId])).c;
  staffB = (await addMember(org.admin, "facility_staff", [hospitalBId])).c;
  plant = (await addMember(org.admin, "facility_staff", [org.plantId])).c;
  plant2 = (await addMember(org.admin, "facility_staff", [plant2Id])).c;
});

const freshDriver = async () => {
  const d = await addMember(org.admin, "transporter");
  return { c: d.c, id: d.userId };
};
const yellow = () => org.categories.find((c) => c.code === "YELLOW")!.id;
const segregated = async (who: Client = staff) => {
  const b = await who.post("/api/batches", { categoryId: yellow(), quantity: 5, unit: "kg" });
  expect(b.status).toBe(201);
  expect((await act(who, b.body.id, "segregate", { confirmSegregation: true })).status).toBe(200);
  return b.body as { id: string; trackingCode: string };
};
const request = (who: Client, batchId: string, transporterUserId: string, notes?: string) => who.post(`/api/batches/${batchId}/request-collection`, { transporterUserId, notes });
const activeCount = async (userId: string) => (await db.select().from(assignments).where(and(eq(assignments.transporterUserId, userId), inArray(assignments.status, [...ACTIVE])))).length;
const availableIds = async (batchId: string, who: Client = staff) => ((await who.get(`/api/batches/${batchId}/transporters`)).body.items as { userId: string }[]).map((t) => t.userId);

/** Runs a batch through to the given point of the journey with a transporter. */
async function drive(batchId: string, d: { c: Client; id: string }, jobId: string, upTo: "accepted" | "collected" | "in_transit" | "delivered") {
  expect((await d.c.post(`/api/assignments/${jobId}/accept`)).status).toBe(200);
  if (upTo === "accepted") return;
  expect((await act(d.c, batchId, "pickup", { scanMethod: "manual", notes: "label damaged, verified by tracking code" })).status).toBe(200);
  if (upTo === "collected") return;
  expect((await d.c.post(`/api/assignments/${jobId}/start`)).status).toBe(200);
  if (upTo === "in_transit") return;
  expect((await act(d.c, batchId, "handover", {})).status).toBe(200);
}

describe("one active order per transporter", () => {
  it("a busy transporter is not offered and cannot be chosen; they are offered again once released", async () => {
    const d = await freshDriver();
    const b1 = await segregated();
    const b2 = await segregated();
    expect(await availableIds(b1.id)).toContain(d.id);
    const first = await request(staff, b1.id, d.id);
    expect(first.status).toBe(201); // an order awaiting acceptance already reserves the transporter
    expect(await availableIds(b2.id)).not.toContain(d.id);
    const second = await request(staff, b2.id, d.id);
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/already has an active order/);
    expect((await staff.get(`/api/batches/${b2.id}`)).body.currentAssignmentId).toBeNull();
    const list = (await staff.get(`/api/batches/${b2.id}/transporters`)).body;
    expect(list.busy).toBeGreaterThanOrEqual(1);
    // Declining releases them immediately.
    expect((await d.c.post(`/api/assignments/${first.body.id}/decline`, { reason: "Vehicle in the workshop" })).status).toBe(200);
    expect(await availableIds(b2.id)).toContain(d.id);
    expect((await request(staff, b2.id, d.id)).status).toBe(201);
  });

  it("two simultaneous requests for the same transporter: exactly one succeeds", async () => {
    const d = await freshDriver();
    const batches = await Promise.all([segregated(), segregated(), segregated(), segregated(), segregated()]);
    const results = await Promise.all(batches.map((b) => request(staff, b.id, d.id)));
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409]);
    expect(await activeCount(d.id)).toBe(1);
    const assigned = await db.select().from(wasteBatches).where(inArray(wasteBatches.id, batches.map((b) => b.id)));
    expect(assigned.filter((b) => b.currentAssignmentId).length).toBe(1); // the losers were not partly assigned
  });

  it("requests from different hospitals and from the admin race for the same transporter safely, but different transporters both succeed", async () => {
    const d = await freshDriver();
    const a = await segregated(staff);
    const b = await segregated(staffB);
    const c = await segregated(staff);
    const now = Date.now();
    const adminDispatch = org.admin.post("/api/assignments", { transporterUserId: d.id, originFacilityId: org.hospitalId, destinationFacilityId: org.plantId, batchIds: [c.id], scheduledPickupAt: new Date(now + 60_000).toISOString(), dueBy: new Date(now + 3 * 3600_000).toISOString() });
    const results = await Promise.all([request(staff, a.id, d.id), request(staffB, b.id, d.id), adminDispatch]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await activeCount(d.id)).toBe(1);
    const e1 = await freshDriver();
    const e2 = await freshDriver();
    const x = await segregated();
    const y = await segregated();
    const both = await Promise.all([request(staff, x.id, e1.id), request(staff, y.id, e2.id)]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
  });

  it("the database itself refuses a second active order for one transporter", async () => {
    const idx = await pool.query("select 1 from pg_indexes where indexname = 'assignments_one_active_per_transporter_uq'");
    expect(idx.rowCount).toBe(1);
    const d = await freshDriver();
    const b = await segregated();
    const first = (await request(staff, b.id, d.id)).body;
    const [row] = await db.select().from(assignments).where(eq(assignments.id, first.id));
    await expect(
      db.insert(assignments).values({ organizationId: row.organizationId, reference: `TR-DUP-${Date.now()}`, transporterUserId: d.id, originFacilityId: row.originFacilityId, destinationFacilityId: row.destinationFacilityId, scheduledPickupAt: new Date(), dueBy: new Date(Date.now() + 3600_000) }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("stays reserved through accept, pickup and travel, and is released only when arrival completes the order", async () => {
    const d = await freshDriver();
    const b = await segregated();
    const next = await segregated();
    const job = (await request(staff, b.id, d.id)).body;
    for (const stage of ["accepted", "collected", "in_transit"] as const) {
      if (stage === "accepted") await drive(b.id, d, job.id, "accepted");
      if (stage === "collected") expect((await act(d.c, b.id, "pickup", { scanMethod: "manual", notes: "label damaged, verified by tracking code" })).status).toBe(200);
      if (stage === "in_transit") expect((await d.c.post(`/api/assignments/${job.id}/start`)).status).toBe(200);
      expect(await activeCount(d.id), stage).toBe(1);
      expect(await availableIds(next.id), stage).not.toContain(d.id);
      expect((await request(staff, next.id, d.id)).status, stage).toBe(409);
    }
    expect((await act(d.c, b.id, "handover", {})).status).toBe(200); // arrival = the order's terminal state
    expect((await d.c.get(`/api/assignments/${job.id}`)).body.status).toBe("completed");
    expect(await activeCount(d.id)).toBe(0);
    expect(await availableIds(next.id)).toContain(d.id);
    expect((await request(staff, next.id, d.id)).status).toBe(201);
  });

  it("an admin cancelling releases the transporter", async () => {
    const d = await freshDriver();
    const b = await segregated();
    const job = (await request(staff, b.id, d.id)).body;
    expect((await org.admin.post(`/api/assignments/${job.id}/cancel`, { reason: "Hospital no longer needs it" })).status).toBe(200);
    expect(await activeCount(d.id)).toBe(0);
    expect(await availableIds(b.id)).toContain(d.id);
  });

  it("admin reassignment respects capacity and frees the previous transporter", async () => {
    const busy = await freshDriver();
    const free = await freshDriver();
    const old = await freshDriver();
    const b1 = await segregated();
    const b2 = await segregated();
    await request(staff, b1.id, busy.id);
    const job = (await request(staff, b2.id, old.id)).body;
    expect((await org.admin.patch(`/api/assignments/${job.id}`, { transporterUserId: busy.id })).status).toBe(409);
    expect((await org.admin.get(`/api/assignments/${job.id}`)).body.transporterUserId).toBe(old.id);
    expect((await org.admin.patch(`/api/assignments/${job.id}`, { transporterUserId: free.id })).status).toBe(200);
    expect(await activeCount(old.id)).toBe(0);
    expect(await activeCount(free.id)).toBe(1);
    const avail = (await org.admin.get("/api/transporters/available")).body.items.map((t: { userId: string }) => t.userId);
    expect(avail).toContain(old.id);
    expect(avail).not.toContain(free.id);
  });

  it("rerouting a rejected load keeps the same transporter, but not if they have taken another order meanwhile", async () => {
    const d = await freshDriver();
    const b = await segregated();
    const job = (await request(staff, b.id, d.id)).body;
    await drive(b.id, d, job.id, "delivered");
    const rej = await act(plant, b.id, "receive", { accepted: false, receivedQuantity: 4, unit: "kg", condition: "leaking", notes: "Leaking, refused" });
    expect(rej.status).toBe(200);
    const other = await segregated();
    const taken = (await request(staff, other.id, d.id)).body; // the transporter is free (order completed) and takes a new one
    expect(taken.status).toBe("assigned");
    const blocked = await act(org.admin, b.id, "reroute", { destinationFacilityId: plant2Id, dueBy: new Date(Date.now() + 7200_000).toISOString() });
    expect(blocked.status).toBe(409);
    expect((await d.c.post(`/api/assignments/${taken.id}/decline`, { reason: "Need to take the rejected load back first" })).status).toBe(200);
    const ok = await act(org.admin, b.id, "reroute", { destinationFacilityId: plant2Id, dueBy: new Date(Date.now() + 7200_000).toISOString() });
    expect(ok.status).toBe(200);
    expect(await activeCount(d.id)).toBe(1);
  });
});

describe("a declined collection", () => {
  it("is a real state change, notifies the originating hospital and admins, and frees the batch for another transporter", async () => {
    const d = await freshDriver();
    const e = await freshDriver();
    const driverName = (await d.c.get("/api/auth/me")).body.user.fullName as string;
    const b = await segregated();
    const job = (await request(staff, b.id, d.id, "Loading bay")).body;
    expect(job.status).toBe("assigned");
    // Another hospital's staff and a stranger cannot decline it
    expect((await e.c.post(`/api/assignments/${job.id}/decline`, { reason: "Not mine" })).status).toBe(404);
    expect((await staff.post(`/api/assignments/${job.id}/decline`, { reason: "I am hospital staff" })).status).toBe(403);
    expect((await d.c.post(`/api/assignments/${job.id}/decline`, {})).status).toBe(400); // a reason is required
    const before = Date.now();
    const res = await d.c.post(`/api/assignments/${job.id}/decline`, { reason: "Vehicle breakdown" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("declined");

    // Persisted status and timestamp
    const [row] = await db.select().from(assignments).where(eq(assignments.id, job.id));
    expect(row.status).toBe("declined");
    expect(row.declinedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.cancelReason).toBe("Vehicle breakdown");

    // Batch is back with the hospital, not assigned to the rejecting transporter
    const detail = (await staff.get(`/api/batches/${b.id}`)).body;
    expect(detail.status).toBe("segregated");
    expect(detail.currentAssignmentId).toBeNull();
    expect(detail.destinationFacilityId).toBeNull();
    expect(detail.collectionRequest).toMatchObject({ enabled: true });
    const declinedEvent = detail.events.find((ev: { eventType: string }) => ev.eventType === "declined");
    expect(declinedEvent).toMatchObject({ actorRole: "transporter", actorName: driverName });
    expect(declinedEvent.notes).toContain("Vehicle breakdown");
    expect(detail.assignmentHistory[0]).toMatchObject({ id: job.id, status: "declined", transporterName: driverName });

    // The hospital's collection screen shows Declined, not Sent/Pending
    const mine = (await staff.get("/api/assignments?pageSize=100")).body.items.find((x: { id: string }) => x.id === job.id);
    expect(mine).toMatchObject({ status: "declined", transporterName: driverName });
    expect(mine.declinedAt).toBeTruthy();
    const stillWaiting = (await staff.get("/api/assignments?status=assigned,accepted,in_progress&pageSize=100")).body.items.map((x: { id: string }) => x.id);
    expect(stillWaiting).not.toContain(job.id);
    const declinedTab = (await staff.get("/api/assignments?status=declined&pageSize=100")).body.items.map((x: { id: string }) => x.id);
    expect(declinedTab).toContain(job.id);

    // Notification: persisted for origin staff and admins, with the details, and visible through the notification API
    const rows = await db.select().from(notifications).where(eq(notifications.kind, "assignment.declined"));
    const mineRows = rows.filter((n) => n.body.includes(job.reference));
    const staffId = (await staff.get("/api/auth/me")).body.user.id;
    const adminId = (await org.admin.get("/api/auth/me")).body.user.id;
    const recipients = mineRows.map((n) => n.userId);
    expect(recipients).toContain(staffId);
    expect(recipients).toContain(adminId);
    for (const stranger of [staffB, plant, plant2, d.c, e.c]) expect(recipients).not.toContain((await stranger.get("/api/auth/me")).body.user.id);
    const n = mineRows.find((x) => x.userId === staffId)!;
    expect(n.title).toContain(b.trackingCode);
    expect(n.body).toContain(driverName);
    expect(n.body).toContain("Vehicle breakdown");
    expect(n.body).toMatch(/request collection again/i);
    expect(n.link).toBe(`/batches/${b.id}`);
    expect(n.readAt).toBeNull();
    const api = (await staff.get("/api/notifications")).body;
    expect(api.items.some((x: { id: string }) => x.id === n.id)).toBe(true);
    expect(api.unread).toBeGreaterThan(0);
    expect(JSON.stringify((await staffB.get("/api/notifications")).body)).not.toContain(b.trackingCode);

    // The rejected transporter cannot continue through the rejected assignment
    expect((await d.c.post(`/api/assignments/${job.id}/accept`)).status).toBe(422);
    expect((await d.c.post(`/api/assignments/${job.id}/start`)).status).toBe(422);
    expect((await act(d.c, b.id, "pickup", { scanMethod: "manual", notes: "trying anyway" })).status).toBe(404);
    expect((await d.c.get(`/api/batches/${b.id}`)).status).toBe(404);
    expect((await d.c.post(`/api/assignments/${job.id}/decline`, { reason: "again" })).status).toBe(422);

    // Reassign through the normal workflow to another available transporter; the declined record is preserved
    expect(await availableIds(b.id)).toContain(d.id); // the decliner is free again, and so is the other one
    const again = await request(staff, b.id, e.id);
    expect(again.status).toBe(201);
    const after = (await staff.get(`/api/batches/${b.id}`)).body;
    expect(after.currentAssignment.id).toBe(again.body.id);
    expect(after.assignmentHistory.map((h: { status: string }) => h.status)).toEqual(["declined", "assigned"]);
    expect(after.events.filter((ev: { eventType: string }) => ev.eventType === "declined")).toHaveLength(1);
    expect((await e.c.post(`/api/assignments/${again.body.id}/accept`)).status).toBe(200);
  });

  it("can be declined after acceptance, but not after pickup", async () => {
    const d = await freshDriver();
    const b = await segregated();
    const job = (await request(staff, b.id, d.id)).body;
    await drive(b.id, d, job.id, "accepted");
    expect((await d.c.post(`/api/assignments/${job.id}/decline`, { reason: "Changed my mind" })).status).toBe(200);
    expect((await staff.get(`/api/batches/${b.id}`)).body.status).toBe("segregated");
    const d2 = await freshDriver();
    const b2 = await segregated();
    const job2 = (await request(staff, b2.id, d2.id)).body;
    await drive(b2.id, d2, job2.id, "collected");
    expect((await d2.c.post(`/api/assignments/${job2.id}/decline`, { reason: "Too late" })).status).toBe(422);
  });
});

describe("what the treatment plant can see and do", () => {
  it("only batches really on their way to it appear, at every stage of the journey", async () => {
    const d = await freshDriver();
    const b = await segregated();
    const ids = async (who: Client, q = "") => ((await who.get(`/api/batches?pageSize=100${q}`)).body.items as { id: string }[]).map((x) => x.id);
    const gen = (await staff.post("/api/batches", { categoryId: yellow(), quantity: 1, unit: "kg" })).body;
    expect(await ids(plant)).not.toContain(gen.id); // newly created, unsegregated
    expect(await ids(plant)).not.toContain(b.id); // segregated but not requested
    const job = (await request(staff, b.id, d.id)).body;
    expect(await ids(plant)).not.toContain(b.id); // requested, not yet accepted
    expect((await plant.get(`/api/batches/${b.id}`)).status).toBe(404);
    expect((await plant.get("/api/assignments?pageSize=100")).body.items.map((x: { id: string }) => x.id)).not.toContain(job.id);
    expect((await d.c.post(`/api/assignments/${job.id}/accept`)).status).toBe(200);
    expect(await ids(plant)).not.toContain(b.id); // accepted, not yet collected
    expect((await plant.get("/api/assignments?pageSize=100")).body.items.map((x: { id: string }) => x.id)).toContain(job.id);
    expect((await act(d.c, b.id, "pickup", { scanMethod: "manual", notes: "label damaged, verified by tracking code" })).status).toBe(200);
    expect(await ids(plant, "&status=collected,in_transit")).toContain(b.id); // en route
    expect((await d.c.post(`/api/assignments/${job.id}/start`)).status).toBe(200);
    expect(await ids(plant, "&status=in_transit")).toContain(b.id);
    expect(await ids(plant, "&status=delivered")).not.toContain(b.id);
    expect((await act(d.c, b.id, "handover", {})).status).toBe(200);
    expect(await ids(plant, "&status=delivered")).toContain(b.id); // arrived, awaiting receipt
    expect(await ids(plant, "&status=in_transit")).not.toContain(b.id);
    expect((await act(plant, b.id, "receive", { accepted: true, receivedQuantity: 5, unit: "kg", condition: "intact" })).status).toBe(200);
    expect(await ids(plant, "&status=received")).toContain(b.id);
    expect((await act(plant, b.id, "dispose", { method: "incineration", treatedQuantity: 5, unit: "kg" })).status).toBe(200);
    expect(await ids(plant, "&status=disposed")).toContain(b.id); // history stays reachable
    // Dashboard figures for the plant do not count unrequested hospital batches either
    const kpis = (await plant.get("/api/dashboard")).body.kpis;
    expect(kpis.awaitingCollection).toBe(0);
  });

  it("declined and cancelled collections never reach the plant, and another plant never sees them", async () => {
    const d = await freshDriver();
    const b = await segregated();
    const job = (await request(staff, b.id, d.id)).body;
    await d.c.post(`/api/assignments/${job.id}/accept`);
    await d.c.post(`/api/assignments/${job.id}/decline`, { reason: "No" });
    expect((await plant.get(`/api/batches/${b.id}`)).status).toBe(404);
    expect((await plant.get("/api/assignments?pageSize=100")).body.items.map((x: { id: string }) => x.id)).not.toContain(job.id);
    const c = await freshDriver();
    const b2 = await segregated();
    const job2 = (await request(staff, b2.id, c.id)).body;
    await org.admin.post(`/api/assignments/${job2.id}/cancel`, { reason: "Cancelled" });
    expect((await plant.get(`/api/batches/${b2.id}`)).status).toBe(404);
    // Another plant of the same organization only sees what is addressed to it
    const e = await freshDriver();
    const b3 = await segregated();
    const job3 = (await request(staff, b3.id, e.id)).body;
    await drive(b3.id, e, job3.id, "in_transit");
    expect((await plant2.get(`/api/batches/${b3.id}`)).status).toBe(404);
    expect((await plant2.get("/api/batches?pageSize=100")).body.items.map((x: { id: string }) => x.id)).not.toContain(b3.id);
  });

  it("only staff of the receiving plant can confirm receipt; wrong destination, wrong role and duplicates are rejected", async () => {
    const d = await freshDriver();
    const b = await segregated();
    const job = (await request(staff, b.id, d.id)).body;
    const receipt = { accepted: true, receivedQuantity: 5, unit: "kg", condition: "intact" };
    await drive(b.id, d, job.id, "in_transit");
    expect((await act(plant, b.id, "receive", receipt)).status).toBe(422); // still on the road: not arrived yet
    expect((await act(d.c, b.id, "handover", {})).status).toBe(200);
    for (const [who, expected] of [[plant2, 404], [staff, 422], [staffB, 404], [d.c, 422], [org.admin, 422]] as [Client, number][]) {
      expect((await act(who, b.id, "receive", receipt)).status).toBe(expected);
    }
    expect((await act(d.c, b.id, "handover", {})).status).toBe(422); // arrival cannot be recorded twice
    expect((await act(plant, b.id, "receive", receipt)).status).toBe(200);
    expect((await act(plant, b.id, "receive", receipt)).status).toBe(422); // duplicate
    for (const who of [plant2, staff, d.c, org.admin]) expect([404, 422]).toContain((await act(who, b.id, "dispose", { method: "incineration" })).status);
    expect((await act(plant, b.id, "dispose", { method: "incineration", treatedQuantity: 5, unit: "kg" })).status).toBe(200);
  });
});

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, type Tx } from "../db/client.js";
import { assignmentBatches, assignments, custodyEvents, facilities, memberships, users, wasteBatches } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { humanCode } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, invalidTransition, notFound } from "../lib/errors.js";
import { publish } from "../lib/events.js";
import type { Actor } from "../lib/http.js";
import { notify } from "./notify.js";

type Assignment = typeof assignments.$inferSelect;
type Batch = typeof wasteBatches.$inferSelect;

const newReference = () => `TR-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${humanCode(5)}`;

export async function lockAssignment(tx: Tx, actor: Actor, id: string) {
  const [a] = await tx.select().from(assignments).where(and(eq(assignments.id, id), eq(assignments.organizationId, actor.orgId))).for("update");
  if (!a) throw notFound("Assignment");
  if (actor.role === "transporter" && a.transporterUserId !== actor.userId) throw notFound("Assignment");
  return a;
}

async function assertTransporter(tx: Tx, orgId: string, userId: string) {
  const [m] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.organizationId, orgId), eq(memberships.userId, userId), eq(memberships.role, "transporter"), eq(memberships.status, "active")));
  if (!m) throw badRequest("Choose an active transporter from your organization.");
}

async function assertFacility(tx: Tx, orgId: string, id: string, mustReceive = false) {
  const [f] = await tx.select().from(facilities).where(and(eq(facilities.id, id), eq(facilities.organizationId, orgId), eq(facilities.active, true)));
  if (!f) throw badRequest("Facility not found in this organization.");
  if (mustReceive && !f.canReceive) throw badRequest(`${f.name} is not authorised to receive waste. Enable "can receive" on the facility first.`);
  return f;
}

/** Locks the given batches and verifies they can be placed on an assignment from `originId`. */
async function lockAssignableBatches(tx: Tx, orgId: string, batchIds: string[], originId: string) {
  const rows = await tx
    .select()
    .from(wasteBatches)
    .where(and(eq(wasteBatches.organizationId, orgId), inArray(wasteBatches.id, batchIds)))
    .for("update");
  if (rows.length !== new Set(batchIds).size) throw badRequest("One or more batches were not found.");
  for (const b of rows) {
    if (b.status !== "segregated") throw invalidTransition(`${b.trackingCode} must be segregated (verified) before it can be assigned for collection.`);
    if (b.currentAssignmentId) throw conflict(`${b.trackingCode} is already on another assignment.`);
    if (b.originFacilityId !== originId) throw badRequest(`${b.trackingCode} does not originate at the pickup facility.`);
  }
  return rows;
}

async function linkBatches(tx: Tx, actor: Actor, asg: Assignment, batches: Batch[]) {
  for (const b of batches) {
    await tx.insert(assignmentBatches).values({ assignmentId: asg.id, batchId: b.id });
    await tx
      .update(wasteBatches)
      .set({ currentAssignmentId: asg.id, destinationFacilityId: asg.destinationFacilityId, updatedAt: new Date(), version: sql`${wasteBatches.version} + 1` })
      .where(eq(wasteBatches.id, b.id));
    await tx.insert(custodyEvents).values({
      organizationId: actor.orgId,
      batchId: b.id,
      eventType: "assigned",
      fromStatus: b.status,
      toStatus: b.status,
      actorUserId: actor.userId,
      actorRole: actor.role,
      assignmentId: asg.id,
      facilityId: asg.originFacilityId,
      details: { transporterUserId: asg.transporterUserId, destinationFacilityId: asg.destinationFacilityId, reference: asg.reference },
    });
  }
}

async function unlinkBatches(tx: Tx, actor: Actor, asg: Assignment, batchIds: string[], reason: string) {
  if (!batchIds.length) return;
  const rows = await tx.select().from(wasteBatches).where(inArray(wasteBatches.id, batchIds)).for("update");
  for (const b of rows) {
    if (b.status !== "segregated") throw invalidTransition(`${b.trackingCode} has already been picked up and cannot be removed from the assignment.`);
  }
  await tx.update(assignmentBatches).set({ removedAt: new Date() }).where(and(eq(assignmentBatches.assignmentId, asg.id), inArray(assignmentBatches.batchId, batchIds), isNull(assignmentBatches.removedAt)));
  for (const b of rows) {
    await tx
      .update(wasteBatches)
      .set({ currentAssignmentId: null, destinationFacilityId: null, updatedAt: new Date(), version: sql`${wasteBatches.version} + 1` })
      .where(eq(wasteBatches.id, b.id));
    await tx.insert(custodyEvents).values({ organizationId: actor.orgId, batchId: b.id, eventType: "unassigned", fromStatus: b.status, toStatus: b.status, actorUserId: actor.userId, actorRole: actor.role, assignmentId: asg.id, notes: reason });
  }
}

export interface CreateAssignmentInput {
  transporterUserId: string;
  originFacilityId: string;
  destinationFacilityId: string;
  batchIds: string[];
  scheduledPickupAt: Date;
  dueBy: Date;
  vehicleReg?: string | null;
  notes?: string | null;
}

export async function createAssignment(actor: Actor, input: CreateAssignmentInput) {
  if (input.originFacilityId === input.destinationFacilityId) throw badRequest("Pickup and destination must be different facilities.");
  if (input.dueBy <= input.scheduledPickupAt) throw badRequest("The due time must be after the scheduled pickup.");
  const result = await db.transaction(async (tx) => {
    await assertTransporter(tx, actor.orgId, input.transporterUserId);
    await assertFacility(tx, actor.orgId, input.originFacilityId);
    await assertFacility(tx, actor.orgId, input.destinationFacilityId, true);
    const batches = await lockAssignableBatches(tx, actor.orgId, input.batchIds, input.originFacilityId);
    let vehicle = input.vehicleReg ?? null;
    if (!vehicle) {
      const [m] = await tx.select({ v: memberships.vehicleReg }).from(memberships).where(and(eq(memberships.organizationId, actor.orgId), eq(memberships.userId, input.transporterUserId)));
      vehicle = m?.v ?? null;
    }
    const [asg] = await tx
      .insert(assignments)
      .values({
        organizationId: actor.orgId,
        reference: newReference(),
        transporterUserId: input.transporterUserId,
        originFacilityId: input.originFacilityId,
        destinationFacilityId: input.destinationFacilityId,
        scheduledPickupAt: input.scheduledPickupAt,
        dueBy: input.dueBy,
        vehicleReg: vehicle,
        notes: input.notes ?? null,
        createdById: actor.userId,
      })
      .returning();
    await linkBatches(tx, actor, asg, batches);
    await audit({ organizationId: actor.orgId, actorUserId: actor.userId, action: "assignment.create", entityType: "assignment", entityId: asg.id, metadata: { batches: input.batchIds.length }, ip: actor.ip }, tx);
    await notify(tx, actor.orgId, { userIds: [input.transporterUserId] }, {
      kind: "assignment",
      title: `New transport job ${asg.reference}`,
      body: `${batches.length} batch(es) to collect. Please review and accept.`,
      link: `/assignments/${asg.id}`,
    });
    return asg;
  });
  publish({ type: "assignment", organizationId: actor.orgId, payload: { assignmentId: result.id, status: result.status } });
  return result;
}

type AsgAction = "accept" | "decline" | "start" | "cancel";

export async function assignmentAction(actor: Actor, id: string, action: AsgAction, reason?: string) {
  const result = await db.transaction(async (tx) => {
    const a = await lockAssignment(tx, actor, id);
    const now = new Date();
    const openBatches = await tx
      .select({ b: wasteBatches })
      .from(assignmentBatches)
      .innerJoin(wasteBatches, eq(wasteBatches.id, assignmentBatches.batchId))
      .where(and(eq(assignmentBatches.assignmentId, a.id), isNull(assignmentBatches.removedAt)));
    let patch: Partial<typeof assignments.$inferInsert> = {};

    if (action === "accept") {
      if (a.transporterUserId !== actor.userId) throw forbidden("Only the assigned transporter can accept this job.");
      if (a.status !== "assigned") throw invalidTransition(`This job is already ${a.status.replace("_", " ")}.`);
      patch = { status: "accepted", acceptedAt: now };
    } else if (action === "decline") {
      if (a.transporterUserId !== actor.userId) throw forbidden("Only the assigned transporter can decline this job.");
      if (a.status !== "assigned" && a.status !== "accepted") throw invalidTransition("Jobs can only be declined before pickup.");
      if (!reason) throw badRequest("Please give a reason for declining.");
      await unlinkBatches(tx, actor, a, openBatches.map((r) => r.b.id), `Declined by transporter: ${reason}`);
      patch = { status: "cancelled", cancelledAt: now, cancelReason: `Declined: ${reason}`, trackingActive: false };
      await notify(tx, actor.orgId, { admins: true }, { kind: "assignment", title: `Job ${a.reference} declined`, body: reason, link: `/assignments/${a.id}` });
    } else if (action === "start") {
      if (a.transporterUserId !== actor.userId) throw forbidden("Only the assigned transporter can start this trip.");
      if (a.status !== "accepted") throw invalidTransition(a.status === "assigned" ? "Accept the job before starting the trip." : `This job is already ${a.status.replace("_", " ")}.`);
      if (!openBatches.length) throw invalidTransition("There are no batches on this job.");
      const notPicked = openBatches.filter((r) => r.b.status !== "collected");
      if (notPicked.length) {
        throw invalidTransition(`Scan and pick up every batch before starting. Not yet picked up: ${notPicked.map((r) => r.b.trackingCode).join(", ")}. An admin can remove batches that are not travelling.`);
      }
      for (const { b } of openBatches) {
        await tx.update(wasteBatches).set({ status: "in_transit", statusChangedAt: now, updatedAt: now, version: sql`${wasteBatches.version} + 1` }).where(eq(wasteBatches.id, b.id));
        await tx.insert(custodyEvents).values({ organizationId: actor.orgId, batchId: b.id, eventType: "transit_started", fromStatus: b.status, toStatus: "in_transit", actorUserId: actor.userId, actorRole: actor.role, assignmentId: a.id, facilityId: a.originFacilityId });
      }
      patch = { status: "in_progress", startedAt: now };
    } else if (action === "cancel") {
      if (actor.role !== "admin") throw forbidden("Only an admin can cancel a job.");
      if (a.status === "completed" || a.status === "cancelled") throw invalidTransition(`This job is already ${a.status}.`);
      if (openBatches.some((r) => r.b.status !== "segregated")) throw invalidTransition("Waste has already been picked up on this job, so it cannot be cancelled. Complete the delivery or report an incident.");
      if (!reason) throw badRequest("Please give a reason for cancelling.");
      await unlinkBatches(tx, actor, a, openBatches.map((r) => r.b.id), `Assignment cancelled: ${reason}`);
      patch = { status: "cancelled", cancelledAt: now, cancelReason: reason, trackingActive: false, trackingStoppedAt: a.trackingActive ? now : a.trackingStoppedAt };
      await notify(tx, actor.orgId, { userIds: [a.transporterUserId] }, { kind: "assignment", title: `Job ${a.reference} cancelled`, body: reason, link: `/assignments/${a.id}` });
    }
    const [updated] = await tx.update(assignments).set({ ...patch, updatedAt: now }).where(eq(assignments.id, a.id)).returning();
    await audit({ organizationId: actor.orgId, actorUserId: actor.userId, action: `assignment.${action}`, entityType: "assignment", entityId: a.id, metadata: reason ? { reason } : undefined, ip: actor.ip }, tx);
    return updated;
  });
  publish({ type: "assignment", organizationId: actor.orgId, payload: { assignmentId: result.id, status: result.status } });
  return result;
}

export async function updateAssignment(
  actor: Actor,
  id: string,
  input: { transporterUserId?: string; addBatchIds?: string[]; removeBatchIds?: string[]; dueBy?: Date; vehicleReg?: string | null; notes?: string | null },
) {
  return db.transaction(async (tx) => {
    const a = await lockAssignment(tx, actor, id);
    if (a.status !== "assigned" && a.status !== "accepted") throw invalidTransition("A job can only be edited before the trip starts.");
    const patch: Partial<typeof assignments.$inferInsert> = { updatedAt: new Date() };
    if (input.transporterUserId && input.transporterUserId !== a.transporterUserId) {
      await assertTransporter(tx, actor.orgId, input.transporterUserId);
      const picked = await tx
        .select({ id: wasteBatches.id })
        .from(assignmentBatches)
        .innerJoin(wasteBatches, eq(wasteBatches.id, assignmentBatches.batchId))
        .where(and(eq(assignmentBatches.assignmentId, a.id), isNull(assignmentBatches.removedAt), ne(wasteBatches.status, "segregated")));
      if (picked.length) throw invalidTransition("Waste has already been picked up; the transporter can no longer be changed.");
      patch.transporterUserId = input.transporterUserId;
      patch.status = "assigned";
      patch.acceptedAt = null;
      await notify(tx, actor.orgId, { userIds: [input.transporterUserId] }, { kind: "assignment", title: `New transport job ${a.reference}`, body: "You have been assigned this job.", link: `/assignments/${a.id}` });
      await notify(tx, actor.orgId, { userIds: [a.transporterUserId] }, { kind: "assignment", title: `Job ${a.reference} reassigned`, body: "This job was reassigned to another transporter.", link: `/assignments` });
    }
    if (input.dueBy) {
      if (input.dueBy <= a.scheduledPickupAt) throw badRequest("The due time must be after the scheduled pickup.");
      patch.dueBy = input.dueBy;
    }
    if (input.vehicleReg !== undefined) patch.vehicleReg = input.vehicleReg;
    if (input.notes !== undefined) patch.notes = input.notes;
    const [updated] = await tx.update(assignments).set(patch).where(eq(assignments.id, a.id)).returning();
    if (input.removeBatchIds?.length) {
      const onIt = await tx.select({ batchId: assignmentBatches.batchId }).from(assignmentBatches).where(and(eq(assignmentBatches.assignmentId, a.id), isNull(assignmentBatches.removedAt), inArray(assignmentBatches.batchId, input.removeBatchIds)));
      if (onIt.length !== input.removeBatchIds.length) throw badRequest("Some batches are not on this job.");
      await unlinkBatches(tx, actor, updated, input.removeBatchIds, "Removed from assignment by admin");
    }
    if (input.addBatchIds?.length) {
      const batches = await lockAssignableBatches(tx, actor.orgId, input.addBatchIds, a.originFacilityId);
      await linkBatches(tx, actor, updated, batches);
    }
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(assignmentBatches).where(and(eq(assignmentBatches.assignmentId, a.id), isNull(assignmentBatches.removedAt)));
    if (n === 0) throw badRequest("A job must keep at least one batch. Cancel the job instead.");
    await audit({ organizationId: actor.orgId, actorUserId: actor.userId, action: "assignment.update", entityType: "assignment", entityId: a.id, metadata: { ...input }, ip: actor.ip }, tx);
    return updated;
  });
}

/** Marks an in-progress assignment complete once every batch on it has been handed over. */
export async function completeAssignmentIfDone(tx: Tx, actor: Actor, assignmentId: string) {
  const rows = await tx
    .select({ status: wasteBatches.status })
    .from(assignmentBatches)
    .innerJoin(wasteBatches, eq(wasteBatches.id, assignmentBatches.batchId))
    .where(and(eq(assignmentBatches.assignmentId, assignmentId), isNull(assignmentBatches.removedAt)));
  // The batch being handed over is still "in_transit" in this snapshot only if the caller ran us
  // before updating it; callers run this after their own update, so all statuses are current.
  const done = rows.length > 0 && rows.every((r) => ["delivered", "received", "disposed", "rejected"].includes(r.status));
  if (!done) return false;
  const now = new Date();
  const [a] = await tx
    .update(assignments)
    .set({ status: "completed", completedAt: now, trackingActive: false, trackingStoppedAt: now, updatedAt: now })
    .where(and(eq(assignments.id, assignmentId), eq(assignments.status, "in_progress")))
    .returning();
  if (a) {
    await audit({ organizationId: actor.orgId, actorUserId: actor.userId, action: "assignment.completed", entityType: "assignment", entityId: a.id }, tx);
    setImmediate(() => publish({ type: "assignment", organizationId: actor.orgId, payload: { assignmentId: a.id, status: "completed" } }));
  }
  return !!a;
}

/** A rejected load continues on a new trip to another receiving facility, same transporter. */
export async function createRerouteAssignment(tx: Tx, actor: Actor, batch: Batch, previous: Assignment, destinationFacilityId: string, dueBy: Date, notes?: string) {
  const fromId = batch.destinationFacilityId ?? previous.destinationFacilityId;
  if (destinationFacilityId === fromId) throw badRequest("Choose a different receiving facility.");
  await assertFacility(tx, actor.orgId, destinationFacilityId, true);
  const now = new Date();
  if (dueBy <= now) throw badRequest("The new due time must be in the future.");
  await tx.update(assignmentBatches).set({ removedAt: now }).where(and(eq(assignmentBatches.batchId, batch.id), isNull(assignmentBatches.removedAt)));
  const [asg] = await tx
    .insert(assignments)
    .values({
      organizationId: actor.orgId,
      reference: newReference(),
      transporterUserId: previous.transporterUserId,
      originFacilityId: fromId,
      destinationFacilityId,
      vehicleReg: previous.vehicleReg,
      status: "in_progress",
      scheduledPickupAt: now,
      dueBy,
      notes: notes ?? `Reroute of rejected batch ${batch.trackingCode} from ${previous.reference}`,
      createdById: actor.userId,
      acceptedAt: now,
      startedAt: now,
    })
    .returning();
  await tx.insert(assignmentBatches).values({ assignmentId: asg.id, batchId: batch.id });
  await notify(tx, actor.orgId, { userIds: [previous.transporterUserId] }, {
    kind: "assignment",
    title: `Reroute: ${batch.trackingCode}`,
    body: "A rejected load has a new destination. Turn on location sharing for the new trip.",
    link: `/assignments/${asg.id}`,
  });
  return asg;
}

export async function setTracking(actor: Actor, id: string, on: boolean) {
  const result = await db.transaction(async (tx) => {
    const a = await lockAssignment(tx, actor, id);
    if (a.transporterUserId !== actor.userId) throw forbidden("Only the assigned transporter can share their location for this job.");
    if (on && a.status !== "accepted" && a.status !== "in_progress") throw invalidTransition("Location sharing is only available for accepted or in-progress jobs.");
    const now = new Date();
    const [u] = await tx
      .update(assignments)
      .set(on ? { trackingActive: true, trackingStartedAt: now, updatedAt: now } : { trackingActive: false, trackingStoppedAt: now, updatedAt: now })
      .where(eq(assignments.id, a.id))
      .returning();
    await audit({ organizationId: actor.orgId, actorUserId: actor.userId, action: on ? "tracking.start" : "tracking.stop", entityType: "assignment", entityId: a.id, ip: actor.ip }, tx);
    return u;
  });
  publish({ type: "assignment", organizationId: actor.orgId, payload: { assignmentId: result.id, status: result.status } });
  return result;
}

export { users };

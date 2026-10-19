/**
 * Waste lifecycle state machine.
 *
 *   generated → segregated → collected → in_transit → delivered → received → disposed
 *        ↘ cancelled  ↘ cancelled                         ↘ rejected → (reroute) → in_transit
 *
 * Every transition:
 *  - runs in a transaction with the batch row locked (SELECT … FOR UPDATE),
 *  - is checked by the same `check` function used to show available actions in the UI,
 *  - writes an append-only custody event (and optional receipt / disposal record),
 *  - supports an Idempotency-Key so a retried request cannot double-apply.
 */
import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db/client.js";
import {
  assignmentBatches,
  assignments,
  containerIdentifiers,
  containers,
  custodyEvents,
  disposalMethodEnum,
  disposalRecords,
  facilities,
  incidents,
  organizations,
  quantityUnitEnum,
  receiptConditionEnum,
  receiptRecords,
  scanMethodEnum,
  wasteBatches,
  wasteCategories,
  type BatchStatus,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { assertDisposalTime, orgTimezone } from "../lib/dates.js";
import { AppError, badRequest, invalidTransition, notFound } from "../lib/errors.js";
import { publish } from "../lib/events.js";
import type { Actor } from "../lib/http.js";
import { normalizeIdentifier } from "./identification.js";
import { notify } from "./notify.js";
import { readSettings } from "./settings.js";
import { raiseAlert } from "./alerts.js";
import { completeAssignmentIfDone, createRerouteAssignment } from "./assignments.js";

type Batch = typeof wasteBatches.$inferSelect;
type Assignment = typeof assignments.$inferSelect;

export const actionNames = ["segregate", "cancel", "pickup", "handover", "receive", "dispose", "reroute"] as const;
export type ActionName = (typeof actionNames)[number];

const scanFields = {
  scanMethod: z.enum(scanMethodEnum.enumValues).default("manual"),
  /** The scanned identifier (QR token / URL, RFID or NFC UID). Required unless scanMethod is manual. */
  identifier: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
};

export const actionBodies = {
  segregate: z.object({
    confirmSegregation: z.literal(true, { message: "Confirm that segregation was checked" }),
    notes: z.string().trim().max(2000).optional(),
    /** Optional: present when the checker scanned a label while verifying. */
    scanMethod: z.enum(scanMethodEnum.enumValues).optional(),
  }),
  cancel: z.object({ reason: z.string().trim().min(3, "A reason is required").max(2000) }),
  pickup: z.object(scanFields),
  handover: z.object(scanFields),
  receive: z.object({
    accepted: z.boolean(),
    receivedQuantity: z.number().nonnegative().max(1_000_000),
    unit: z.enum(quantityUnitEnum.enumValues),
    condition: z.enum(receiptConditionEnum.enumValues),
    notes: z.string().trim().max(2000).optional(),
    scanMethod: z.enum(scanMethodEnum.enumValues).default("manual"),
    identifier: z.string().trim().max(500).optional(),
  }),
  dispose: z.object({
    method: z.enum(disposalMethodEnum.enumValues),
    treatedQuantity: z.number().positive().max(1_000_000).optional(),
    unit: z.enum(quantityUnitEnum.enumValues).optional(),
    documentRef: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(2000).optional(),
    disposedAt: z.coerce.date().optional(),
  }),
  reroute: z.object({
    destinationFacilityId: z.string().uuid(),
    dueBy: z.coerce.date(),
    notes: z.string().trim().max(2000).optional(),
  }),
} satisfies Record<ActionName, z.ZodType>;

interface CheckCtx {
  batch: Batch;
  actor: Actor;
  assignment: Assignment | null;
}

const atFacility = (a: Actor, facilityId: string | null) =>
  a.role === "admin" || (a.role === "facility_staff" && !!facilityId && a.facilityIds.includes(facilityId));
/** Staff assigned to this facility. Unlike atFacility, an organization admin does NOT count: plant steps belong to plant staff. */
const staffAt = (a: Actor, facilityId: string | null) => a.role === "facility_staff" && !!facilityId && a.facilityIds.includes(facilityId);
const isAssignedTransporter = (a: Actor, asg: Assignment | null) =>
  !!asg && a.role === "transporter" && asg.transporterUserId === a.userId;

interface ActionDef {
  label: string;
  from: BatchStatus[];
  to: BatchStatus | ((body: never) => BatchStatus);
  /** Returns a human-readable reason the actor may not perform this now, or null if allowed. */
  check: (c: CheckCtx) => string | null;
}

const statusLabel: Record<BatchStatus, string> = {
  generated: "generated",
  segregated: "segregated",
  collected: "collected",
  in_transit: "in transit",
  delivered: "delivered",
  received: "received",
  disposed: "disposed",
  rejected: "rejected",
  cancelled: "cancelled",
};

export const actions: Record<ActionName, ActionDef> = {
  segregate: {
    label: "Verify segregation",
    from: ["generated"],
    to: "segregated",
    check: ({ batch, actor }) => (atFacility(actor, batch.originFacilityId) ? null : "Only staff assigned to the origin facility (or an admin) can verify segregation."),
  },
  cancel: {
    label: "Cancel batch",
    from: ["generated", "segregated"],
    to: "cancelled",
    check: ({ batch, actor }) => {
      if (!atFacility(actor, batch.originFacilityId)) return "Only origin-facility staff or an admin can cancel a batch.";
      if (batch.currentAssignmentId) return "Remove the batch from its transport assignment before cancelling.";
      return null;
    },
  },
  pickup: {
    label: "Confirm pickup (take custody)",
    from: ["segregated"],
    to: "collected",
    check: ({ batch, actor, assignment }) => {
      if (!assignment) return "Waiting for the hospital to request collection; the assigned transporter then confirms pickup.";
      if (!isAssignedTransporter(actor, assignment) && !atFacility(actor, batch.originFacilityId)) return "Only the assigned transporter or origin-facility staff can record pickup.";
      if (assignment.status === "assigned") return "The transporter must accept the assignment before pickup.";
      if (assignment.status !== "accepted") return `Pickup is not possible while the assignment is ${assignment.status.replace("_", " ")}.`;
      return null;
    },
  },
  handover: {
    // Arrival at the plant. The batch becomes "delivered" (shown as Arrived — awaiting receipt); it is NOT received until plant staff confirm.
    label: "Mark arrived at treatment plant",
    from: ["in_transit"],
    to: "delivered",
    check: ({ actor, assignment }) => {
      if (!assignment || assignment.status !== "in_progress") return "The transport assignment must be in progress.";
      if (!isAssignedTransporter(actor, assignment)) return "Only the assigned transporter can record the arrival.";
      return null;
    },
  },
  receive: {
    label: "Confirm receipt",
    from: ["delivered"],
    to: (b: { accepted: boolean }) => (b.accepted ? "received" : "rejected"),
    check: ({ batch, actor }) => (staffAt(actor, batch.destinationFacilityId) ? null : "Only treatment-plant staff at the receiving facility can confirm receipt."),
  },
  dispose: {
    label: "Record disposal",
    from: ["received"],
    to: "disposed",
    check: ({ batch, actor }) => (staffAt(actor, batch.destinationFacilityId) ? null : "Only treatment-plant staff at the receiving facility can record disposal."),
  },
  reroute: {
    label: "Reroute rejected load",
    from: ["rejected"],
    to: "in_transit",
    check: ({ actor }) => (actor.role === "admin" ? null : "Only an admin can reroute a rejected load."),
  },
};

function whyNot(name: ActionName, c: CheckCtx): string | null {
  const def = actions[name];
  if (!def.from.includes(c.batch.status)) {
    const allowed = def.from.map((s) => statusLabel[s]).join(" or ");
    return `This batch is ${statusLabel[c.batch.status]}; "${def.label}" is only possible when it is ${allowed}.`;
  }
  return def.check(c);
}

/** Actions shown in the UI: those valid for the current status, with an enabled flag + reason. */
export function availableActions(c: CheckCtx) {
  return actionNames
    .filter((n) => actions[n].from.includes(c.batch.status))
    .map((n) => {
      const reason = actions[n].check(c);
      return { action: n, label: actions[n].label, enabled: reason === null, reason };
    })
    .filter((a) => a.enabled || a.reason); // keep disabled ones so the UI can explain why
}

async function loadAssignment(tx: Tx, id: string | null) {
  if (!id) return null;
  const [a] = await tx.select().from(assignments).where(eq(assignments.id, id));
  return a ?? null;
}

/** Validates a scanned identifier belongs to this batch; returns the container id. */
async function verifyScan(tx: Tx, batch: Batch, scanMethod: string, identifier?: string) {
  if (scanMethod === "manual") return null;
  if (!identifier) throw badRequest("Scan the container label (or switch to manual entry with a note).");
  const norm = normalizeIdentifier(scanMethod as "qr" | "rfid" | "nfc", identifier);
  const [hit] = await tx
    .select({ containerId: containers.id, batchId: containers.batchId })
    .from(containerIdentifiers)
    .innerJoin(containers, eq(containers.id, containerIdentifiers.containerId))
    .where(and(eq(containerIdentifiers.method, scanMethod as "qr"), eq(containerIdentifiers.value, norm), eq(containerIdentifiers.active, true), eq(containerIdentifiers.organizationId, batch.organizationId)));
  if (!hit) throw badRequest("The scanned label is not registered in this organization.");
  if (hit.batchId !== batch.id) throw badRequest("The scanned container belongs to a different batch. Check you have the right container.");
  return hit.containerId;
}

export interface PerformResult {
  batch: Batch;
  replayed: boolean;
}

export async function performAction(
  actor: Actor,
  batchId: string,
  name: ActionName,
  rawBody: unknown,
  idempotencyKey?: string,
  /** Demo mode: the QR token was supplied by the server, not read by a camera. Recorded on the event. */
  opts: { simulatedScan?: boolean } = {},
): Promise<PerformResult> {
  const parsed = actionBodies[name].safeParse(rawBody ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(`${issue.path.join(".") || "body"}: ${issue.message}`);
  }
  const body = parsed.data as Record<string, unknown> & { notes?: string; scanMethod?: string; identifier?: string; latitude?: number; longitude?: number };

  try {
    return await db.transaction(async (tx) => {
      if (idempotencyKey) {
        const [prior] = await tx
          .select({ id: custodyEvents.id })
          .from(custodyEvents)
          .where(and(eq(custodyEvents.organizationId, actor.orgId), eq(custodyEvents.idempotencyKey, idempotencyKey)));
        if (prior) {
          const [b] = await tx.select().from(wasteBatches).where(eq(wasteBatches.id, batchId));
          return { batch: b, replayed: true };
        }
      }
      const [batch] = await tx
        .select()
        .from(wasteBatches)
        .where(and(eq(wasteBatches.id, batchId), eq(wasteBatches.organizationId, actor.orgId)))
        .for("update");
      if (!batch) throw notFound("Batch");
      const assignment = await loadAssignment(tx, batch.currentAssignmentId);
      if (!canView(actor, batch, assignment)) throw notFound("Batch");
      const reason = whyNot(name, { batch, actor, assignment });
      if (reason) throw invalidTransition(reason, { action: name, status: batch.status });

      const now = new Date();
      const def = actions[name];
      const to = typeof def.to === "function" ? (def.to as (b: unknown) => BatchStatus)(body) : def.to;
      const patch: Partial<typeof wasteBatches.$inferInsert> = {};
      const event: Partial<typeof custodyEvents.$inferInsert> = {
        notes: body.notes ?? null,
        scanMethod: (body.scanMethod as "qr") ?? null,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        assignmentId: batch.currentAssignmentId,
      };
      if (opts.simulatedScan) event.details = { simulatedScan: true };
      let eventType: (typeof custodyEvents.$inferInsert)["eventType"];
      const afterCommit: (() => Promise<void>)[] = [];

      switch (name) {
        case "segregate": {
          eventType = "segregated";
          patch.segregationVerified = true;
          if (body.notes) patch.segregationNotes = body.notes;
          event.facilityId = batch.originFacilityId;
          break;
        }
        case "cancel": {
          eventType = "cancelled";
          event.notes = String(body.reason);
          event.facilityId = batch.originFacilityId;
          patch.currentCustodianUserId = null;
          break;
        }
        case "pickup": {
          if (body.scanMethod === "manual" && !body.notes) throw badRequest("A note is required when pickup is recorded without scanning (e.g. label damaged).");
          event.containerId = await verifyScan(tx, batch, String(body.scanMethod), body.identifier);
          eventType = "pickup";
          event.facilityId = batch.originFacilityId;
          event.fromCustodianFacilityId = batch.currentCustodianFacilityId;
          event.toCustodianUserId = assignment!.transporterUserId;
          patch.currentCustodianFacilityId = null;
          patch.currentCustodianUserId = assignment!.transporterUserId;
          break;
        }
        case "handover": {
          // The transporter records arrival without scanning; the treatment plant scans (or selects) the batch to confirm receipt.
          event.containerId = body.scanMethod && body.scanMethod !== "manual" ? await verifyScan(tx, batch, String(body.scanMethod), body.identifier) : null;
          if (!body.scanMethod || body.scanMethod === "manual") event.scanMethod = null; // arrival is not a scan
          eventType = "handover";
          event.facilityId = batch.destinationFacilityId;
          event.fromCustodianUserId = batch.currentCustodianUserId;
          event.toCustodianFacilityId = batch.destinationFacilityId;
          patch.currentCustodianUserId = null;
          patch.currentCustodianFacilityId = batch.destinationFacilityId;
          afterCommit.push(async () => {
            await notify(db, actor.orgId, { facilityStaffAt: [batch.destinationFacilityId] }, {
              kind: "handover",
              title: `Arrived at your plant: ${batch.trackingCode}`,
              body: "The transporter has arrived. Open the batch and confirm receipt.",
              link: `/batches/${batch.id}`,
            });
          });
          break;
        }
        case "receive": {
          const b = body as unknown as z.infer<typeof actionBodies.receive>;
          event.containerId = b.scanMethod !== "manual" ? await verifyScan(tx, batch, b.scanMethod, b.identifier) : null;
          if (!b.accepted && !b.notes) throw badRequest("Explain why the delivery is being rejected.");
          eventType = b.accepted ? "received" : "rejected";
          event.facilityId = batch.destinationFacilityId;
          event.fromCustodianFacilityId = batch.destinationFacilityId;
          event.details = { ...(event.details as object | undefined), receivedQuantity: b.receivedQuantity, unit: b.unit, condition: b.condition };
          await tx.insert(receiptRecords).values({
            organizationId: actor.orgId,
            batchId: batch.id,
            facilityId: batch.destinationFacilityId!,
            assignmentId: batch.currentAssignmentId,
            receivedById: actor.userId,
            accepted: b.accepted,
            receivedQuantity: b.receivedQuantity,
            unit: b.unit,
            condition: b.condition,
            notes: b.notes ?? null,
          });
          if (b.accepted) {
            patch.currentCustodianFacilityId = batch.destinationFacilityId;
            patch.currentCustodianUserId = null;
          } else {
            // A rejected load physically stays with the transporter.
            const transporter = assignment?.transporterUserId ?? null;
            patch.currentCustodianFacilityId = null;
            patch.currentCustodianUserId = transporter;
            event.toCustodianUserId = transporter;
          }
          if (!b.accepted) {
            afterCommit.push(async () => {
              await raiseAlert({
                organizationId: actor.orgId,
                type: "failed_receipt",
                severity: "high",
                title: `Delivery rejected: ${batch.trackingCode}`,
                message: `Receiving facility rejected the load. Reason: ${b.notes}`,
                batchId: batch.id,
                assignmentId: batch.currentAssignmentId,
                facilityId: batch.destinationFacilityId,
                dedupeKey: `failed_receipt:${batch.id}:${now.getTime()}`,
              });
            });
          }
          break;
        }
        case "dispose": {
          const b = body as unknown as z.infer<typeof actionBodies.dispose>;
          if (b.disposedAt) {
            const [rc] = await tx.select({ at: receiptRecords.receivedAt }).from(receiptRecords).where(and(eq(receiptRecords.batchId, batch.id), eq(receiptRecords.accepted, true))).orderBy(desc(receiptRecords.receivedAt)).limit(1);
            assertDisposalTime(b.disposedAt, rc?.at ?? null, await orgTimezone(actor.orgId), now.getTime());
          }
          const [dest] = await tx.select().from(facilities).where(eq(facilities.id, batch.destinationFacilityId!));
          if (!dest?.canReceive) throw invalidTransition("The receiving facility is not authorised for disposal in this organization's settings.");
          const [cat] = await tx.select({ allowed: wasteCategories.allowedDisposalMethods, name: wasteCategories.name }).from(wasteCategories).where(eq(wasteCategories.id, batch.categoryId));
          if (cat.allowed.length && !cat.allowed.includes(b.method)) {
            throw invalidTransition(`"${b.method.replaceAll("_", " ")}" is not a configured disposal method for ${cat.name}.`, { allowed: cat.allowed });
          }
          await tx.insert(disposalRecords).values({
            organizationId: actor.orgId,
            batchId: batch.id,
            facilityId: dest.id,
            method: b.method,
            treatedQuantity: b.treatedQuantity ?? null,
            unit: b.unit ?? null,
            performedById: actor.userId,
            documentRef: b.documentRef ?? null,
            notes: b.notes ?? null,
            disposedAt: b.disposedAt ?? now,
          });
          eventType = "disposed";
          event.facilityId = dest.id;
          event.details = { method: b.method, documentRef: b.documentRef ?? null };
          patch.currentCustodianFacilityId = null;
          patch.currentCustodianUserId = null;
          break;
        }
        case "reroute": {
          const b = body as unknown as z.infer<typeof actionBodies.reroute>;
          if (!assignment) throw invalidTransition("This batch has no transport assignment to reroute.");
          const newAsg = await createRerouteAssignment(tx, actor, batch, assignment, b.destinationFacilityId, b.dueBy, b.notes);
          eventType = "rerouted";
          event.assignmentId = newAsg.id;
          event.facilityId = b.destinationFacilityId;
          event.details = { previousAssignmentId: assignment.id, previousDestinationFacilityId: batch.destinationFacilityId };
          patch.destinationFacilityId = b.destinationFacilityId;
          patch.currentAssignmentId = newAsg.id;
          break;
        }
      }

      const [updated] = await tx
        .update(wasteBatches)
        .set({ ...patch, status: to, statusChangedAt: now, updatedAt: now, version: sql`${wasteBatches.version} + 1` })
        .where(and(eq(wasteBatches.id, batch.id), eq(wasteBatches.version, batch.version)))
        .returning();
      if (!updated) throw new AppError(409, "conflict", "This batch was changed by someone else. Refresh and try again.");

      await tx.insert(custodyEvents).values({
        ...event,
        organizationId: actor.orgId,
        batchId: batch.id,
        eventType: eventType!,
        fromStatus: batch.status,
        toStatus: to,
        actorUserId: actor.userId,
        actorRole: actor.role,
        idempotencyKey: idempotencyKey ?? null,
      });
      await audit({ organizationId: actor.orgId, actorUserId: actor.userId, action: `batch.${name}`, entityType: "batch", entityId: batch.id, metadata: { from: batch.status, to }, ip: actor.ip }, tx);

      if (name === "handover" && batch.currentAssignmentId) await completeAssignmentIfDone(tx, actor, batch.currentAssignmentId);
      if (name === "receive" || name === "dispose") {
        // These close transport-related alerts for the batch.
        await tx.execute(sql`update alerts set status = 'resolved', resolved_at = now(), auto_resolved = true
          where organization_id = ${actor.orgId} and batch_id = ${batch.id} and status = 'open'
          and type in ('pending_receipt','missing_handover','delayed_transport','overdue_collection')`);
      }
      if (name === "pickup") {
        await tx.execute(sql`update alerts set status = 'resolved', resolved_at = now(), auto_resolved = true
          where organization_id = ${actor.orgId} and batch_id = ${batch.id} and status = 'open' and type = 'overdue_collection'`);
      }

      return { batch: updated, replayed: false, afterCommit } as PerformResult & { afterCommit: typeof afterCommit };
    }).then(async (r) => {
      const withHooks = r as PerformResult & { afterCommit?: (() => Promise<void>)[] };
      for (const fn of withHooks.afterCommit ?? []) await fn().catch(() => undefined);
      publish({ type: "batch", organizationId: actor.orgId, payload: { batchId: r.batch.id, status: r.batch.status } });
      return { batch: r.batch, replayed: r.replayed };
    });
  } catch (err) {
    if (err instanceof AppError && err.code === "invalid_transition") await recordInvalidAttempt(actor, batchId, name, err.message);
    if ((err as { code?: string }).code === "23505" && idempotencyKey) {
      // Two identical requests raced; the other one won.
      const [b] = await db.select().from(wasteBatches).where(eq(wasteBatches.id, batchId));
      return { batch: b, replayed: true };
    }
    throw err;
  }
}

async function recordInvalidAttempt(actor: Actor, batchId: string, action: string, message: string) {
  await audit({ organizationId: actor.orgId, actorUserId: actor.userId, action: "lifecycle.invalid_transition", entityType: "batch", entityId: batchId, metadata: { action, message }, ip: actor.ip }).catch(() => undefined);
  const day = new Date().toISOString().slice(0, 10);
  await raiseAlert({
    organizationId: actor.orgId,
    type: "invalid_transition",
    severity: "low",
    title: "Blocked lifecycle action",
    message: `An attempt to "${action}" was blocked: ${message}`,
    batchId,
    dedupeKey: `invalid:${batchId}:${action}:${day}`,
    adminOnly: true,
  }).catch(() => undefined);
}

/**
 * Statuses a treatment plant may see for batches addressed to it: from "collected" (on its way) onward. Batches that are
 * only generated or segregated, requested but not yet accepted, declined or cancelled never reach the plant's views.
 */
export const PLANT_VISIBLE_STATUSES = ["collected", "in_transit", "delivered", "received", "disposed", "rejected"] as const;

/**
 * Read access to a batch:
 *  admin → all org batches; facility staff → batches originating at or destined for their facilities;
 *  transporter → batches currently or previously on their assignments.
 */
export function canView(actor: Actor, batch: Batch, assignment: Assignment | null, wasOnTransporterAssignment = false) {
  if (actor.role === "admin") return true;
  if (actor.role === "facility_staff")
    return actor.facilityIds.includes(batch.originFacilityId) || (!!batch.destinationFacilityId && actor.facilityIds.includes(batch.destinationFacilityId) && (PLANT_VISIBLE_STATUSES as readonly string[]).includes(batch.status));
  return (assignment?.transporterUserId === actor.userId) || wasOnTransporterAssignment;
}

/** SQL filter equivalent of canView for list queries. */
export function visibilityFilter(actor: Actor) {
  if (actor.role === "admin") return undefined;
  if (actor.role === "facility_staff") {
    if (!actor.facilityIds.length) return sql`false`;
    const ids = sql.join(actor.facilityIds.map((id) => sql`${id}::uuid`), sql`, `);
    return sql`(${wasteBatches.originFacilityId} in (${ids}) or (${wasteBatches.destinationFacilityId} in (${ids}) and ${wasteBatches.status} in ('collected','in_transit','delivered','received','disposed','rejected')))`;
  }
  return sql`exists (select 1 from ${assignmentBatches} ab join ${assignments} a on a.id = ab.assignment_id
    where ab.batch_id = ${wasteBatches.id} and a.transporter_user_id = ${actor.userId} and a.status not in ('declined','cancelled'))`;
}

export async function transporterHadBatch(tx: Tx, actor: Actor, batchId: string) {
  if (actor.role !== "transporter") return false;
  const rows = await tx
    .select({ id: assignmentBatches.id })
    .from(assignmentBatches)
    .innerJoin(assignments, eq(assignments.id, assignmentBatches.assignmentId))
    .where(and(eq(assignmentBatches.batchId, batchId), eq(assignments.transporterUserId, actor.userId), notInArray(assignments.status, ["declined", "cancelled"])))
    .limit(1);
  return rows.length > 0;
}

export { isNull };

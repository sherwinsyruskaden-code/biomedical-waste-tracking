import { Router } from "express";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import QRCode from "qrcode";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  assignmentBatches,
  assignments,
  batchStatusEnum,
  containerIdentifiers,
  containers,
  custodyEvents,
  disposalRecords,
  facilities,
  incidents,
  organizations,
  quantityUnitEnum,
  receiptRecords,
  users,
  wasteBatches,
  wasteCategories,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { humanCode } from "../lib/crypto.js";
import { badRequest, forbidden, invalidTransition, notFound } from "../lib/errors.js";
import { publish } from "../lib/events.js";
import { actorOf, route, zId, zOptionalText, zPage, type Actor } from "../lib/http.js";
import { createQrIdentifier, qrPayload } from "../services/identification.js";
import { actionNames, availableActions, canView, performAction, transporterHadBatch, visibilityFilter } from "../services/lifecycle.js";
import { readSettings } from "../services/settings.js";

export const router = Router();
const base = "/api";

const origin = alias(facilities, "origin");
const dest = alias(facilities, "dest");

const batchCreate = z.object({
  originFacilityId: zId,
  categoryId: zId,
  quantity: z.number().positive("Quantity must be greater than zero").max(1_000_000),
  unit: z.enum(quantityUnitEnum.enumValues),
  containerCount: z.number().int().min(1).max(50).default(1),
  containerType: zOptionalText(80),
  sourceArea: zOptionalText(120),
  destinationFacilityId: zId.nullable().optional(),
  segregationNotes: zOptionalText(2000),
  handlingNotes: zOptionalText(2000),
});

async function validateRefs(actor: Actor, b: { originFacilityId: string; categoryId: string; destinationFacilityId?: string | null }) {
  const [o] = await db.select().from(facilities).where(and(eq(facilities.id, b.originFacilityId), eq(facilities.organizationId, actor.orgId), eq(facilities.active, true)));
  if (!o) throw badRequest("Origin facility not found.", { fields: { originFacilityId: "Not found" } });
  if (actor.role === "facility_staff" && !actor.facilityIds.includes(o.id)) throw forbidden("You can only register waste at facilities you are assigned to.");
  const [c] = await db.select().from(wasteCategories).where(and(eq(wasteCategories.id, b.categoryId), eq(wasteCategories.organizationId, actor.orgId), eq(wasteCategories.active, true)));
  if (!c) throw badRequest("Waste category not found.", { fields: { categoryId: "Not found" } });
  if (b.destinationFacilityId) {
    if (b.destinationFacilityId === o.id) throw badRequest("Destination must differ from the origin facility.");
    const [d] = await db.select().from(facilities).where(and(eq(facilities.id, b.destinationFacilityId), eq(facilities.organizationId, actor.orgId), eq(facilities.active, true)));
    if (!d) throw badRequest("Destination facility not found.");
    if (!d.canReceive) throw badRequest(`${d.name} is not authorised to receive waste.`);
  }
  return { origin: o, category: c };
}

route(router, base, { method: "post", path: "/batches", summary: "Register a new waste batch (creates containers + QR labels)", tag: "Batches", access: "member", roles: ["admin", "facility_staff"], body: batchCreate }, async (ctx) => {
  const a = actorOf(ctx);
  const b = ctx.body;
  await validateRefs(a, b);
  const [org] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, a.orgId));
  const settings = readSettings(org.settings);
  const created = await db.transaction(async (tx) => {
    const now = new Date();
    const datePart = now.toISOString().slice(2, 10).replaceAll("-", "");
    let batch;
    for (let attempt = 0; attempt < 5 && !batch; attempt++) {
      const trackingCode = `BW-${datePart}-${humanCode(6)}`;
      const exists = await tx.select({ id: wasteBatches.id }).from(wasteBatches).where(eq(wasteBatches.trackingCode, trackingCode));
      if (exists.length) continue;
      [batch] = await tx
        .insert(wasteBatches)
        .values({
          organizationId: a.orgId,
          trackingCode,
          originFacilityId: b.originFacilityId,
          destinationFacilityId: b.destinationFacilityId ?? null,
          categoryId: b.categoryId,
          quantity: b.quantity,
          unit: b.unit,
          containerCount: b.containerCount,
          containerType: b.containerType,
          sourceArea: b.sourceArea,
          segregationNotes: b.segregationNotes,
          handlingNotes: b.handlingNotes,
          responsibleUserId: a.userId,
          currentCustodianFacilityId: b.originFacilityId,
          collectionDueAt: new Date(now.getTime() + settings.collectionOverdueHours * 3600_000),
        })
        .returning();
    }
    if (!batch) throw new Error("Could not allocate a tracking code");
    for (let i = 1; i <= b.containerCount; i++) {
      const [c] = await tx.insert(containers).values({ organizationId: a.orgId, batchId: batch.id, label: `${batch.trackingCode}-C${i}`, sequence: i }).returning();
      await createQrIdentifier(tx, a.orgId, c.id, a.userId);
    }
    await tx.insert(custodyEvents).values({
      organizationId: a.orgId,
      batchId: batch.id,
      eventType: "created",
      toStatus: "generated",
      actorUserId: a.userId,
      actorRole: a.role,
      facilityId: batch.originFacilityId,
      toCustodianFacilityId: batch.originFacilityId,
      details: { quantity: b.quantity, unit: b.unit, containers: b.containerCount },
    });
    await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "batch.create", entityType: "batch", entityId: batch.id, metadata: { trackingCode: batch.trackingCode }, ip: a.ip }, tx);
    return batch;
  });
  publish({ type: "batch", organizationId: a.orgId, payload: { batchId: created.id, status: created.status } });
  ctx.res.status(201);
  return created;
});

const listQuery = zPage.extend({
  q: z.string().trim().max(100).optional(),
  status: z.string().max(200).optional(), // comma-separated
  categoryId: zId.optional(),
  facilityId: zId.optional(),
  assignmentId: zId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  assignable: z.enum(["true"]).optional(),
  sort: z.enum(["newest", "oldest"]).default("newest"),
});

route(router, base, { method: "get", path: "/batches", summary: "Search and filter batches (paginated)", tag: "Batches", access: "member", query: listQuery }, async (ctx) => {
  const a = actorOf(ctx);
  const q = ctx.query;
  const statuses = q.status?.split(",").filter((s): s is (typeof batchStatusEnum.enumValues)[number] => (batchStatusEnum.enumValues as readonly string[]).includes(s));
  const where = and(
    eq(wasteBatches.organizationId, a.orgId),
    visibilityFilter(a),
    q.q ? or(ilike(wasteBatches.trackingCode, `%${q.q}%`), ilike(wasteBatches.sourceArea, `%${q.q}%`)) : undefined,
    statuses?.length ? inArray(wasteBatches.status, statuses) : undefined,
    q.categoryId ? eq(wasteBatches.categoryId, q.categoryId) : undefined,
    q.facilityId ? or(eq(wasteBatches.originFacilityId, q.facilityId), eq(wasteBatches.destinationFacilityId, q.facilityId)) : undefined,
    q.assignmentId ? eq(wasteBatches.currentAssignmentId, q.assignmentId) : undefined,
    q.from ? gte(wasteBatches.createdAt, q.from) : undefined,
    q.to ? lte(wasteBatches.createdAt, q.to) : undefined,
    q.assignable ? and(eq(wasteBatches.status, "segregated"), isNull(wasteBatches.currentAssignmentId)) : undefined,
  );
  const items = await db
    .select({
      id: wasteBatches.id,
      trackingCode: wasteBatches.trackingCode,
      status: wasteBatches.status,
      quantity: wasteBatches.quantity,
      unit: wasteBatches.unit,
      containerCount: wasteBatches.containerCount,
      sourceArea: wasteBatches.sourceArea,
      createdAt: wasteBatches.createdAt,
      statusChangedAt: wasteBatches.statusChangedAt,
      collectionDueAt: wasteBatches.collectionDueAt,
      currentAssignmentId: wasteBatches.currentAssignmentId,
      originFacilityId: wasteBatches.originFacilityId,
      destinationFacilityId: wasteBatches.destinationFacilityId,
      category: { id: wasteCategories.id, code: wasteCategories.code, name: wasteCategories.name, colorHex: wasteCategories.colorHex },
      originName: origin.name,
      destinationName: dest.name,
    })
    .from(wasteBatches)
    .innerJoin(wasteCategories, eq(wasteCategories.id, wasteBatches.categoryId))
    .innerJoin(origin, eq(origin.id, wasteBatches.originFacilityId))
    .leftJoin(dest, eq(dest.id, wasteBatches.destinationFacilityId))
    .where(where)
    .orderBy(q.sort === "newest" ? desc(wasteBatches.createdAt) : asc(wasteBatches.createdAt))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(wasteBatches).where(where);
  return { items, total, page: q.page, pageSize: q.pageSize };
});

/** Loads a batch the actor may see, or throws 404 (never 403, to avoid confirming existence). */
export async function loadVisibleBatch(a: Actor, batchId: string) {
  const [batch] = await db.select().from(wasteBatches).where(and(eq(wasteBatches.id, batchId), eq(wasteBatches.organizationId, a.orgId)));
  if (!batch) throw notFound("Batch");
  const [asg] = batch.currentAssignmentId ? await db.select().from(assignments).where(eq(assignments.id, batch.currentAssignmentId)) : [];
  if (!canView(a, batch, asg ?? null, await transporterHadBatch(db, a, batch.id))) throw notFound("Batch");
  return { batch, assignment: asg ?? null };
}

const actorU = alias(users, "actor_u");
const fromU = alias(users, "from_u");
const toU = alias(users, "to_u");
const evFac = alias(facilities, "ev_fac");
const fromF = alias(facilities, "from_f");
const toF = alias(facilities, "to_f");

route(router, base, { method: "get", path: "/batches/:batchId", summary: "Batch detail with containers, timeline, receipt, disposal and allowed actions", tag: "Batches", access: "member" }, async (ctx) => {
  const a = actorOf(ctx);
  const { batch, assignment } = await loadVisibleBatch(a, ctx.params.batchId);
  const [category] = await db.select().from(wasteCategories).where(eq(wasteCategories.id, batch.categoryId));
  const facs = await db.select().from(facilities).where(inArray(facilities.id, [batch.originFacilityId, batch.destinationFacilityId].filter((x): x is string => !!x)));
  const [responsible] = await db.select({ id: users.id, fullName: users.fullName }).from(users).where(eq(users.id, batch.responsibleUserId));
  const ctrs = await db
    .select({ id: containers.id, label: containers.label, sequence: containers.sequence })
    .from(containers)
    .where(eq(containers.batchId, batch.id))
    .orderBy(asc(containers.sequence));
  const tags = await db
    .select({ id: containerIdentifiers.id, containerId: containerIdentifiers.containerId, method: containerIdentifiers.method, value: containerIdentifiers.value, createdAt: containerIdentifiers.createdAt })
    .from(containerIdentifiers)
    .where(and(inArray(containerIdentifiers.containerId, ctrs.map((c) => c.id).concat("00000000-0000-0000-0000-000000000000")), eq(containerIdentifiers.active, true)));
  const events = await db
    .select({
      id: custodyEvents.id,
      eventType: custodyEvents.eventType,
      fromStatus: custodyEvents.fromStatus,
      toStatus: custodyEvents.toStatus,
      actorName: actorU.fullName,
      actorRole: custodyEvents.actorRole,
      facilityName: evFac.name,
      fromCustodianUser: fromU.fullName,
      toCustodianUser: toU.fullName,
      fromCustodianFacility: fromF.name,
      toCustodianFacility: toF.name,
      assignmentId: custodyEvents.assignmentId,
      scanMethod: custodyEvents.scanMethod,
      containerId: custodyEvents.containerId,
      latitude: custodyEvents.latitude,
      longitude: custodyEvents.longitude,
      notes: custodyEvents.notes,
      details: custodyEvents.details,
      createdAt: custodyEvents.createdAt,
    })
    .from(custodyEvents)
    .leftJoin(actorU, eq(actorU.id, custodyEvents.actorUserId))
    .leftJoin(fromU, eq(fromU.id, custodyEvents.fromCustodianUserId))
    .leftJoin(toU, eq(toU.id, custodyEvents.toCustodianUserId))
    .leftJoin(evFac, eq(evFac.id, custodyEvents.facilityId))
    .leftJoin(fromF, eq(fromF.id, custodyEvents.fromCustodianFacilityId))
    .leftJoin(toF, eq(toF.id, custodyEvents.toCustodianFacilityId))
    .where(eq(custodyEvents.batchId, batch.id))
    .orderBy(asc(custodyEvents.createdAt), asc(custodyEvents.id));
  const receipts = await db
    .select({ r: receiptRecords, receivedBy: users.fullName })
    .from(receiptRecords)
    .innerJoin(users, eq(users.id, receiptRecords.receivedById))
    .where(eq(receiptRecords.batchId, batch.id))
    .orderBy(asc(receiptRecords.receivedAt));
  const [disposal] = await db
    .select({ d: disposalRecords, performedBy: users.fullName, facilityName: facilities.name })
    .from(disposalRecords)
    .innerJoin(users, eq(users.id, disposalRecords.performedById))
    .innerJoin(facilities, eq(facilities.id, disposalRecords.facilityId))
    .where(eq(disposalRecords.batchId, batch.id));
  const batchIncidents = await db.select().from(incidents).where(eq(incidents.batchId, batch.id)).orderBy(desc(incidents.createdAt));
  const history = await db
    .select({ id: assignments.id, reference: assignments.reference, status: assignments.status, transporterName: users.fullName, addedAt: assignmentBatches.addedAt, removedAt: assignmentBatches.removedAt })
    .from(assignmentBatches)
    .innerJoin(assignments, eq(assignments.id, assignmentBatches.assignmentId))
    .innerJoin(users, eq(users.id, assignments.transporterUserId))
    .where(eq(assignmentBatches.batchId, batch.id))
    .orderBy(asc(assignmentBatches.addedAt));
  let currentAssignment = null;
  if (assignment) {
    const [t] = await db.select({ fullName: users.fullName, phone: users.phone }).from(users).where(eq(users.id, assignment.transporterUserId));
    currentAssignment = { ...assignment, transporterName: t?.fullName ?? null, transporterPhone: t?.phone ?? null };
  }
  return {
    ...batch,
    category,
    origin: facs.find((f) => f.id === batch.originFacilityId) ?? null,
    destination: facs.find((f) => f.id === batch.destinationFacilityId) ?? null,
    responsible,
    containers: ctrs.map((c) => ({ ...c, identifiers: tags.filter((t) => t.containerId === c.id).map((t) => ({ id: t.id, method: t.method, value: t.method === "qr" ? undefined : t.value, createdAt: t.createdAt })) })),
    events,
    receipts: receipts.map((r) => ({ ...r.r, receivedBy: r.receivedBy })),
    disposal: disposal ? { ...disposal.d, performedBy: disposal.performedBy, facilityName: disposal.facilityName } : null,
    incidents: batchIncidents,
    currentAssignment,
    assignmentHistory: history,
    availableActions: availableActions({ batch, actor: a, assignment }),
  };
});

route(router, base, {
  method: "patch",
  path: "/batches/:batchId",
  summary: "Edit a batch (only while status is generated)",
  tag: "Batches",
  access: "member",
  roles: ["admin", "facility_staff"],
  body: batchCreate.omit({ originFacilityId: true, containerCount: true }),
}, async (ctx) => {
  const a = actorOf(ctx);
  const b = ctx.body;
  const updated = await db.transaction(async (tx) => {
    const [batch] = await tx.select().from(wasteBatches).where(and(eq(wasteBatches.id, ctx.params.batchId), eq(wasteBatches.organizationId, a.orgId))).for("update");
    if (!batch || !canView(a, batch, null)) throw notFound("Batch");
    if (a.role === "facility_staff" && !a.facilityIds.includes(batch.originFacilityId)) throw forbidden("Only origin-facility staff can edit this batch.");
    if (batch.status !== "generated") throw invalidTransition("A batch can only be edited before segregation is verified. Report an incident to correct later records.");
    if (batch.currentAssignmentId) throw invalidTransition("Remove the batch from its assignment before editing.");
    await validateRefs(a, { originFacilityId: batch.originFacilityId, categoryId: b.categoryId, destinationFacilityId: b.destinationFacilityId });
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of ["categoryId", "quantity", "unit", "containerType", "sourceArea", "destinationFacilityId", "segregationNotes", "handlingNotes"] as const) {
      const before = batch[k] ?? null;
      const after = (b as Record<string, unknown>)[k] ?? null;
      if (before !== after) changes[k] = { from: before, to: after };
    }
    const [u] = await tx
      .update(wasteBatches)
      .set({ ...b, destinationFacilityId: b.destinationFacilityId ?? null, updatedAt: new Date(), version: sql`${wasteBatches.version} + 1` })
      .where(eq(wasteBatches.id, batch.id))
      .returning();
    if (Object.keys(changes).length) {
      await tx.insert(custodyEvents).values({ organizationId: a.orgId, batchId: batch.id, eventType: "updated", fromStatus: batch.status, toStatus: batch.status, actorUserId: a.userId, actorRole: a.role, details: changes });
      await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "batch.update", entityType: "batch", entityId: batch.id, metadata: changes, ip: a.ip }, tx);
    }
    return u;
  });
  return updated;
});

route(router, base, {
  method: "post",
  path: "/batches/:batchId/actions/:action",
  summary: `Perform a lifecycle action (${actionNames.join(", ")}). Send an Idempotency-Key header to make retries safe.`,
  tag: "Lifecycle",
  access: "member",
}, async (ctx) => {
  const a = actorOf(ctx);
  const action = ctx.params.action;
  if (!(actionNames as readonly string[]).includes(action)) throw badRequest(`Unknown action. Use one of: ${actionNames.join(", ")}.`);
  const key = ctx.req.get("idempotency-key");
  if (key && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw badRequest("Invalid Idempotency-Key header.");
  const r = await performAction(a, ctx.params.batchId, action as (typeof actionNames)[number], ctx.req.body, key);
  return { ...r.batch, replayed: r.replayed };
});

route(router, base, { method: "get", path: "/batches/:batchId/labels", summary: "Printable QR labels (SVG) for every container in the batch", tag: "Identification", access: "member" }, async (ctx) => {
  const a = actorOf(ctx);
  const { batch } = await loadVisibleBatch(a, ctx.params.batchId);
  if (a.role === "transporter") throw forbidden("Labels are printed by facility staff.");
  const [category] = await db.select().from(wasteCategories).where(eq(wasteCategories.id, batch.categoryId));
  const [o] = await db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, batch.originFacilityId));
  const rows = await db
    .select({ id: containers.id, label: containers.label, sequence: containers.sequence, token: containerIdentifiers.value })
    .from(containers)
    .innerJoin(containerIdentifiers, and(eq(containerIdentifiers.containerId, containers.id), eq(containerIdentifiers.method, "qr"), eq(containerIdentifiers.active, true)))
    .where(eq(containers.batchId, batch.id))
    .orderBy(asc(containers.sequence));
  const labels = await Promise.all(
    rows.map(async (r) => ({
      containerId: r.id,
      label: r.label,
      sequence: r.sequence,
      payload: qrPayload(r.token),
      svg: await QRCode.toString(qrPayload(r.token), { type: "svg", errorCorrectionLevel: "M", margin: 1 }),
    })),
  );
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "batch.labels_viewed", entityType: "batch", entityId: batch.id, ip: a.ip });
  return {
    trackingCode: batch.trackingCode,
    category: { name: category.name, code: category.code, colorHex: category.colorHex, handlingInstructions: category.handlingInstructions },
    originName: o.name,
    quantity: batch.quantity,
    unit: batch.unit,
    createdAt: batch.createdAt,
    containerCount: batch.containerCount,
    labels,
  };
});

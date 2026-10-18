import { Router } from "express";
import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { alerts, alertStatusEnum, assignments, custodyEvents, incidents, incidentTypeEnum, notifications, severityEnum, users, wasteBatches } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { subscribe, type BusEvent } from "../lib/events.js";
import { actorOf, route, zId, zOptionalText, zPage, type Actor } from "../lib/http.js";
import { raiseAlert } from "../services/alerts.js";
import { loadVisibleBatch } from "./batches.js";

export const router = Router();
const base = "/api";

// ------------------------------------------------------------------ incidents
route(router, base, {
  method: "post",
  path: "/incidents",
  summary: "Report an incident or exception (spill, leak, delay, …)",
  tag: "Incidents",
  access: "member",
  body: z.object({
    type: z.enum(incidentTypeEnum.enumValues),
    severity: z.enum(severityEnum.enumValues),
    description: z.string().trim().min(5, "Describe what happened").max(4000),
    batchId: zId.nullable().optional(),
    assignmentId: zId.nullable().optional(),
    facilityId: zId.nullable().optional(),
  }),
}, async (ctx) => {
  const a = actorOf(ctx);
  const b = ctx.body;
  let batch = null;
  if (b.batchId) batch = (await loadVisibleBatch(a, b.batchId)).batch;
  if (b.assignmentId) {
    const [asg] = await db.select().from(assignments).where(and(eq(assignments.id, b.assignmentId), eq(assignments.organizationId, a.orgId)));
    if (!asg || (a.role === "transporter" && asg.transporterUserId !== a.userId)) throw notFound("Assignment");
  }
  const facilityId = b.facilityId ?? batch?.currentCustodianFacilityId ?? batch?.originFacilityId ?? null;
  const inc = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(incidents)
      .values({ organizationId: a.orgId, type: b.type, severity: b.severity, description: b.description, batchId: batch?.id ?? null, assignmentId: b.assignmentId ?? batch?.currentAssignmentId ?? null, facilityId, reportedById: a.userId })
      .returning();
    if (batch) {
      await tx.insert(custodyEvents).values({ organizationId: a.orgId, batchId: batch.id, eventType: "incident", fromStatus: batch.status, toStatus: batch.status, actorUserId: a.userId, actorRole: a.role, assignmentId: row.assignmentId, facilityId, notes: b.description, details: { incidentId: row.id, type: b.type, severity: b.severity } });
    }
    await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "incident.report", entityType: "incident", entityId: row.id, metadata: { type: b.type, severity: b.severity }, ip: a.ip }, tx);
    return row;
  });
  await raiseAlert({
    organizationId: a.orgId,
    type: "incident",
    severity: b.severity,
    title: `Incident: ${b.type.replaceAll("_", " ")}${batch ? ` (${batch.trackingCode})` : ""}`,
    message: b.description.slice(0, 300),
    batchId: batch?.id ?? null,
    assignmentId: inc.assignmentId,
    facilityId,
    dedupeKey: `incident:${inc.id}`,
  });
  ctx.res.status(201);
  return inc;
});

function incidentVisibility(a: Actor) {
  if (a.role === "admin") return undefined;
  if (a.role === "transporter") return or(eq(incidents.reportedById, a.userId), sql`${incidents.assignmentId} in (select id from assignments where transporter_user_id = ${a.userId})`);
  if (!a.facilityIds.length) return eq(incidents.reportedById, a.userId);
  return or(eq(incidents.reportedById, a.userId), inArray(incidents.facilityId, a.facilityIds));
}

route(router, base, {
  method: "get",
  path: "/incidents",
  summary: "List incidents",
  tag: "Incidents",
  access: "member",
  query: zPage.extend({ status: z.enum(["open", "resolved"]).optional(), batchId: zId.optional() }),
}, async (ctx) => {
  const a = actorOf(ctx);
  const where = and(eq(incidents.organizationId, a.orgId), incidentVisibility(a), ctx.query.status ? eq(incidents.status, ctx.query.status) : undefined, ctx.query.batchId ? eq(incidents.batchId, ctx.query.batchId) : undefined);
  const items = await db
    .select({ incident: incidents, reportedBy: users.fullName, trackingCode: wasteBatches.trackingCode })
    .from(incidents)
    .leftJoin(users, eq(users.id, incidents.reportedById))
    .leftJoin(wasteBatches, eq(wasteBatches.id, incidents.batchId))
    .where(where)
    .orderBy(desc(incidents.createdAt))
    .limit(ctx.query.pageSize)
    .offset((ctx.query.page - 1) * ctx.query.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(incidents).where(where);
  return { items: items.map((i) => ({ ...i.incident, reportedBy: i.reportedBy, trackingCode: i.trackingCode })), total, page: ctx.query.page, pageSize: ctx.query.pageSize };
});

route(router, base, {
  method: "post",
  path: "/incidents/:incidentId/resolve",
  summary: "Resolve an incident with notes",
  tag: "Incidents",
  access: "member",
  roles: ["admin", "facility_staff"],
  body: z.object({ resolutionNotes: z.string().trim().min(3, "Describe the resolution").max(4000) }),
}, async (ctx) => {
  const a = actorOf(ctx);
  const [inc] = await db.select().from(incidents).where(and(eq(incidents.id, ctx.params.incidentId), eq(incidents.organizationId, a.orgId), incidentVisibility(a)));
  if (!inc) throw notFound("Incident");
  if (inc.status === "resolved") throw badRequest("This incident is already resolved.");
  const [u] = await db.update(incidents).set({ status: "resolved", resolvedAt: new Date(), resolvedById: a.userId, resolutionNotes: ctx.body.resolutionNotes }).where(eq(incidents.id, inc.id)).returning();
  await db.update(alerts).set({ status: "resolved", resolvedAt: new Date(), resolvedById: a.userId }).where(and(eq(alerts.organizationId, a.orgId), eq(alerts.dedupeKey, `incident:${inc.id}`), eq(alerts.status, "open")));
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "incident.resolve", entityType: "incident", entityId: inc.id, ip: a.ip });
  return u;
});

// ------------------------------------------------------------------ alerts
function alertVisibility(a: Actor) {
  if (a.role === "admin") return undefined;
  const typeOk = sql`${alerts.type} <> 'invalid_transition'`;
  if (a.role === "transporter") return and(typeOk, sql`${alerts.assignmentId} in (select id from assignments where transporter_user_id = ${a.userId})`);
  if (!a.facilityIds.length) return sql`false`;
  return and(typeOk, inArray(alerts.facilityId, a.facilityIds));
}

route(router, base, {
  method: "get",
  path: "/alerts",
  summary: "List alerts (open by default)",
  tag: "Alerts",
  access: "member",
  query: zPage.extend({ status: z.enum(alertStatusEnum.enumValues).default("open") }),
}, async (ctx) => {
  const a = actorOf(ctx);
  const where = and(eq(alerts.organizationId, a.orgId), eq(alerts.status, ctx.query.status), alertVisibility(a));
  const items = await db
    .select({ alert: alerts, trackingCode: wasteBatches.trackingCode, reference: assignments.reference })
    .from(alerts)
    .leftJoin(wasteBatches, eq(wasteBatches.id, alerts.batchId))
    .leftJoin(assignments, eq(assignments.id, alerts.assignmentId))
    .where(where)
    .orderBy(sql`case ${alerts.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`, desc(alerts.createdAt))
    .limit(ctx.query.pageSize)
    .offset((ctx.query.page - 1) * ctx.query.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(alerts).where(where);
  return { items: items.map((i) => ({ ...i.alert, trackingCode: i.trackingCode, reference: i.reference })), total, page: ctx.query.page, pageSize: ctx.query.pageSize };
});

route(router, base, { method: "post", path: "/alerts/:alertId/resolve", summary: "Acknowledge / resolve an alert", tag: "Alerts", access: "member", roles: ["admin", "facility_staff"] }, async (ctx) => {
  const a = actorOf(ctx);
  const [u] = await db
    .update(alerts)
    .set({ status: "resolved", resolvedAt: new Date(), resolvedById: a.userId })
    .where(and(eq(alerts.id, ctx.params.alertId), eq(alerts.organizationId, a.orgId), eq(alerts.status, "open"), alertVisibility(a)))
    .returning();
  if (!u) throw notFound("Open alert");
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "alert.resolve", entityType: "alert", entityId: u.id, ip: a.ip });
  return u;
});

// ------------------------------------------------------------------ notifications
route(router, base, {
  method: "get",
  path: "/notifications",
  summary: "Your in-app notifications",
  tag: "Notifications",
  access: "member",
  query: zPage.extend({ unread: z.enum(["true"]).optional() }),
}, async (ctx) => {
  const a = actorOf(ctx);
  const where = and(eq(notifications.userId, a.userId), eq(notifications.organizationId, a.orgId), ctx.query.unread ? isNull(notifications.readAt) : undefined);
  const items = await db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(ctx.query.pageSize).offset((ctx.query.page - 1) * ctx.query.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(notifications).where(where);
  const [{ unread }] = await db.select({ unread: count() }).from(notifications).where(and(eq(notifications.userId, a.userId), eq(notifications.organizationId, a.orgId), isNull(notifications.readAt)));
  return { items, total, unread, page: ctx.query.page, pageSize: ctx.query.pageSize };
});

route(router, base, { method: "post", path: "/notifications/read", summary: "Mark notifications read (all if ids omitted)", tag: "Notifications", access: "member", body: z.object({ ids: z.array(zId).max(200).optional() }) }, async (ctx) => {
  const a = actorOf(ctx);
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, a.userId), eq(notifications.organizationId, a.orgId), isNull(notifications.readAt), ctx.body.ids?.length ? inArray(notifications.id, ctx.body.ids) : undefined));
  return { ok: true };
});

// ------------------------------------------------------------------ live event stream (SSE)
router.get("/events/stream", (req, res) => {
  const auth = req.auth;
  if (!auth?.membership) {
    res.status(401).json({ error: { code: "unauthorized", message: "Please sign in to continue." } });
    return;
  }
  const a: Actor = { userId: auth.user.id, orgId: auth.membership.organizationId, role: auth.membership.role, facilityIds: auth.membership.facilityIds, membershipId: auth.membership.id };
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write(`retry: 5000\n\n`);
  const send = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const unsubscribe = subscribe((e: BusEvent) => {
    if (e.organizationId !== a.orgId) return;
    if (e.type === "notification") {
      if (e.userId === a.userId) send("notification", e.payload);
      return;
    }
    if (e.type === "location") {
      const p = e.payload as { transporterUserId: string; originFacilityId: string; destinationFacilityId: string };
      const visible = a.role === "admin" || p.transporterUserId === a.userId || (a.role === "facility_staff" && (a.facilityIds.includes(p.originFacilityId) || a.facilityIds.includes(p.destinationFacilityId)));
      if (visible) send("location", e.payload);
      return;
    }
    // Batch / assignment / alert changes are sent as content-free "refresh" hints.
    send("invalidate", { kind: e.type });
  });
  const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
  req.on("close", () => {
    clearInterval(ping);
    unsubscribe();
  });
});

export { zOptionalText };

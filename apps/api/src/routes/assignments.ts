import { Router } from "express";
import { and, asc, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db/client.js";
import { assignmentBatches, assignments, assignmentStatusEnum, facilities, locationPoints, users, wasteBatches, wasteCategories } from "../db/schema.js";
import { env } from "../env.js";
import { audit } from "../lib/audit.js";
import { badRequest, forbidden, invalidTransition, notFound } from "../lib/errors.js";
import { publish } from "../lib/events.js";
import { logger } from "../lib/logger.js";
import { actorOf, route, zId, zOptionalText, zPage, type Actor } from "../lib/http.js";
import { assignmentAction, createAssignment, setTracking, updateAssignment } from "../services/assignments.js";
import { readSettings } from "../services/settings.js";
import { organizations } from "../db/schema.js";

export const router = Router();
const base = "/api";
const origin = alias(facilities, "origin");
const dest = alias(facilities, "dest");

/** SQL visibility for assignments, mirroring batch visibility. */
function asgVisibility(a: Actor) {
  if (a.role === "admin") return undefined;
  if (a.role === "transporter") return eq(assignments.transporterUserId, a.userId);
  if (!a.facilityIds.length) return sql`false`;
  return or(inArray(assignments.originFacilityId, a.facilityIds), inArray(assignments.destinationFacilityId, a.facilityIds));
}

async function loadVisibleAssignment(a: Actor, id: string) {
  const [row] = await db.select().from(assignments).where(and(eq(assignments.id, id), eq(assignments.organizationId, a.orgId), asgVisibility(a)));
  if (!row) throw notFound("Assignment");
  return row;
}

const listCols = {
  id: assignments.id,
  reference: assignments.reference,
  status: assignments.status,
  transporterUserId: assignments.transporterUserId,
  transporterName: users.fullName,
  originFacilityId: assignments.originFacilityId,
  destinationFacilityId: assignments.destinationFacilityId,
  originName: origin.name,
  destinationName: dest.name,
  vehicleReg: assignments.vehicleReg,
  scheduledPickupAt: assignments.scheduledPickupAt,
  dueBy: assignments.dueBy,
  trackingActive: assignments.trackingActive,
  lastLocationAt: assignments.lastLocationAt,
  createdAt: assignments.createdAt,
  completedAt: assignments.completedAt,
  batchCount: sql<number>`(select count(*)::int from ${assignmentBatches} ab where ab.assignment_id = ${assignments.id} and ab.removed_at is null)`,
};

route(router, base, {
  method: "get",
  path: "/assignments",
  summary: "List transport assignments (transporters see only their own)",
  tag: "Assignments",
  access: "member",
  query: zPage.extend({ status: z.string().max(100).optional(), transporterUserId: zId.optional() }),
}, async (ctx) => {
  const a = actorOf(ctx);
  const statuses = ctx.query.status?.split(",").filter((s): s is (typeof assignmentStatusEnum.enumValues)[number] => (assignmentStatusEnum.enumValues as readonly string[]).includes(s));
  const where = and(
    eq(assignments.organizationId, a.orgId),
    asgVisibility(a),
    statuses?.length ? inArray(assignments.status, statuses) : undefined,
    ctx.query.transporterUserId ? eq(assignments.transporterUserId, ctx.query.transporterUserId) : undefined,
  );
  const items = await db
    .select(listCols)
    .from(assignments)
    .innerJoin(users, eq(users.id, assignments.transporterUserId))
    .innerJoin(origin, eq(origin.id, assignments.originFacilityId))
    .innerJoin(dest, eq(dest.id, assignments.destinationFacilityId))
    .where(where)
    .orderBy(desc(assignments.createdAt))
    .limit(ctx.query.pageSize)
    .offset((ctx.query.page - 1) * ctx.query.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(assignments).where(where);
  return { items, total, page: ctx.query.page, pageSize: ctx.query.pageSize };
});

route(router, base, {
  method: "post",
  path: "/assignments",
  summary: "Create a transport assignment for one or more segregated batches",
  tag: "Assignments",
  access: "member",
  roles: ["admin"],
  body: z.object({
    transporterUserId: zId,
    originFacilityId: zId,
    destinationFacilityId: zId,
    batchIds: z.array(zId).min(1, "Select at least one batch").max(100),
    scheduledPickupAt: z.coerce.date(),
    dueBy: z.coerce.date(),
    vehicleReg: zOptionalText(30),
    notes: zOptionalText(2000),
  }),
}, async (ctx) => {
  const a = actorOf(ctx);
  const asg = await createAssignment(a, ctx.body);
  ctx.res.status(201);
  return asg;
});

route(router, base, { method: "get", path: "/assignments/:assignmentId", summary: "Assignment detail with batches, facilities and latest position", tag: "Assignments", access: "member" }, async (ctx) => {
  const a = actorOf(ctx);
  const asg = await loadVisibleAssignment(a, ctx.params.assignmentId);
  const [transporter] = await db.select({ id: users.id, fullName: users.fullName, phone: users.phone }).from(users).where(eq(users.id, asg.transporterUserId));
  const facs = await db.select().from(facilities).where(inArray(facilities.id, [asg.originFacilityId, asg.destinationFacilityId]));
  const batches = await db
    .select({
      id: wasteBatches.id,
      trackingCode: wasteBatches.trackingCode,
      status: wasteBatches.status,
      quantity: wasteBatches.quantity,
      unit: wasteBatches.unit,
      containerCount: wasteBatches.containerCount,
      category: { name: wasteCategories.name, colorHex: wasteCategories.colorHex, code: wasteCategories.code },
      removedAt: assignmentBatches.removedAt,
    })
    .from(assignmentBatches)
    .innerJoin(wasteBatches, eq(wasteBatches.id, assignmentBatches.batchId))
    .innerJoin(wasteCategories, eq(wasteCategories.id, wasteBatches.categoryId))
    .where(eq(assignmentBatches.assignmentId, asg.id))
    .orderBy(asc(wasteBatches.trackingCode));
  const [latest] = await db.select().from(locationPoints).where(eq(locationPoints.assignmentId, asg.id)).orderBy(desc(locationPoints.recordedAt)).limit(1);
  const [{ points }] = await db.select({ points: count() }).from(locationPoints).where(eq(locationPoints.assignmentId, asg.id));
  return {
    ...asg,
    transporter: a.role === "admin" || a.userId === asg.transporterUserId ? transporter : { id: transporter.id, fullName: transporter.fullName, phone: null },
    origin: facs.find((f) => f.id === asg.originFacilityId),
    destination: facs.find((f) => f.id === asg.destinationFacilityId),
    batches: batches.filter((b) => !b.removedAt),
    removedBatches: batches.filter((b) => b.removedAt),
    latestLocation: latest ?? null,
    locationPointCount: points,
    isMine: asg.transporterUserId === a.userId,
  };
});

route(router, base, {
  method: "patch",
  path: "/assignments/:assignmentId",
  summary: "Edit before the trip starts: reassign transporter, add/remove batches, change due time",
  tag: "Assignments",
  access: "member",
  roles: ["admin"],
  body: z.object({
    transporterUserId: zId.optional(),
    addBatchIds: z.array(zId).max(100).optional(),
    removeBatchIds: z.array(zId).max(100).optional(),
    dueBy: z.coerce.date().optional(),
    vehicleReg: zOptionalText(30),
    notes: zOptionalText(2000),
  }),
}, async (ctx) => updateAssignment(actorOf(ctx), ctx.params.assignmentId, ctx.body));

// ------------------------------------------------------------------ GPS tracking
route(router, base, {
  method: "put",
  path: "/assignments/:assignmentId/tracking",
  summary: "Transporter switches location sharing on/off for their job",
  tag: "Tracking",
  access: "member",
  roles: ["transporter"],
  body: z.object({ active: z.boolean() }),
}, async (ctx) => setTracking(actorOf(ctx), ctx.params.assignmentId, ctx.body.active));

const pointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  speed: z.number().min(0).max(100).nullable().optional(), // m/s; > 360 km/h is not a road vehicle
  recordedAt: z.coerce.date(),
});

route(router, base, {
  method: "post",
  path: "/assignments/:assignmentId/locations",
  summary: "Upload device GPS fixes (batched, up to 50; duplicates ignored)",
  tag: "Tracking",
  access: "member",
  roles: ["transporter"],
  body: z.object({ points: z.array(pointSchema).min(1).max(50) }),
}, async (ctx) => {
  const a = actorOf(ctx);
  const asg = await loadVisibleAssignment(a, ctx.params.assignmentId);
  if (asg.transporterUserId !== a.userId) throw forbidden();
  if (!asg.trackingActive) throw invalidTransition("Location sharing is off for this job. Switch it on to send positions.");
  if (asg.status !== "accepted" && asg.status !== "in_progress") throw invalidTransition("This job is not active.");
  const now = Date.now();
  const earliest = (asg.trackingStartedAt?.getTime() ?? now) - 2 * 60_000; // allow small clock skew / buffered fixes
  const valid = ctx.body.points.filter((p) => p.recordedAt.getTime() <= now + 2 * 60_000 && p.recordedAt.getTime() >= earliest);
  if (!valid.length) throw badRequest("Location timestamps are outside the tracking window. Check the device clock.");
  const rows = await db
    .insert(locationPoints)
    .values(valid.map((p) => ({
      organizationId: a.orgId,
      assignmentId: asg.id,
      transporterUserId: a.userId,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracyM: p.accuracy ?? null,
      headingDeg: p.heading ?? null,
      speedMps: p.speed ?? null,
      recordedAt: p.recordedAt,
      source: "device" as const,
    })))
    .onConflictDoNothing()
    .returning();
  const latestTime = new Date(Math.max(...valid.map((p) => p.recordedAt.getTime())));
  await db.update(assignments).set({ lastLocationAt: sql`greatest(${assignments.lastLocationAt}, ${latestTime})` }).where(eq(assignments.id, asg.id));
  const latest = rows.sort((x, y) => y.recordedAt.getTime() - x.recordedAt.getTime())[0];
  if (latest) publishLocation(asg, latest);
  return { accepted: rows.length, ignored: ctx.body.points.length - rows.length };
});

function publishLocation(asg: typeof assignments.$inferSelect, p: typeof locationPoints.$inferSelect) {
  publish({
    type: "location",
    organizationId: asg.organizationId,
    payload: {
      assignmentId: asg.id,
      transporterUserId: asg.transporterUserId,
      originFacilityId: asg.originFacilityId,
      destinationFacilityId: asg.destinationFacilityId,
      point: { latitude: p.latitude, longitude: p.longitude, accuracyM: p.accuracyM, headingDeg: p.headingDeg, speedMps: p.speedMps, recordedAt: p.recordedAt, source: p.source },
    },
  });
}

route(router, base, {
  method: "get",
  path: "/assignments/:assignmentId/locations",
  summary: "Recorded position history for an assignment",
  tag: "Tracking",
  access: "member",
  query: z.object({ limit: z.coerce.number().int().min(1).max(5000).default(1000) }),
}, async (ctx) => {
  const a = actorOf(ctx);
  const asg = await loadVisibleAssignment(a, ctx.params.assignmentId);
  const rows = await db
    .select({ id: locationPoints.id, latitude: locationPoints.latitude, longitude: locationPoints.longitude, accuracyM: locationPoints.accuracyM, headingDeg: locationPoints.headingDeg, speedMps: locationPoints.speedMps, recordedAt: locationPoints.recordedAt, receivedAt: locationPoints.receivedAt, source: locationPoints.source })
    .from(locationPoints)
    .where(eq(locationPoints.assignmentId, asg.id))
    .orderBy(desc(locationPoints.recordedAt))
    .limit(ctx.query.limit);
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "tracking.history_viewed", entityType: "assignment", entityId: asg.id, ip: a.ip });
  return rows.reverse();
});

route(router, base, { method: "get", path: "/tracking/live", summary: "Latest reported position for every active assignment you may see", tag: "Tracking", access: "member" }, async (ctx) => {
  const a = actorOf(ctx);
  const [org] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, a.orgId));
  const staleMinutes = readSettings(org.settings).staleGpsMinutes;
  const rows = await db
    .select(listCols)
    .from(assignments)
    .innerJoin(users, eq(users.id, assignments.transporterUserId))
    .innerJoin(origin, eq(origin.id, assignments.originFacilityId))
    .innerJoin(dest, eq(dest.id, assignments.destinationFacilityId))
    .where(and(eq(assignments.organizationId, a.orgId), asgVisibility(a), inArray(assignments.status, ["assigned", "accepted", "in_progress"])))
    .orderBy(desc(assignments.createdAt))
    .limit(200);
  const ids = rows.map((r) => r.id);
  const latest = ids.length
    ? await db.execute<{ assignment_id: string; latitude: number; longitude: number; accuracy_m: number | null; heading_deg: number | null; speed_mps: number | null; recorded_at: Date; source: string }>(sql`
        select distinct on (assignment_id) assignment_id, latitude, longitude, accuracy_m, heading_deg, speed_mps, recorded_at, source
        from ${locationPoints} where assignment_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
        order by assignment_id, recorded_at desc`)
    : { rows: [] };
  const facIds = [...new Set(rows.flatMap((r) => [r.originFacilityId, r.destinationFacilityId]))];
  const facs = facIds.length ? await db.select({ id: facilities.id, name: facilities.name, latitude: facilities.latitude, longitude: facilities.longitude, type: facilities.type }).from(facilities).where(inArray(facilities.id, facIds)) : [];
  return {
    staleAfterMinutes: staleMinutes,
    serverTime: new Date(),
    assignments: rows.map((r) => {
      const p = latest.rows.find((l) => l.assignment_id === r.id);
      return {
        ...r,
        latestPoint: p ? { latitude: p.latitude, longitude: p.longitude, accuracyM: p.accuracy_m, headingDeg: p.heading_deg, speedMps: p.speed_mps, recordedAt: p.recorded_at, source: p.source } : null,
      };
    }),
    facilities: facs,
  };
});

route(router, base, { method: "get", path: "/assignments/:assignmentId/route", summary: "Planned route from an OSRM-compatible routing service, if configured", tag: "Tracking", access: "member" }, async (ctx) => {
  const a = actorOf(ctx);
  const asg = await loadVisibleAssignment(a, ctx.params.assignmentId);
  if (!env.ROUTING_URL) return { available: false, reason: "No routing service configured (ROUTING_URL)." };
  const facs = await db.select().from(facilities).where(inArray(facilities.id, [asg.originFacilityId, asg.destinationFacilityId]));
  const o = facs.find((f) => f.id === asg.originFacilityId);
  const d = facs.find((f) => f.id === asg.destinationFacilityId);
  const [lp] = await db.select().from(locationPoints).where(eq(locationPoints.assignmentId, asg.id)).orderBy(desc(locationPoints.recordedAt)).limit(1);
  const start = lp && asg.status === "in_progress" ? { lat: lp.latitude, lng: lp.longitude } : o?.latitude != null ? { lat: o.latitude, lng: o.longitude! } : null;
  if (!start || d?.latitude == null) return { available: false, reason: "Facility coordinates are missing." };
  const url = `${env.ROUTING_URL.replace(/\/$/, "")}/route/v1/driving/${start.lng},${start.lat};${d.longitude},${d.latitude}?overview=full&geometries=geojson`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { available: false, reason: `Routing service returned ${r.status}.` };
    const data = (await r.json()) as { routes?: { geometry: { coordinates: [number, number][] }; duration: number; distance: number }[] };
    const best = data.routes?.[0];
    if (!best) return { available: false, reason: "No route found." };
    return { available: true, from: lp && asg.status === "in_progress" ? "current_position" : "origin", durationSeconds: best.duration, distanceMeters: best.distance, coordinates: best.geometry.coordinates.map(([lng, lat]) => [lat, lng]) };
  } catch (err) {
    logger.warn({ err }, "routing request failed");
    return { available: false, reason: "Routing service unreachable." };
  }
});

// ------------------------------------------------------------------ demo-mode GPS simulator
const simulations = new Map<string, NodeJS.Timeout>();

route(router, base, {
  method: "post",
  path: "/demo/assignments/:assignmentId/simulate",
  summary: "DEMO MODE ONLY: generate clearly-labelled simulated positions toward the destination",
  tag: "Tracking",
  access: "member",
  roles: ["admin"],
  body: z.object({ run: z.boolean() }),
}, async (ctx) => {
  if (!env.DEMO_MODE) throw forbidden("Demo mode is disabled on this server.");
  const a = actorOf(ctx);
  const asg = await loadVisibleAssignment(a, ctx.params.assignmentId);
  const existing = simulations.get(asg.id);
  if (!ctx.body.run) {
    if (existing) clearInterval(existing);
    simulations.delete(asg.id);
    return { running: false };
  }
  if (asg.status !== "in_progress" && asg.status !== "accepted") throw invalidTransition("Simulation needs an accepted or in-progress assignment.");
  const facs = await db.select().from(facilities).where(inArray(facilities.id, [asg.originFacilityId, asg.destinationFacilityId]));
  const o = facs.find((f) => f.id === asg.originFacilityId)!;
  const d = facs.find((f) => f.id === asg.destinationFacilityId)!;
  if (o.latitude == null || d.latitude == null) throw badRequest("Both facilities need map coordinates to simulate a trip.");
  if (existing) return { running: true };
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "tracking.simulation_started", entityType: "assignment", entityId: asg.id, ip: a.ip });
  const steps = 40;
  let i = 0;
  const timer = setInterval(async () => {
    try {
      i++;
      const t = Math.min(i / steps, 1);
      const wobble = Math.sin(t * Math.PI * 3) * 0.002 * (1 - t);
      const lat = o.latitude! + (d.latitude! - o.latitude!) * t + wobble;
      const lng = o.longitude! + (d.longitude! - o.longitude!) * t - wobble;
      const [p] = await db
        .insert(locationPoints)
        .values({ organizationId: asg.organizationId, assignmentId: asg.id, transporterUserId: asg.transporterUserId, latitude: lat, longitude: lng, accuracyM: 15, recordedAt: new Date(), source: "simulated" })
        .returning();
      await db.update(assignments).set({ lastLocationAt: p.recordedAt }).where(eq(assignments.id, asg.id));
      publishLocation(asg, p);
      if (t >= 1) {
        clearInterval(timer);
        simulations.delete(asg.id);
      }
    } catch (err) {
      logger.error({ err }, "simulation step failed");
      clearInterval(timer);
      simulations.delete(asg.id);
    }
  }, 3000);
  timer.unref();
  simulations.set(asg.id, timer);
  return { running: true, intervalSeconds: 3, steps };
});

// Registered last so the specific /locations, /tracking routes above win.
route(router, base, {
  method: "post",
  path: "/assignments/:assignmentId/:action",
  summary: "Assignment action: accept | decline | start | cancel",
  tag: "Assignments",
  access: "member",
  body: z.object({ reason: z.string().trim().max(1000).optional() }),
}, async (ctx) => {
  const action = ctx.params.action;
  if (!["accept", "decline", "start", "cancel"].includes(action)) throw notFound("Action");
  return assignmentAction(actorOf(ctx), ctx.params.assignmentId, action as "accept", ctx.body.reason);
});

export const stopSimulations = () => {
  simulations.forEach((t) => clearInterval(t));
  simulations.clear();
};
export { gt, isNull };

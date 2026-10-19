import { Router } from "express";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { notifications } from "../db/schema.js";
import { subscribe, type BusEvent } from "../lib/events.js";
import { actorOf, route, zId, zOptionalText, zPage, type Actor } from "../lib/http.js";

export const router = Router();
const base = "/api";

// Incident and alert endpoints were removed in this version (see services/alerts.ts › ALERTS_ENABLED).

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

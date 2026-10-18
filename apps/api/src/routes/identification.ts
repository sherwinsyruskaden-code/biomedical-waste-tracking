import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { containerIdentifiers, containers, identifierMethodEnum, scanMethodEnum, wasteBatches } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { actorOf, route, zId } from "../lib/http.js";
import { normalizeIdentifier, resolveIdentifier } from "../services/identification.js";
import { availableActions } from "../services/lifecycle.js";
import { loadVisibleBatch } from "./batches.js";

export const router = Router();
const base = "/api";

route(router, base, {
  method: "post",
  path: "/identify",
  summary: "Resolve a scanned QR / RFID / NFC identifier to its container and batch",
  tag: "Identification",
  access: "member",
  body: z.object({
    method: z.enum(identifierMethodEnum.enumValues),
    value: z.string().trim().min(1).max(500),
    /** Free-text reader name/id when scanned through a hardware reader. */
    readerId: z.string().trim().max(100).optional(),
    source: z.enum(["camera", "keyboard_wedge", "web_nfc", "manual_entry", "reader_gateway"]).optional(),
  }),
}, async (ctx) => {
  const a = actorOf(ctx);
  const b = ctx.body;
  const hit = await resolveIdentifier(a.orgId, b.method, b.value);
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: hit ? "scan.resolved" : "scan.unknown", entityType: hit ? "batch" : undefined, entityId: hit?.batchId, metadata: { method: b.method, source: b.source ?? null, readerId: b.readerId ?? null }, ip: a.ip });
  // Identical response for "not registered" and "belongs to another organization".
  if (!hit) throw notFound("Label (not registered in your organization)");
  const { batch, assignment } = await loadVisibleBatch(a, hit.batchId);
  return {
    container: { id: hit.containerId, label: hit.containerLabel },
    batch: { id: batch.id, trackingCode: batch.trackingCode, status: batch.status, quantity: batch.quantity, unit: batch.unit },
    availableActions: availableActions({ batch, actor: a, assignment }),
  };
});

route(router, base, {
  method: "post",
  path: "/containers/:containerId/identifiers",
  summary: "Register (or move) an RFID / NFC tag on a container",
  tag: "Identification",
  access: "member",
  roles: ["admin", "facility_staff"],
  body: z.object({
    method: z.enum(["rfid", "nfc"]),
    value: z.string().trim().min(1).max(200),
    /** If the tag is already active on another container in this org, move it here. */
    reassign: z.boolean().default(false),
  }),
}, async (ctx) => {
  const a = actorOf(ctx);
  const b = ctx.body;
  const value = normalizeIdentifier(b.method, b.value);
  const result = await db.transaction(async (tx) => {
    const [c] = await tx
      .select({ id: containers.id, batchId: containers.batchId, origin: wasteBatches.originFacilityId, status: wasteBatches.status })
      .from(containers)
      .innerJoin(wasteBatches, eq(wasteBatches.id, containers.batchId))
      .where(and(eq(containers.id, ctx.params.containerId), eq(containers.organizationId, a.orgId)));
    if (!c) throw notFound("Container");
    if (a.role === "facility_staff" && !a.facilityIds.includes(c.origin)) throw notFound("Container");
    if (c.status === "disposed" || c.status === "cancelled") throw badRequest("Tags cannot be registered on a closed batch.");
    const [existing] = await tx
      .select()
      .from(containerIdentifiers)
      .where(and(eq(containerIdentifiers.method, b.method), eq(containerIdentifiers.value, value), eq(containerIdentifiers.active, true)))
      .for("update");
    if (existing) {
      if (existing.organizationId !== a.orgId) throw conflict("This tag is already registered elsewhere and cannot be used.");
      if (existing.containerId === c.id) return existing;
      if (!b.reassign) throw conflict("This tag is already attached to another container. Confirm reassignment to move it.", { reassignable: true });
      await tx.update(containerIdentifiers).set({ active: false, deactivatedAt: new Date() }).where(eq(containerIdentifiers.id, existing.id));
    }
    // One active tag per method per container: retire the previous one.
    await tx
      .update(containerIdentifiers)
      .set({ active: false, deactivatedAt: new Date() })
      .where(and(eq(containerIdentifiers.containerId, c.id), eq(containerIdentifiers.method, b.method), eq(containerIdentifiers.active, true)));
    const [row] = await tx.insert(containerIdentifiers).values({ organizationId: a.orgId, containerId: c.id, method: b.method, value, registeredById: a.userId }).returning();
    await audit({ organizationId: a.orgId, actorUserId: a.userId, action: existing ? "tag.reassign" : "tag.register", entityType: "container", entityId: c.id, metadata: { method: b.method, value, from: existing?.containerId ?? null }, ip: a.ip }, tx);
    return row;
  });
  ctx.res.status(201);
  return { id: result.id, method: result.method, value: result.value, containerId: result.containerId };
});

route(router, base, { method: "delete", path: "/identifiers/:identifierId", summary: "Deactivate an RFID / NFC tag", tag: "Identification", access: "member", roles: ["admin", "facility_staff"] }, async (ctx) => {
  const a = actorOf(ctx);
  const [row] = await db
    .select({ id: containerIdentifiers.id, method: containerIdentifiers.method, containerId: containerIdentifiers.containerId, origin: wasteBatches.originFacilityId })
    .from(containerIdentifiers)
    .innerJoin(containers, eq(containers.id, containerIdentifiers.containerId))
    .innerJoin(wasteBatches, eq(wasteBatches.id, containers.batchId))
    .where(and(eq(containerIdentifiers.id, ctx.params.identifierId), eq(containerIdentifiers.organizationId, a.orgId), eq(containerIdentifiers.active, true)));
  if (!row) throw notFound("Identifier");
  if (row.method === "qr") throw badRequest("QR labels are permanent; reprint the label instead.");
  if (a.role === "facility_staff" && !a.facilityIds.includes(row.origin)) throw notFound("Identifier");
  await db.update(containerIdentifiers).set({ active: false, deactivatedAt: new Date() }).where(eq(containerIdentifiers.id, row.id));
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "tag.deactivate", entityType: "container", entityId: row.containerId, ip: a.ip });
});

export const scanMethods = scanMethodEnum.enumValues;
export { zId };

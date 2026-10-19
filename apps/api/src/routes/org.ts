import { Router } from "express";
import { and, asc, count, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  assignments,
  auditLogs,
  facilities,
  invitations,
  membershipFacilities,
  memberships,
  organizations,
  roleEnum,
  sessions,
  users,
  wasteCategories,
  disposalMethodEnum,
} from "../db/schema.js";
import { env } from "../env.js";
import { audit } from "../lib/audit.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { actorOf, route, zId, zOptionalText, zPage, type Actor } from "../lib/http.js";
import { mailConfigured, sendMail } from "../lib/mailer.js";
import { createSession } from "../lib/session.js";
import { assertFacilitiesInOrg, facilityInput } from "../services/orgs.js";
import { orgSettingsSchema, readSettings } from "../services/settings.js";
import { hashPassword, zEmail, zPassword } from "./auth.js";

export const router = Router();
const base = "/api";

// ------------------------------------------------------------------ organization
route(router, base, { method: "get", path: "/organization", summary: "Organization profile and settings", tag: "Organization", access: "member" }, async (ctx) => {
  const a = actorOf(ctx);
  const [o] = await db.select().from(organizations).where(eq(organizations.id, a.orgId));
  return { ...o, settings: readSettings(o.settings) };
});

route(router, base, {
  method: "patch",
  path: "/organization",
  summary: "Update organization profile",
  tag: "Organization",
  access: "member",
  roles: ["admin"],
  body: z.object({
    name: z.string().trim().min(2).max(160),
    registrationNumber: zOptionalText(80),
    contactEmail: zOptionalText(254),
    contactPhone: zOptionalText(30),
    address: zOptionalText(300),
    timezone: z.string().trim().min(1).max(64).refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown timezone"),
  }),
}, async (ctx) => {
  const a = actorOf(ctx);
  await db.update(organizations).set({ ...ctx.body, updatedAt: new Date() }).where(eq(organizations.id, a.orgId));
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "organization.update", entityType: "organization", entityId: a.orgId, ip: a.ip });
  return { ok: true };
});

route(router, base, { method: "put", path: "/organization/settings", summary: "Update operational thresholds and the default treatment plant", tag: "Organization", access: "member", roles: ["admin"], body: orgSettingsSchema }, async (ctx) => {
  const a = actorOf(ctx);
  if (ctx.body.defaultTreatmentFacilityId) {
    const [f] = await db.select().from(facilities).where(and(eq(facilities.id, ctx.body.defaultTreatmentFacilityId), eq(facilities.organizationId, a.orgId), eq(facilities.active, true)));
    if (!f?.canReceive) throw badRequest("Choose an active facility of yours that is authorised to receive waste.", { fields: { defaultTreatmentFacilityId: "Not a receiving facility" } });
  }
  // Keep the internal sample-data marker even if the client did not send it back.
  const [cur] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, a.orgId));
  const marker = ((cur?.settings ?? {}) as { sampleDataVersion?: number | null }).sampleDataVersion ?? ctx.body.sampleDataVersion ?? null;
  await db.update(organizations).set({ settings: { ...ctx.body, sampleDataVersion: marker }, updatedAt: new Date() }).where(eq(organizations.id, a.orgId));
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "organization.settings_update", metadata: ctx.body, ip: a.ip });
  return ctx.body;
});

// ------------------------------------------------------------------ facilities
/**
 * Facilities a member may see, and how:
 *  - "managed": admins see and manage every facility of their organization;
 *  - "own":     staff see the facilities they are assigned to;
 *  - "partner": the other end of a transfer they are part of (a hospital's treatment plant, a plant's
 *               sending hospitals, a transporter's pickup and drop-off) — contact and location only.
 */
async function visibleFacilities(a: Actor, includeInactive: boolean) {
  const all = await db
    .select()
    .from(facilities)
    .where(and(eq(facilities.organizationId, a.orgId), includeInactive && a.role === "admin" ? undefined : eq(facilities.active, true)))
    .orderBy(asc(facilities.name));
  if (a.role === "admin") return all.map((f) => ({ ...f, access: "managed" as const }));
  const own = new Set(a.role === "facility_staff" ? a.facilityIds : []);
  const scope =
    a.role === "transporter"
      ? eq(assignments.transporterUserId, a.userId)
      : own.size
        ? or(inArray(assignments.originFacilityId, [...own]), inArray(assignments.destinationFacilityId, [...own]))
        : sql`false`;
  const legs = await db.select({ o: assignments.originFacilityId, d: assignments.destinationFacilityId }).from(assignments).where(and(eq(assignments.organizationId, a.orgId), scope));
  const partners = new Set(legs.flatMap((l) => [l.o, l.d]).filter((id) => !own.has(id)));
  if (own.size) {
    // Staff at a generating facility also see where their waste will go when they request collection.
    const [org] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, a.orgId));
    const plantId = readSettings(org.settings).defaultTreatmentFacilityId;
    const generating = all.some((f) => own.has(f.id) && f.type !== "treatment");
    if (generating) for (const f of all) if ((plantId ? f.id === plantId : f.type === "treatment" && f.canReceive) && !own.has(f.id)) partners.add(f.id);
  }
  return all
    .filter((f) => own.has(f.id) || partners.has(f.id))
    .map((f) =>
      own.has(f.id)
        ? { ...f, access: "own" as const }
        : { id: f.id, name: f.name, type: f.type, canReceive: f.canReceive, address: f.address, city: f.city, contactName: f.contactName, contactPhone: f.contactPhone, latitude: f.latitude, longitude: f.longitude, active: f.active, access: "partner" as const },
    );
}

route(router, base, { method: "get", path: "/facilities", summary: "Facilities you may see: all (admin), your own, and transfer partners (contact and location only)", tag: "Facilities", access: "member", query: z.object({ includeInactive: z.enum(["true", "false"]).optional() }) }, async (ctx) => {
  return visibleFacilities(actorOf(ctx), ctx.query.includeInactive === "true");
});

route(router, base, { method: "post", path: "/facilities", summary: "Create facility", tag: "Facilities", access: "member", roles: ["admin"], body: facilityInput }, async (ctx) => {
  const a = actorOf(ctx);
  const [f] = await db
    .insert(facilities)
    .values({ ...ctx.body, latitude: ctx.body.latitude ?? null, longitude: ctx.body.longitude ?? null, organizationId: a.orgId })
    .returning()
    .catch((e) => {
      if (e.code === "23505") throw conflict("A facility with this name already exists.", { fields: { name: "Already used" } });
      throw e;
    });
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "facility.create", entityType: "facility", entityId: f.id, metadata: { name: f.name }, ip: a.ip });
  ctx.res.status(201);
  return f;
});

route(router, base, { method: "patch", path: "/facilities/:facilityId", summary: "Update facility (or deactivate)", tag: "Facilities", access: "member", roles: ["admin"], body: z.intersection(facilityInput, z.object({ active: z.boolean().default(true) })) }, async (ctx) => {
  const a = actorOf(ctx);
  const [f] = await db
    .update(facilities)
    .set({ ...ctx.body, latitude: ctx.body.latitude ?? null, longitude: ctx.body.longitude ?? null, updatedAt: new Date() })
    .where(and(eq(facilities.id, ctx.params.facilityId), eq(facilities.organizationId, a.orgId)))
    .returning()
    .catch((e) => {
      if (e.code === "23505") throw conflict("A facility with this name already exists.");
      throw e;
    });
  if (!f) throw notFound("Facility");
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "facility.update", entityType: "facility", entityId: f.id, ip: a.ip });
  return f;
});

// ------------------------------------------------------------------ categories
const categoryBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, "Use 2–20 letters, digits, - or _"),
  name: z.string().trim().min(2).max(120),
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a hex colour like #22C55E"),
  description: zOptionalText(1000),
  examples: zOptionalText(1000),
  handlingInstructions: zOptionalText(1000),
  allowedDisposalMethods: z.array(z.enum(disposalMethodEnum.enumValues)).max(20).default([]),
  active: z.boolean().default(true),
});

route(router, base, { method: "get", path: "/categories", summary: "List waste categories", tag: "Categories", access: "member" }, async (ctx) => {
  const a = actorOf(ctx);
  return db.select().from(wasteCategories).where(eq(wasteCategories.organizationId, a.orgId)).orderBy(asc(wasteCategories.code));
});

route(router, base, { method: "post", path: "/categories", summary: "Create waste category", tag: "Categories", access: "member", roles: ["admin"], body: categoryBody }, async (ctx) => {
  const a = actorOf(ctx);
  const [c] = await db.insert(wasteCategories).values({ ...ctx.body, organizationId: a.orgId }).returning().catch((e) => {
    if (e.code === "23505") throw conflict("A category with this code already exists.", { fields: { code: "Already used" } });
    throw e;
  });
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "category.create", entityType: "category", entityId: c.id, ip: a.ip });
  ctx.res.status(201);
  return c;
});

route(router, base, { method: "patch", path: "/categories/:categoryId", summary: "Update waste category", tag: "Categories", access: "member", roles: ["admin"], body: categoryBody }, async (ctx) => {
  const a = actorOf(ctx);
  const [c] = await db
    .update(wasteCategories)
    .set(ctx.body)
    .where(and(eq(wasteCategories.id, ctx.params.categoryId), eq(wasteCategories.organizationId, a.orgId)))
    .returning()
    .catch((e) => {
      if (e.code === "23505") throw conflict("A category with this code already exists.");
      throw e;
    });
  if (!c) throw notFound("Category");
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "category.update", entityType: "category", entityId: c.id, ip: a.ip });
  return c;
});

// ------------------------------------------------------------------ members
route(router, base, { method: "get", path: "/members", summary: "List organization members", tag: "Team", access: "member", query: z.object({ role: z.enum(roleEnum.enumValues).optional() }) }, async (ctx) => {
  const a = actorOf(ctx);
  const rows = await db
    .select({
      id: memberships.id,
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      phone: users.phone,
      role: memberships.role,
      status: memberships.status,
      vehicleReg: memberships.vehicleReg,
      lastLoginAt: users.lastLoginAt,
      createdAt: memberships.createdAt,
      facilityIds: sql<string[]>`coalesce((select array_agg(mf.facility_id) from ${membershipFacilities} mf where mf.membership_id = ${memberships.id}), '{}')`,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, a.orgId), ctx.query.role ? eq(memberships.role, ctx.query.role) : undefined))
    .orderBy(asc(users.fullName));
  if (a.role === "admin") return rows;
  // Staff see only colleagues at their own facilities; transporters see only themselves. No contact details.
  const mine = rows.filter((r) => r.userId === a.userId || (a.role === "facility_staff" && r.facilityIds.some((f) => a.facilityIds.includes(f))));
  return mine.map(({ email: _e, phone: _p, lastLoginAt: _l, ...r }) => r);
});

route(router, base, {
  method: "patch",
  path: "/members/:membershipId",
  summary: "Change a member's role, status, facilities or vehicle",
  tag: "Team",
  access: "member",
  roles: ["admin"],
  body: z.object({
    role: z.enum(roleEnum.enumValues),
    status: z.enum(["active", "disabled"]),
    facilityIds: z.array(zId).max(100).default([]),
    vehicleReg: zOptionalText(30),
  }),
}, async (ctx) => {
  const a = actorOf(ctx);
  const b = ctx.body;
  await db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, ctx.params.membershipId), eq(memberships.organizationId, a.orgId)))
      .for("update");
    if (!m) throw notFound("Member");
    const demotingAdmin = m.role === "admin" && (b.role !== "admin" || b.status !== "active");
    if (demotingAdmin) {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(memberships)
        .where(and(eq(memberships.organizationId, a.orgId), eq(memberships.role, "admin"), eq(memberships.status, "active"), ne(memberships.id, m.id)));
      if (n === 0) throw badRequest("An organization must keep at least one active admin.");
    }
    await assertFacilitiesInOrg(tx, a.orgId, b.facilityIds);
    await tx.update(memberships).set({ role: b.role, status: b.status, vehicleReg: b.vehicleReg, updatedAt: new Date() }).where(eq(memberships.id, m.id));
    await tx.delete(membershipFacilities).where(eq(membershipFacilities.membershipId, m.id));
    if (b.facilityIds.length) await tx.insert(membershipFacilities).values(b.facilityIds.map((facilityId) => ({ membershipId: m.id, facilityId })));
    if (b.status === "disabled") {
      // A disabled member loses access to this organization immediately.
      await tx.update(sessions).set({ activeOrganizationId: null }).where(and(eq(sessions.userId, m.userId), eq(sessions.activeOrganizationId, a.orgId)));
    }
    await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "member.update", entityType: "membership", entityId: m.id, metadata: { role: b.role, status: b.status, facilityIds: b.facilityIds }, ip: a.ip }, tx);
  });
  return { ok: true };
});

// ------------------------------------------------------------------ invitations
const INVITE_TTL_DAYS = 7;

route(router, base, { method: "get", path: "/invitations", summary: "List pending invitations", tag: "Team", access: "member", roles: ["admin"] }, async (ctx) => {
  const a = actorOf(ctx);
  return db
    .select({ id: invitations.id, email: invitations.email, fullName: invitations.fullName, role: invitations.role, facilityIds: invitations.facilityIds, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
    .from(invitations)
    .where(and(eq(invitations.organizationId, a.orgId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
    .orderBy(desc(invitations.createdAt));
});

route(router, base, {
  method: "post",
  path: "/invitations",
  summary: "Invite a staff member or transporter (returns a one-time link)",
  tag: "Team",
  access: "member",
  roles: ["admin"],
  body: z.object({
    email: zEmail,
    fullName: zOptionalText(120),
    role: z.enum(roleEnum.enumValues),
    facilityIds: z.array(zId).max(100).default([]),
  }),
}, async (ctx) => {
  const a = actorOf(ctx);
  const b = ctx.body;
  await assertFacilitiesInOrg(db, a.orgId, b.facilityIds);
  const [already] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, a.orgId), eq(users.email, b.email)));
  if (already) throw conflict("This person is already a member of your organization.", { fields: { email: "Already a member" } });
  const token = randomToken(32);
  const [inv] = await db
    .insert(invitations)
    .values({ organizationId: a.orgId, email: b.email, fullName: b.fullName, role: b.role, facilityIds: b.facilityIds, tokenHash: sha256(token), invitedById: a.userId, expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000) })
    .returning();
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, a.orgId));
  const link = `${env.APP_URL}/invite/${token}`;
  const mail = await sendMail(
    b.email,
    `You're invited to ${org.name} on BWTS`,
    `You have been invited to join ${org.name} on the Biomedical Waste Tracking System as ${b.role.replace("_", " ")}.\n\nAccept within ${INVITE_TTL_DAYS} days:\n${link}`,
  );
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "invitation.create", entityType: "invitation", entityId: inv.id, metadata: { email: b.email, role: b.role }, ip: a.ip });
  ctx.res.status(201);
  // The link is shown once to the admin so invitations work even without SMTP.
  return { id: inv.id, link, emailSent: mail.delivered, mailConfigured: mailConfigured(), expiresAt: inv.expiresAt };
});

route(router, base, { method: "delete", path: "/invitations/:invitationId", summary: "Revoke an invitation", tag: "Team", access: "member", roles: ["admin"] }, async (ctx) => {
  const a = actorOf(ctx);
  const [inv] = await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.id, ctx.params.invitationId), eq(invitations.organizationId, a.orgId), isNull(invitations.acceptedAt)))
    .returning({ id: invitations.id });
  if (!inv) throw notFound("Invitation");
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "invitation.revoke", entityType: "invitation", entityId: inv.id, ip: a.ip });
});

async function findInvite(token: string) {
  const [inv] = await db
    .select({ inv: invitations, orgName: organizations.name })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
    .where(and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())));
  return inv ?? null;
}

route(router, base, { method: "get", path: "/invitations/lookup/:token", summary: "Inspect an invitation token (public)", tag: "Team", access: "public" }, async (ctx) => {
  const found = await findInvite(ctx.params.token);
  if (!found) throw notFound("Invitation (it may have expired or been used)");
  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, found.inv.email));
  return { email: found.inv.email, fullName: found.inv.fullName, role: found.inv.role, organizationName: found.orgName, existingAccount: !!existingUser };
});

route(router, base, {
  method: "post",
  path: "/invitations/accept",
  summary: "Accept an invitation (creates the account if needed)",
  tag: "Team",
  access: "public",
  body: z.object({ token: z.string().min(20).max(100), fullName: z.string().trim().min(2).max(120).optional(), password: zPassword.optional(), acceptTerms: z.literal(true, { message: "You must accept the terms and privacy notice" }) }),
}, async (ctx) => {
  const b = ctx.body;
  const result = await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.tokenHash, sha256(b.token)), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
      .for("update");
    if (!inv) throw badRequest("This invitation is invalid, expired or already used.");
    let [user] = await tx.select({ id: users.id }).from(users).where(eq(users.email, inv.email));
    if (user) {
      // Existing account: must be signed in as that account.
      if (ctx.req.auth?.user.id !== user.id) throw forbidden("An account with this email exists. Sign in as that user, then open the invitation link again.");
    } else {
      if (!b.password || !b.fullName) throw badRequest("Full name and password are required to create your account.");
      [user] = await tx.insert(users).values({ email: inv.email, fullName: b.fullName, passwordHash: await hashPassword(b.password) }).returning({ id: users.id });
    }
    const [m] = await tx.insert(memberships).values({ organizationId: inv.organizationId, userId: user.id, role: inv.role }).returning();
    const facilityIds = (inv.facilityIds ?? []) as string[];
    if (facilityIds.length) {
      const valid = await tx.select({ id: facilities.id }).from(facilities).where(eq(facilities.organizationId, inv.organizationId));
      const ok = facilityIds.filter((id) => valid.some((v) => v.id === id));
      if (ok.length) await tx.insert(membershipFacilities).values(ok.map((facilityId) => ({ membershipId: m.id, facilityId })));
    }
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    await audit({ organizationId: inv.organizationId, actorUserId: user.id, action: "invitation.accept", entityType: "membership", entityId: m.id, ip: ctx.req.ip }, tx);
    // Reuse the session only if it already belongs to the invitee; otherwise sign in as the invitee.
    if (ctx.req.auth?.user.id === user.id) await tx.update(sessions).set({ activeOrganizationId: inv.organizationId }).where(eq(sessions.id, ctx.req.auth.sessionId));
    else await createSession(ctx.res, ctx.req, user.id, inv.organizationId, tx);
    return { organizationId: inv.organizationId };
  }).catch((e) => {
    if (e.code === "23505") throw conflict("You are already a member of this organization.");
    throw e;
  });
  return result;
});

// ------------------------------------------------------------------ audit log
route(router, base, {
  method: "get",
  path: "/audit-logs",
  summary: "Organization audit trail",
  tag: "Organization",
  access: "member",
  roles: ["admin"],
  query: zPage.extend({ action: z.string().max(60).optional() }),
}, async (ctx) => {
  const a = actorOf(ctx);
  const where = and(eq(auditLogs.organizationId, a.orgId), ctx.query.action ? sql`${auditLogs.action} like ${ctx.query.action + "%"}` : undefined);
  const rows = await db
    .select({ id: auditLogs.id, action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt, actorName: users.fullName })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(where)
    .orderBy(desc(auditLogs.id))
    .limit(ctx.query.pageSize)
    .offset((ctx.query.page - 1) * ctx.query.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(auditLogs).where(where);
  return { items: rows, total, page: ctx.query.page, pageSize: ctx.query.pageSize };
});

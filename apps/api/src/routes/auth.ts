import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { hash, verify } from "@node-rs/argon2";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { memberships, organizations, passwordResetTokens, sessions, users } from "../db/schema.js";
import { env } from "../env.js";
import { audit } from "../lib/audit.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { AppError, badRequest, conflict, notFound, unauthorized } from "../lib/errors.js";
import { route, zId, zOptionalText } from "../lib/http.js";
import { sendMail } from "../lib/mailer.js";
import { clearSessionCookie, createSession } from "../lib/session.js";
import { createOrganization, orgInput, registrationFacilityInput, registrationToFacility } from "../services/orgs.js";
import { DEMO_ORG_NAME, demoPeople, ensureSampleData } from "../services/demo.js";

export const router = Router();
const base = "/api/auth";

export const zEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254);

/** One rule for every place a password is set (sign-up, invitation, change, reset); the web app mirrors it. */
export const MIN_PASSWORD_LENGTH = 4;
export const zPassword = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(128, "Password is too long");

// Argon2id with library defaults (memory-hard). A dummy hash keeps timing similar for unknown emails.
export const hashPassword = (p: string) => hash(p);
let dummyHash: string | null = null;
async function verifyPassword(hashValue: string | null, password: string) {
  dummyHash ??= await hash("dummy-password-for-timing-1");
  const ok = await verify(hashValue ?? dummyHash, password).catch(() => false);
  return hashValue !== null && ok;
}

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "")}|${String(req.body?.email ?? "").toLowerCase().slice(0, 254)}`,
  handler: (_req, res) =>
    res.status(429).json({ error: { code: "rate_limited", message: "Too many attempts. Please wait 15 minutes and try again." } }),
});
const resetLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({ error: { code: "rate_limited", message: "Too many requests. Please try again later." } }),
});
router.use("/login", authLimiter);
router.use(
  "/demo-login",
  rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false, handler: (_req, res) => res.status(429).json({ error: { code: "rate_limited", message: "Too many quick sign-ins. Please wait a few minutes." } }) }),
);
router.use("/forgot-password", resetLimiter);
router.use("/reset-password", resetLimiter);

const signupBody = z
  .object({
    fullName: z.string().trim().min(2, "Full name is required").max(120),
    email: zEmail,
    password: zPassword,
    confirmPassword: z.string(),
    organization: orgInput,
    facility: registrationFacilityInput,
    acceptTerms: z.literal(true, { message: "You must accept the terms and privacy notice" }),
  })
  .refine((b) => b.password === b.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

route(router, base, { method: "post", path: "/signup", summary: "Register a user and create their organization", tag: "Auth", access: "public", body: signupBody }, async ({ body, req, res }) => {
  const passwordHash = await hashPassword(body.password);
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, body.email));
    if (existing) throw conflict("An account with this email already exists. Try signing in instead.", { fields: { email: "Already registered" } });
    const [user] = await tx.insert(users).values({ email: body.email, fullName: body.fullName, passwordHash }).returning({ id: users.id });
    const { org, facility } = await createOrganization(tx, {
      org: body.organization,
      facility: registrationToFacility(body.facility),
      adminUserId: user.id,
      contactEmail: body.email,
    });
    await audit({ organizationId: org.id, actorUserId: user.id, action: "auth.signup", entityType: "organization", entityId: org.id, ip: req.ip }, tx);
    if (facility) await audit({ organizationId: org.id, actorUserId: user.id, action: "facility.create", entityType: "facility", entityId: facility.id, metadata: { name: facility.name, kind: facility.kind, registrationId: facility.registrationId } }, tx);
    await createSession(res, req, user.id, org.id, tx);
    return { userId: user.id, organizationId: org.id, facilityId: facility?.id ?? null };
  }).catch((err) => {
    // Race on the unique email index
    if ((err as { code?: string }).code === "23505") throw conflict("An account with this email already exists.");
    throw err;
  });
  res.status(201);
  return result;
});

route(router, base, { method: "post", path: "/login", summary: "Sign in with email and password", tag: "Auth", access: "public", body: z.object({ email: zEmail, password: z.string().min(1).max(200) }) }, async ({ body, req, res }) => {
  const [user] = await db.select().from(users).where(eq(users.email, body.email));
  const ok = await verifyPassword(user?.passwordHash ?? null, body.password);
  if (!user || !ok) {
    await audit({ action: "auth.login_failed", metadata: { email: body.email }, ip: req.ip });
    throw new AppError(401, "invalid_credentials", "Invalid email or password.");
  }
  // Open an approved organization first; a pending one is shown its approval status instead.
  const [m] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(eq(memberships.userId, user.id), eq(memberships.status, "active")))
    .orderBy(desc(sql`${organizations.status} = 'approved'`), memberships.createdAt)
    .limit(1);
  await createSession(res, req, user.id, m?.organizationId ?? null);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await audit({ organizationId: m?.organizationId, actorUserId: user.id, action: "auth.login", ip: req.ip });
  return { ok: true };
});

route(router, base, { method: "post", path: "/logout", summary: "Sign out and invalidate the session", tag: "Auth", access: "user" }, async ({ auth, res, req }) => {
  await db.delete(sessions).where(eq(sessions.id, auth.sessionId));
  clearSessionCookie(res);
  await audit({ organizationId: auth.membership?.organizationId, actorUserId: auth.user.id, action: "auth.logout", ip: req.ip });
  return { ok: true };
});

route(router, base, { method: "get", path: "/me", summary: "Current user, memberships and active organization", tag: "Auth", access: "public" }, async ({ auth }) => {
  if (!auth) throw unauthorized();
  const [user] = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName, phone: users.phone, canReviewOrganizations: users.isPlatformAdmin, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, auth.user.id));
  const mems = await db
    .select({
      id: memberships.id,
      organizationId: memberships.organizationId,
      organizationName: organizations.name,
      organizationStatus: organizations.status,
      role: memberships.role,
      status: memberships.status,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(memberships.userId, auth.user.id));
  let organization = null;
  if (auth.membership) {
    const [o] = await db.select().from(organizations).where(eq(organizations.id, auth.membership.organizationId));
    organization = { id: o.id, name: o.name, type: o.type, timezone: o.timezone, status: o.status, submittedAt: o.submittedAt, reviewedAt: o.reviewedAt, reviewNote: o.reviewNote };
  }
  return {
    user,
    membership: auth.membership,
    organization,
    memberships: mems,
    features: { demoMode: env.DEMO_MODE, demoOrg: env.DEMO_MODE && organization?.name === DEMO_ORG_NAME },
  };
});

route(router, base, { method: "post", path: "/switch-organization", summary: "Change the active organization for this session", tag: "Auth", access: "user", body: z.object({ organizationId: zId }) }, async ({ auth, body }) => {
  const [m] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, auth.user.id), eq(memberships.organizationId, body.organizationId), eq(memberships.status, "active")));
  if (!m) throw badRequest("You are not an active member of that organization.");
  await db.update(sessions).set({ activeOrganizationId: body.organizationId }).where(eq(sessions.id, auth.sessionId));
  return { ok: true };
});

route(router, base, { method: "post", path: "/create-organization", summary: "Create an additional organization (caller becomes admin)", tag: "Auth", access: "user", body: z.object({ organization: orgInput, facility: registrationFacilityInput }) }, async ({ auth, body, req, res }) => {
  const result = await db.transaction(async (tx) => {
    const { org, facility } = await createOrganization(tx, { org: body.organization, facility: registrationToFacility(body.facility), adminUserId: auth.user.id, contactEmail: auth.user.email });
    await tx.update(sessions).set({ activeOrganizationId: org.id }).where(eq(sessions.id, auth.sessionId));
    await audit({ organizationId: org.id, actorUserId: auth.user.id, action: "organization.create", entityType: "organization", entityId: org.id, ip: req.ip }, tx);
    return { organizationId: org.id, facilityId: facility?.id ?? null };
  });
  res.status(201);
  return result;
});

route(router, base, { method: "patch", path: "/profile", summary: "Update own name / phone", tag: "Auth", access: "user", body: z.object({ fullName: z.string().trim().min(2).max(120), phone: zOptionalText(30) }) }, async ({ auth, body }) => {
  await db.update(users).set({ fullName: body.fullName, phone: body.phone, updatedAt: new Date() }).where(eq(users.id, auth.user.id));
  return { ok: true };
});

route(router, base, { method: "post", path: "/change-password", summary: "Change own password (signs out other sessions)", tag: "Auth", access: "user", body: z.object({ currentPassword: z.string().min(1), newPassword: zPassword }) }, async ({ auth, body, req }) => {
  const [u] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, auth.user.id));
  if (!(await verifyPassword(u.passwordHash, body.currentPassword))) throw badRequest("Current password is incorrect.", { fields: { currentPassword: "Incorrect" } });
  await db.update(users).set({ passwordHash: await hashPassword(body.newPassword), updatedAt: new Date() }).where(eq(users.id, auth.user.id));
  await db.delete(sessions).where(and(eq(sessions.userId, auth.user.id), ne(sessions.id, auth.sessionId)));
  await audit({ actorUserId: auth.user.id, organizationId: auth.membership?.organizationId, action: "auth.password_changed", ip: req.ip });
  return { ok: true };
});

route(router, base, { method: "post", path: "/forgot-password", summary: "Request a password-reset link (always returns ok)", tag: "Auth", access: "public", body: z.object({ email: zEmail }) }, async ({ body, req }) => {
  const [user] = await db.select({ id: users.id, fullName: users.fullName }).from(users).where(eq(users.email, body.email));
  if (user) {
    const token = randomToken(32);
    await db.insert(passwordResetTokens).values({ userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60_000) });
    const link = `${env.APP_URL}/reset-password?token=${token}`;
    await sendMail(
      body.email,
      "Reset your BWTS password",
      `Hello ${user.fullName},\n\nUse this link within 1 hour to set a new password:\n${link}\n\nIf you did not request this, you can ignore this email.`,
    );
    await audit({ actorUserId: user.id, action: "auth.password_reset_requested", ip: req.ip });
  }
  // Same response either way so the endpoint cannot be used to discover accounts.
  return { ok: true, message: "If an account exists for that email, a reset link has been sent." };
});

route(router, base, { method: "post", path: "/reset-password", summary: "Set a new password using a reset token", tag: "Auth", access: "public", body: z.object({ token: z.string().min(20).max(100), password: zPassword }) }, async ({ body, req }) => {
  const tokenHash = sha256(body.token);
  await db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())))
      .for("update");
    if (!t) throw badRequest("This reset link is invalid or has expired. Request a new one.");
    await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, t.id));
    await tx.update(users).set({ passwordHash: await hashPassword(body.password), updatedAt: new Date() }).where(eq(users.id, t.userId));
    await tx.delete(sessions).where(eq(sessions.userId, t.userId)); // sign out everywhere
    await audit({ actorUserId: t.userId, action: "auth.password_reset", ip: req.ip }, tx);
  });
  return { ok: true };
});

// ------------------------------------------------------------------ one-click demo sign-in (DEMO_MODE only)
const demoAccounts = [
  { key: "staff", label: "Hospital A", group: "hospital", facility: "Sunrise General Hospital", description: "Registers waste and requests collection. Sees only Hospital A's batches." },
  { key: "staffB", label: "Hospital B", group: "hospital", facility: "Sunrise Women & Children Hospital", description: "Same role at another hospital. Cannot see Hospital A's batches." },
  { key: "driver", label: "Transporter", group: "transporter", facility: "Vehicle TN 22 BW 101", description: "Accepts collection requests, scans at pickup and arrival." },
  { key: "plant", label: "Treatment Plant Staff", group: "plant", facility: "GreenCycle Treatment Plant", description: "Confirms receipt of arrivals and records treatment." },
  { key: "admin", label: "Main Admin", group: "admin", facility: "Sunrise Health Network", description: "Manages facilities, team and settings, and reviews organization approvals." },
] as const;
type DemoKey = (typeof demoAccounts)[number]["key"];

let seeding: Promise<unknown> | null = null;
/**
 * Creates the synthetic sample data on first use (concurrent requests share one run). Existing sample data is
 * only renamed / topped up in place — nothing is ever deleted here.
 */
async function ensureDemoOrg() {
  seeding ??= ensureSampleData().finally(() => (seeding = null));
  await seeding;
  const [created] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, DEMO_ORG_NAME));
  return created.id;
}

route(router, base, { method: "get", path: "/demo", summary: "Whether one-click demo sign-in is enabled, and its accounts", tag: "Auth", access: "public" }, async () => ({
  enabled: env.DEMO_MODE,
  accounts: env.DEMO_MODE ? demoAccounts : [],
}));

route(router, base, {
  method: "post",
  path: "/demo-login",
  summary: "Sample-data mode only: sign in as one of the sample accounts of the synthetic organization",
  tag: "Auth",
  access: "public",
  body: z.object({ account: z.enum(demoAccounts.map((a) => a.key) as [DemoKey, ...DemoKey[]]) }),
}, async ({ body, req, res }) => {
  if (!env.DEMO_MODE) throw notFound("Endpoint");
  const orgId = await ensureDemoOrg();
  const email = demoPeople.find((p) => p.key === body.account)!.email;
  const [row] = await db
    .select({ userId: users.id })
    .from(users)
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organizationId, orgId), eq(memberships.status, "active")))
    .where(eq(users.email, email));
  if (!row) throw new AppError(409, "demo_unavailable", "This sample account is missing or disabled. Recreate the sample data with `npm run db:seed:reset` (this wipes the sample organization).");
  await createSession(res, req, row.userId, orgId, db, { demo: true }); // replaces any existing session; short-lived
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.userId));
  await audit({ organizationId: orgId, actorUserId: row.userId, action: "auth.demo_login", ip: req.ip });
  return { ok: true, home: "/dashboard" };
});

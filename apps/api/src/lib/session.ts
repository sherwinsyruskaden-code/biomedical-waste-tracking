import type { NextFunction, Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, type Tx } from "../db/client.js";
import { membershipFacilities, memberships, organizations, sessions, users } from "../db/schema.js";
import { env } from "../env.js";
import { randomToken, sha256 } from "./crypto.js";
import type { AuthContext } from "./http.js";
import { cacheDel, cacheGet, cacheSet } from "./redis.js";

export const SESSION_COOKIE = "bwts_session";
const ttlMs = () => env.SESSION_TTL_HOURS * 3600_000;
/** Demo sign-ins are short-lived and vanish when the browser closes, so one demo click can't leave a browser "signed in" for days. */
export const DEMO_SESSION_HOURS = 4;

/** Redis caches the session lookup for a few seconds; logout, sign-in, password changes and org switches clear it at once. */
const SESSION_CACHE_SECONDS = 10;
export const sessionKey = (sessionId: string) => `bwts:session:${sessionId}`;

interface SessionRow {
  sessionId: string;
  activeOrg: string | null;
  lastSeenAt: Date | string;
  expiresAt: Date | string;
  userId: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
}

export async function createSession(
  res: Response,
  req: Request,
  userId: string,
  activeOrganizationId: string | null,
  tx: Tx = db,
  opts: { demo?: boolean } = {},
) {
  // A new sign-in replaces whatever session this browser already had (no orphaned sessions, no stale identity).
  if (req.auth) {
    await tx.delete(sessions).where(eq(sessions.id, req.auth.sessionId));
    await cacheDel(sessionKey(req.auth.sessionId));
  }
  const lifetime = opts.demo ? DEMO_SESSION_HOURS * 3600_000 : ttlMs();
  const token = randomToken(32);
  await tx.insert(sessions).values({
    id: sha256(token),
    userId,
    activeOrganizationId,
    userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
    ip: req.ip ?? null,
    expiresAt: new Date(Date.now() + lifetime),
  });
  setSessionCookie(res, token, opts.demo ? "session" : lifetime);
}

/** `maxAge` in ms, or "session" for a cookie that ends when the browser closes. */
export function setSessionCookie(res: Response, token: string, maxAge: number | "session" = ttlMs()) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    ...(maxAge === "session" ? {} : { maxAge }),
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "lax", path: "/" });
}

/** Loads req.auth from the session cookie. Never throws for anonymous requests. */
export async function loadSession(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return next();
  try {
    const id = sha256(token);
    // Fast path: the session and its user from Redis (if configured); otherwise, or on a miss, from PostgreSQL.
    let row = await cacheGet<SessionRow>(sessionKey(id));
    if (row && new Date(row.expiresAt) <= new Date()) row = null;
    if (!row) {
      const [fresh] = await db
        .select({
          sessionId: sessions.id,
          activeOrg: sessions.activeOrganizationId,
          lastSeenAt: sessions.lastSeenAt,
          expiresAt: sessions.expiresAt,
          userId: users.id,
          email: users.email,
          fullName: users.fullName,
          isPlatformAdmin: users.isPlatformAdmin,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));
      row = fresh ?? null;
      if (row) await cacheSet(sessionKey(id), row, SESSION_CACHE_SECONDS);
    }
    if (!row) {
      clearSessionCookie(res);
      return next();
    }
    const auth: AuthContext = {
      user: { id: row.userId, email: row.email, fullName: row.fullName, isPlatformAdmin: row.isPlatformAdmin },
      sessionId: row.sessionId,
      membership: null,
    };
    if (row.activeOrg) {
      const [m] = await db
        .select({ id: memberships.id, role: memberships.role, organizationId: memberships.organizationId, orgStatus: organizations.status })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
        .where(
          and(
            eq(memberships.userId, row.userId),
            eq(memberships.organizationId, row.activeOrg),
            eq(memberships.status, "active"),
          ),
        );
      if (m) {
        const fac = await db
          .select({ facilityId: membershipFacilities.facilityId })
          .from(membershipFacilities)
          .where(eq(membershipFacilities.membershipId, m.id));
        auth.membership = { ...m, facilityIds: fac.map((f) => f.facilityId) };
      }
    }
    req.auth = auth;
    // Sliding activity timestamp, written at most once a minute.
    if (Date.now() - new Date(row.lastSeenAt).getTime() > 60_000) {
      await db
        .update(sessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(sessions.id, id));
      await cacheDel(sessionKey(id));
    }
    next();
  } catch (err) {
    next(err);
  }
}

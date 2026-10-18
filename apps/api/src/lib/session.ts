import type { NextFunction, Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, type Tx } from "../db/client.js";
import { membershipFacilities, memberships, sessions, users } from "../db/schema.js";
import { env } from "../env.js";
import { randomToken, sha256 } from "./crypto.js";
import type { AuthContext } from "./http.js";

export const SESSION_COOKIE = "bwts_session";
const ttlMs = () => env.SESSION_TTL_HOURS * 3600_000;

export async function createSession(
  res: Response,
  req: Request,
  userId: string,
  activeOrganizationId: string | null,
  tx: Tx = db,
) {
  const token = randomToken(32);
  await tx.insert(sessions).values({
    id: sha256(token),
    userId,
    activeOrganizationId,
    userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
    ip: req.ip ?? null,
    expiresAt: new Date(Date.now() + ttlMs()),
  });
  setSessionCookie(res, token);
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: ttlMs(),
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
    const [row] = await db
      .select({
        sessionId: sessions.id,
        activeOrg: sessions.activeOrganizationId,
        lastSeenAt: sessions.lastSeenAt,
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));
    if (!row) {
      clearSessionCookie(res);
      return next();
    }
    const auth: AuthContext = {
      user: { id: row.userId, email: row.email, fullName: row.fullName },
      sessionId: row.sessionId,
      membership: null,
    };
    if (row.activeOrg) {
      const [m] = await db
        .select({ id: memberships.id, role: memberships.role, organizationId: memberships.organizationId })
        .from(memberships)
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
    if (Date.now() - row.lastSeenAt.getTime() > 60_000) {
      await db
        .update(sessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(sessions.id, id));
    }
    next();
  } catch (err) {
    next(err);
  }
}

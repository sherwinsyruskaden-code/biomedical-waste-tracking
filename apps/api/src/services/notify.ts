import { and, eq, inArray, or } from "drizzle-orm";
import { db, type Tx } from "../db/client.js";
import { membershipFacilities, memberships, notifications } from "../db/schema.js";
import { publish } from "../lib/events.js";

export interface Audience {
  userIds?: string[];
  /** All active admins of the organization. */
  admins?: boolean;
  /** Active facility staff assigned to these facilities. */
  facilityStaffAt?: (string | null | undefined)[];
}

/** Resolves an audience to concrete active member user ids within one organization. */
export async function resolveAudience(tx: Tx, orgId: string, a: Audience): Promise<string[]> {
  const ids = new Set<string>(a.userIds ?? []);
  const conds = [];
  if (a.admins) conds.push(eq(memberships.role, "admin"));
  const facs = (a.facilityStaffAt ?? []).filter((f): f is string => !!f);
  if (facs.length) {
    const staff = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(membershipFacilities, eq(membershipFacilities.membershipId, memberships.id))
      .where(and(eq(memberships.organizationId, orgId), eq(memberships.status, "active"), eq(memberships.role, "facility_staff"), inArray(membershipFacilities.facilityId, facs)));
    staff.forEach((s) => ids.add(s.userId));
  }
  if (conds.length) {
    const rows = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.organizationId, orgId), eq(memberships.status, "active"), or(...conds)));
    rows.forEach((r) => ids.add(r.userId));
  }
  if (a.userIds?.length) {
    // Only keep explicitly named users if they are active members of this org.
    const valid = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.organizationId, orgId), eq(memberships.status, "active"), inArray(memberships.userId, [...ids])));
    return valid.map((v) => v.userId);
  }
  return [...ids];
}

export async function notify(
  tx: Tx,
  orgId: string,
  audience: Audience,
  n: { kind: string; title: string; body: string; link?: string | null; alertId?: string | null; excludeUserId?: string },
) {
  const userIds = (await resolveAudience(tx, orgId, audience)).filter((u) => u !== n.excludeUserId);
  if (!userIds.length) return;
  const rows = await tx
    .insert(notifications)
    .values(userIds.map((userId) => ({ organizationId: orgId, userId, kind: n.kind, title: n.title, body: n.body, link: n.link ?? null, alertId: n.alertId ?? null })))
    .returning();
  // Publish after the caller's transaction has had a chance to commit.
  setImmediate(() => rows.forEach((r) => publish({ type: "notification", organizationId: orgId, userId: r.userId, payload: r })));
}

export { db };

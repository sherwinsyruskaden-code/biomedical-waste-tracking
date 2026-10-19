/**
 * Platform administration: reviewing organization registrations.
 *
 * Platform administrators are a separate kind of account (users.is_platform_admin). They are
 * created only from the server CLI (`npm run platform-admin -- <email>`) or the demo seeder —
 * there is no API that grants the flag, so nobody can sign up as one.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { memberships, organizations, users } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { forbidden, invalidTransition, notFound } from "../lib/errors.js";
import { sendMail } from "../lib/mailer.js";
import { env } from "../env.js";

export type ReviewDecision = "approve" | "reject";

export async function reviewOrganization(reviewerUserId: string, orgId: string, decision: ReviewDecision, note: string | null, ip?: string) {
  const result = await db.transaction(async (tx) => {
    const [reviewer] = await tx.select({ isPlatformAdmin: users.isPlatformAdmin }).from(users).where(eq(users.id, reviewerUserId));
    if (!reviewer?.isPlatformAdmin) throw forbidden("Only platform administrators can review organizations.");
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId)).for("update");
    if (!org) throw notFound("Organization");
    // Nobody reviews an organization they belong to or applied for.
    const [own] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.organizationId, orgId), eq(memberships.userId, reviewerUserId)));
    if (own || org.applicantUserId === reviewerUserId) throw forbidden("You cannot review an organization you belong to or applied for.");
    if (org.status !== "pending") throw invalidTransition(`This organization was already ${org.status}.`);
    const now = new Date();
    const [updated] = await tx
      .update(organizations)
      .set({ status: decision === "approve" ? "approved" : "rejected", reviewedAt: now, reviewedById: reviewerUserId, reviewNote: note, updatedAt: now })
      .where(eq(organizations.id, orgId))
      .returning();
    // The decision is recorded in the organization's own audit trail; rejecting deletes nothing.
    await audit({ organizationId: orgId, actorUserId: reviewerUserId, action: decision === "approve" ? "platform.organization_approved" : "platform.organization_rejected", entityType: "organization", entityId: orgId, metadata: { note }, ip }, tx);
    const [applicant] = org.applicantUserId ? await tx.select({ email: users.email, fullName: users.fullName }).from(users).where(eq(users.id, org.applicantUserId)) : [];
    return { org: updated, applicant };
  });
  if (result.applicant) {
    const approved = decision === "approve";
    await sendMail(
      result.applicant.email,
      approved ? `${result.org.name} is approved on BWTS` : `${result.org.name} was not approved on BWTS`,
      approved
        ? `Hello ${result.applicant.fullName},\n\n${result.org.name} has been approved. You can now add facilities, invite your team and start tracking waste:\n${env.APP_URL}/dashboard`
        : `Hello ${result.applicant.fullName},\n\nThe registration of ${result.org.name} was not approved.${note ? `\n\nReason: ${note}` : ""}\n\nReply to the platform team if you believe this is a mistake.`,
    ).catch(() => undefined);
  }
  return result.org;
}

/** Server-side only (CLI / demo seeder). */
export async function setPlatformAdmin(email: string, on: boolean) {
  const [u] = await db.update(users).set({ isPlatformAdmin: on, updatedAt: new Date() }).where(eq(users.email, email.trim().toLowerCase())).returning({ id: users.id });
  if (!u) throw notFound("User");
  await audit({ actorUserId: null, action: on ? "platform.admin_granted" : "platform.admin_revoked", entityType: "user", entityId: u.id });
  return u.id;
}

import { Router } from "express";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db/client.js";
import { facilities, memberships, organizations, orgStatusEnum, users } from "../db/schema.js";
import { route, zOptionalText } from "../lib/http.js";
import { reviewOrganization } from "../services/platform.js";

export const router = Router();
const base = "/api/platform";

const applicant = alias(users, "applicant");
const reviewer = alias(users, "reviewer");

/**
 * Everything a reviewer needs to decide, exactly as submitted and stored: the organization, its administrator
 * (full name and full email), and its declared facilities with Hospital/Lab kind, registration ID and address.
 * Nothing here is verified by the system; the reviewer compares it with the applicant's own documents.
 */
async function listOrgs(where: SQL | undefined) {
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      type: organizations.type,
      status: organizations.status,
      registrationNumber: organizations.registrationNumber,
      contactEmail: organizations.contactEmail,
      contactPhone: organizations.contactPhone,
      address: organizations.address,
      timezone: organizations.timezone,
      submittedAt: organizations.submittedAt,
      reviewedAt: organizations.reviewedAt,
      reviewNote: organizations.reviewNote,
      reviewedByName: reviewer.fullName,
      reviewedByEmail: reviewer.email,
      applicant: { id: applicant.id, fullName: applicant.fullName, email: applicant.email, phone: applicant.phone },
      memberCount: sql<number>`(select count(*)::int from ${memberships} m where m.organization_id = ${organizations.id})`,
    })
    .from(organizations)
    .leftJoin(applicant, eq(applicant.id, organizations.applicantUserId))
    .leftJoin(reviewer, eq(reviewer.id, organizations.reviewedById))
    .where(where)
    .orderBy(desc(organizations.submittedAt))
    .limit(200);
  const facs = rows.length
    ? await db
        .select({
          organizationId: facilities.organizationId,
          id: facilities.id,
          name: facilities.name,
          kind: facilities.kind,
          type: facilities.type,
          canReceive: facilities.canReceive,
          registrationId: facilities.registrationId,
          address: facilities.address,
          city: facilities.city,
          state: facilities.state,
          postalCode: facilities.postalCode,
          contactName: facilities.contactName,
          contactPhone: facilities.contactPhone,
          authorizationRef: facilities.authorizationRef,
        })
        .from(facilities)
        .where(inArray(facilities.organizationId, rows.map((r) => r.id)))
        .orderBy(asc(facilities.createdAt))
    : [];
  return rows.map((r) => ({ ...r, applicant: r.applicant?.id ? r.applicant : null, facilities: facs.filter((f) => f.organizationId === r.id).map(({ organizationId: _o, ...f }) => f) }));
}

route(router, base, {
  method: "get",
  path: "/organizations",
  summary: "Organization registrations for review (organization-review permission only). `q` searches organization, administrator, facility name and Facility Registration ID.",
  tag: "Organization approvals",
  access: "platform",
  query: z.object({ status: z.enum([...orgStatusEnum.enumValues, "all"]).default("pending"), q: z.string().trim().max(80).optional() }),
}, async ({ query }) => {
  const term = query.q ? `%${query.q.replace(/[%_\\]/g, (c) => "\\" + c)}%` : null;
  const search = term
    ? or(
        ilike(organizations.name, term),
        ilike(applicant.fullName, term),
        ilike(applicant.email, term),
        sql`exists (select 1 from ${facilities} f where f.organization_id = ${organizations.id} and (f.name ilike ${term} or f.registration_id ilike ${term} or f.city ilike ${term}))`,
      )
    : undefined;
  const items = await listOrgs(and(query.status === "all" ? undefined : eq(organizations.status, query.status), search));
  const counts = await db.select({ status: organizations.status, n: sql<number>`count(*)::int` }).from(organizations).groupBy(organizations.status);
  return { items, counts: Object.fromEntries(orgStatusEnum.enumValues.map((s) => [s, counts.find((c) => c.status === s)?.n ?? 0])) };
});

route(router, base, {
  method: "post",
  path: "/organizations/:organizationId/approve",
  summary: "Approve a pending organization (you cannot approve one you belong to)",
  tag: "Organization approvals",
  access: "platform",
  body: z.object({ note: zOptionalText(1000) }),
}, async ({ params, body, auth, req }) => reviewOrganization(auth.user.id, params.organizationId, "approve", body.note, req.ip));

route(router, base, {
  method: "post",
  path: "/organizations/:organizationId/reject",
  summary: "Reject a pending organization (a reason is required; nothing is deleted)",
  tag: "Organization approvals",
  access: "platform",
  body: z.object({ note: z.string().trim().min(5, "Give the applicant a reason (at least 5 characters)").max(1000) }),
}, async ({ params, body, auth, req }) => reviewOrganization(auth.user.id, params.organizationId, "reject", body.note, req.ip));

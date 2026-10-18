import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/client.js";
import { facilities, memberships, organizations, orgTypeEnum, facilityTypeEnum, wasteCategories } from "../db/schema.js";
import { badRequest } from "../lib/errors.js";
import { zOptionalText } from "../lib/http.js";
import { defaultCategories } from "./settings.js";

export const facilityInput = z
  .object({
    name: z.string().trim().min(2, "Facility name is required").max(120),
    type: z.enum(facilityTypeEnum.enumValues),
    canReceive: z.boolean().default(false),
    address: z.string().trim().min(5, "Address is required").max(300),
    city: zOptionalText(80),
    contactName: zOptionalText(120),
    contactPhone: zOptionalText(30),
    authorizationRef: zOptionalText(120),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
  })
  .refine((f) => (f.latitude == null) === (f.longitude == null), {
    message: "Provide both latitude and longitude, or neither",
    path: ["latitude"],
  })
  .refine((f) => f.type !== "treatment" || f.canReceive, {
    message: "A treatment facility must be allowed to receive waste",
    path: ["canReceive"],
  });

export type FacilityInput = z.infer<typeof facilityInput>;

export const orgInput = z.object({
  name: z.string().trim().min(2, "Organization name is required").max(160),
  type: z.enum(orgTypeEnum.enumValues),
});

/** Creates an organization, its first admin membership, default categories and optional first facility. */
export async function createOrganization(
  tx: Tx,
  input: { org: z.infer<typeof orgInput>; facility?: FacilityInput | null; adminUserId: string; contactEmail: string },
) {
  const [org] = await tx
    .insert(organizations)
    .values({ name: input.org.name, type: input.org.type, contactEmail: input.contactEmail })
    .returning();
  await tx.insert(memberships).values({ organizationId: org.id, userId: input.adminUserId, role: "admin" });
  await tx.insert(wasteCategories).values(defaultCategories.map((c) => ({ ...c, organizationId: org.id })));
  let facility = null;
  if (input.facility) {
    [facility] = await tx
      .insert(facilities)
      .values({ ...input.facility, latitude: input.facility.latitude ?? null, longitude: input.facility.longitude ?? null, organizationId: org.id })
      .returning();
  }
  return { org, facility };
}

/** Ensures every facility id belongs to the organization. */
export async function assertFacilitiesInOrg(tx: Tx, orgId: string, facilityIds: string[]) {
  if (facilityIds.length === 0) return;
  const rows = await tx
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.organizationId, orgId), inArray(facilities.id, facilityIds)));
  if (rows.length !== new Set(facilityIds).size) throw badRequest("One or more facilities do not exist in this organization.");
}

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

/** A facility row as stored (organization id added on insert). */
export type FacilitySeed = Omit<typeof facilities.$inferInsert, "id" | "organizationId" | "createdAt" | "updatedAt">;

const phone = z
  .string()
  .trim()
  .max(30)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[+0-9][0-9 ()\-]{5,}$/.test(v), "Enter a valid phone number");

/**
 * The facility submitted with an organization registration (sign-up and "create organization").
 * Only Hospital and Lab can be registered this way; treatment plants are added later by the approved organization's admin.
 * The registration ID is stored exactly as entered. This system does not verify it against any register.
 */
export const registrationFacilityInput = z
  .object({
    name: z.string().trim().min(2, "Facility name is required").max(120),
    kind: z.enum(["hospital", "lab"], { error: "Choose Hospital or Lab" }),
    registrationId: z
      .string()
      .trim()
      .min(3, "Facility Registration ID is required (at least 3 characters)")
      .max(40, "Facility Registration ID is too long")
      .regex(/^[A-Za-z0-9][A-Za-z0-9 ./_-]*[A-Za-z0-9]$/, "Use letters, digits and . / _ - only"),
    address: z.string().trim().min(5, "Address is required").max(300),
    city: z.string().trim().min(2, "City is required").max(80),
    state: z.string().trim().min(2, "State is required").max(80),
    postalCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/, "Enter a valid postal code"),
    contactName: zOptionalText(120),
    contactPhone: phone,
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
  })
  .refine((f) => (f.latitude == null) === (f.longitude == null), { message: "Provide both latitude and longitude, or neither", path: ["latitude"] });

export type RegistrationFacility = z.infer<typeof registrationFacilityInput>;

/** Registration facilities are always waste generators that do not receive waste from others. */
export const registrationToFacility = (f: RegistrationFacility): FacilitySeed => ({
  name: f.name,
  type: "generator",
  canReceive: false,
  kind: f.kind,
  registrationId: f.registrationId,
  address: f.address,
  city: f.city,
  state: f.state,
  postalCode: f.postalCode,
  contactName: f.contactName,
  contactPhone: f.contactPhone,
  latitude: f.latitude ?? null,
  longitude: f.longitude ?? null,
});

export const orgInput = z.object({
  name: z.string().trim().min(2, "Organization name is required").max(160),
  type: z.enum(orgTypeEnum.enumValues),
});

/**
 * The treatment plant that receives this organization's waste: the one configured in settings,
 * or the only authorised treatment plant if there is exactly one. Throws a clear message otherwise.
 */
export async function resolveTreatmentPlant(tx: Tx, orgId: string, configuredId: string | null | undefined, originId?: string) {
  const candidates = await tx
    .select()
    .from(facilities)
    .where(and(eq(facilities.organizationId, orgId), eq(facilities.active, true), eq(facilities.canReceive, true)));
  const usable = candidates.filter((f) => f.id !== originId);
  if (configuredId) {
    const configured = usable.find((f) => f.id === configuredId);
    if (configured) return configured;
  }
  const plants = usable.filter((f) => f.type === "treatment");
  if (plants.length === 1) return plants[0];
  if (plants.length === 0) throw badRequest("No authorised treatment plant is set up yet. Ask your organization admin to add one.");
  throw badRequest("More than one treatment plant is available. Ask your organization admin to choose the default treatment plant in Settings.");
}

/**
 * Creates an organization, its first admin membership, default categories and optional first facility.
 * The organization starts PENDING: its members can sign in but cannot operate until a platform
 * administrator approves it (see services/platform.ts).
 */
export async function createOrganization(
  tx: Tx,
  input: { org: z.infer<typeof orgInput>; facility?: FacilitySeed | null; adminUserId: string; contactEmail: string },
) {
  const f = input.facility;
  const [org] = await tx
    .insert(organizations)
    .values({
      name: input.org.name,
      type: input.org.type,
      contactEmail: input.contactEmail,
      applicantUserId: input.adminUserId,
      // What the reviewer sees for the organization comes from what the applicant submitted for the facility.
      address: f ? [f.address, f.city, f.state, f.postalCode].filter(Boolean).join(", ") : null,
      contactPhone: f?.contactPhone ?? null,
    })
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

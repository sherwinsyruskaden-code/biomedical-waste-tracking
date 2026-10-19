import { z } from "zod";

/**
 * Operational thresholds used by the alert job. These are configurable per organization.
 * Defaults are operational suggestions for demonstration, NOT legal limits — each
 * organization must set values that match its jurisdiction and authorisation.
 */
export const orgSettingsSchema = z.object({
  /** Raise "overdue collection" if a batch is not picked up this many hours after generation. */
  collectionOverdueHours: z.number().int().min(1).max(720).default(24),
  /** Raise "delayed transport" this many minutes after an assignment's due-by time. */
  transportDelayGraceMinutes: z.number().int().min(0).max(1440).default(30),
  /** Raise "missing handover" if a transporter has held custody for longer than this. */
  custodyMaxHours: z.number().int().min(1).max(168).default(8),
  /** Raise "pending receipt" if delivered waste is not received within this many minutes. */
  receiptPendingMinutes: z.number().int().min(5).max(1440).default(60),
  /** During an active, tracked assignment, a position older than this is "stale". */
  staleGpsMinutes: z.number().int().min(1).max(120).default(5),
  /** Location history older than this is deleted by the retention job. */
  locationRetentionDays: z.number().int().min(7).max(3650).default(180),
  /** Allowed difference (%) between generated and received quantity before flagging. */
  weightTolerancePercent: z.number().min(0).max(100).default(10),
  /** Where collection requests are delivered. Empty = the organization's only treatment plant. */
  defaultTreatmentFacilityId: z.string().uuid().nullable().default(null),
});

export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export const readSettings = (raw: unknown): OrgSettings => orgSettingsSchema.parse(raw ?? {});

/**
 * Default category template based on the colour-coding scheme of India's Bio-Medical Waste
 * Management Rules, 2016 (as amended). Provided as an editable starting point only; the
 * organization must verify it against the rules currently applicable to them.
 */
export const defaultCategories = [
  {
    code: "YELLOW",
    name: "Yellow — infectious / anatomical / soiled",
    colorHex: "#EAB308",
    description: "Human & animal anatomical waste, soiled waste, expired or discarded medicines, chemical waste, microbiology waste.",
    examples: "Dressings, plaster casts, cotton swabs soiled with blood or body fluids, discarded medicines.",
    handlingInstructions: "Non-chlorinated yellow bags. Do not overfill (max ¾). Label with biohazard symbol.",
    allowedDisposalMethods: ["incineration", "plasma_pyrolysis", "deep_burial", "autoclave", "microwave", "hydroclave"],
  },
  {
    code: "RED",
    name: "Red — contaminated recyclable",
    colorHex: "#DC2626",
    description: "Contaminated waste (recyclable) such as tubing, bottles, IV sets, catheters, gloves.",
    examples: "Tubing, IV sets, catheters, urine bags, syringes without needles, gloves.",
    handlingInstructions: "Non-chlorinated red bags or containers. Must be disinfected/treated before recycling.",
    allowedDisposalMethods: ["autoclave", "microwave", "hydroclave", "shredding", "recycling_after_treatment"],
  },
  {
    code: "WHITE",
    name: "White (translucent) — sharps",
    colorHex: "#64748B",
    description: "Waste sharps including metals: needles, syringes with fixed needles, scalpels, blades.",
    examples: "Needles, scalpels, blades, syringes with fixed needles.",
    handlingInstructions: "Puncture-proof, leak-proof, tamper-proof translucent containers. Never recap needles.",
    allowedDisposalMethods: ["autoclave", "shredding", "encapsulation", "sharps_pit", "recycling_after_treatment"],
  },
  {
    code: "BLUE",
    name: "Blue — glassware & metallic implants",
    colorHex: "#2563EB",
    description: "Broken or discarded and contaminated glass, including medicine vials and ampoules; metallic body implants.",
    examples: "Glass vials, ampoules, broken glassware, metallic implants.",
    handlingInstructions: "Puncture-proof, leak-proof cardboard boxes or containers with blue marking.",
    allowedDisposalMethods: ["autoclave", "microwave", "chemical_disinfection", "recycling_after_treatment"],
  },
];

/**
 * Sample data — SYNTHETIC DATA ONLY.
 *
 * One clearly-labelled organization ("Sunrise Health Network") with two hospitals, one treatment plant and
 * two transporters, plus two pending applicant organizations to review. A handful of batches (five) are
 * created through the same services the API uses, so custody history is consistent. Their tracking codes
 * start with "SMP-" so they are easy to tell apart from batches you register yourself, and they are
 * back-dated. Map positions are stored with source = "simulated".
 *
 *   npm run db:seed            # create the sample data if missing; otherwise safely refresh names/accounts in place
 *   npm run db:seed:reset      # DESTRUCTIVE: delete the sample organizations (and everything in them) and recreate
 *
 * With DEMO_MODE=true the one-click sign-in calls ensureSampleData() first. That never deletes anything:
 * it creates the data when absent and otherwise only renames / tops up the sample accounts (idempotent).
 * Only organizations with the names below and users with a *@(sample|demo).bwts.local email are ever touched.
 */
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { db } from "../db/client.js";
import { assignments, containers, custodyEvents, facilities, locationPoints, membershipFacilities, memberships, organizations, users, wasteBatches, wasteCategories } from "../db/schema.js";
import { createOrganization } from "./orgs.js";
import { performAction } from "./lifecycle.js";
import { assignmentAction, createAssignment, requestCollection, setTracking } from "./assignments.js";
import type { Actor } from "../lib/http.js";
import { humanCode } from "../lib/crypto.js";
import { createQrIdentifier } from "./identification.js";

export const DEMO_ORG_NAME = "Sunrise Health Network (sample data)";
const LEGACY_ORG_NAMES = ["Sunrise Health Network (DEMO — synthetic data)"];
export const DEMO_APPLICANT_ORGS = ["Lakeview Clinic (sample applicant — synthetic)", "Coastal Diagnostics Laboratory (sample applicant — synthetic)"];
const LEGACY_APPLICANT_ORGS = ["Lakeview Clinic (DEMO applicant — synthetic)", "Coastal Biomedical Transport (DEMO applicant — synthetic)", "Coastal Biomedical Transport (sample applicant — synthetic)"];
/** Bump when the sample data layout changes. Existing data is refreshed in place ONCE per version, then left alone. */
export const SAMPLE_DATA_VERSION = 4;
export const DEMO_PASSWORD = "Demo-pass-2026";
export const SAMPLE_DOMAIN = "sample.bwts.local";
const LEGACY_DOMAIN = "demo.bwts.local";

export const DEMO_FACILITIES = {
  hospitalA: "Sunrise General Hospital (Hospital A)",
  hospitalB: "Sunrise Women & Children Hospital (Hospital B)",
  plant: "GreenCycle Treatment Plant",
};
/** Names earlier versions used, so existing sample data is renamed in place instead of being recreated. */
const LEGACY_FACILITY_NAMES = {
  hospitalA: ["Sunrise General Hospital (demo)", "Sunrise General Hospital (demo · Hospital A)"],
  hospitalB: ["Sunrise Clinic Chromepet (demo)", "Sunrise Women & Children Hospital (demo · Hospital B)"],
  plant: ["GreenCycle CBWTF (demo)", "GreenCycle CBWTF (demo treatment plant)"],
};

type PersonRole = "admin" | "facility_staff" | "transporter" | "applicant";
export const demoPeople: { key: string; email: string; fullName: string; role: PersonRole }[] = [
  { key: "admin", email: `admin@${SAMPLE_DOMAIN}`, fullName: "Anita Raman (Main Admin)", role: "admin" },
  { key: "staff", email: `staff@${SAMPLE_DOMAIN}`, fullName: "Karthik Selvam (Hospital A staff)", role: "facility_staff" },
  { key: "staffB", email: `staff.b@${SAMPLE_DOMAIN}`, fullName: "Divya Menon (Hospital B staff)", role: "facility_staff" },
  { key: "plant", email: `plant@${SAMPLE_DOMAIN}`, fullName: "Meena Iyer (treatment plant staff)", role: "facility_staff" },
  { key: "driver", email: `driver@${SAMPLE_DOMAIN}`, fullName: "Ravi Kumar (transporter)", role: "transporter" },
  { key: "driver2", email: `driver2@${SAMPLE_DOMAIN}`, fullName: "Suresh Babu (transporter)", role: "transporter" },
  { key: "driver3", email: `driver3@${SAMPLE_DOMAIN}`, fullName: "Latha Nair (transporter)", role: "transporter" },
  { key: "applicant1", email: `lakeview@${SAMPLE_DOMAIN}`, fullName: "Arjun Pillai (applicant)", role: "applicant" },
  { key: "applicant2", email: `coastal@${SAMPLE_DOMAIN}`, fullName: "Nisha Rao (applicant)", role: "applicant" },
];
const orgMembers = demoPeople.filter((p) => p.role !== "applicant");
const VEHICLES: Record<string, string> = { driver: "TN 22 BW 101", driver2: "TN 22 BW 202", driver3: "TN 22 BW 303" };
const HOSPITAL_A_FIELDS = { kind: "hospital" as const, registrationId: "SAMPLE-HCF-001", state: "Tamil Nadu", postalCode: "600045" };
const HOSPITAL_B_FIELDS = { kind: "hospital" as const, registrationId: "SAMPLE-HCF-002", state: "Tamil Nadu", postalCode: "600044" };
const person = (key: string) => demoPeople.find((p) => p.key === key)!;

const applicants = [
  { key: "applicant1", name: DEMO_APPLICANT_ORGS[0], legacy: [LEGACY_APPLICANT_ORGS[0]], type: "clinic" as const, reg: "SAMPLE-CLINIC-4471", phone: "+91 90000 00071", address: "4 Lake View Road, Velachery, Chennai, Tamil Nadu, 600042", facility: { name: "Lakeview Clinic, Velachery", type: "generator" as const, canReceive: false, kind: "hospital" as const, registrationId: "SAMPLE-LVC-4471", address: "4 Lake View Road, Velachery", city: "Chennai", state: "Tamil Nadu", postalCode: "600042", contactName: "Arjun Pillai", contactPhone: "+91 90000 00071", authorizationRef: "SAMPLE-PCB-2291", latitude: 12.9815, longitude: 80.218 } },
  { key: "applicant2", name: DEMO_APPLICANT_ORGS[1], legacy: [LEGACY_APPLICANT_ORGS[1], LEGACY_APPLICANT_ORGS[2]], type: "laboratory" as const, reg: "SAMPLE-LAB-8810", phone: "+91 90000 00072", address: "18 Harbour Road, Ennore, Chennai, Tamil Nadu, 600057", facility: { name: "Coastal Diagnostics Lab, Ennore", type: "generator" as const, canReceive: false, kind: "lab" as const, registrationId: "SAMPLE-LAB-8810", address: "18 Harbour Road, Ennore", city: "Chennai", state: "Tamil Nadu", postalCode: "600057", contactName: "Nisha Rao", contactPhone: "+91 90000 00072", latitude: 13.2147, longitude: 80.3207 } },
];

async function findOrg(names: string[]) {
  const [o] = await db.select().from(organizations).where(inArray(organizations.name, names));
  return o ?? null;
}

async function createApplicantOrg(a: (typeof applicants)[number], userId: string) {
  const { org: o } = await db.transaction((tx) => createOrganization(tx, { org: { name: a.name, type: a.type }, facility: a.facility, adminUserId: userId, contactEmail: person(a.key).email }));
  await db.update(organizations).set({ registrationNumber: a.reg, contactPhone: a.phone, address: a.address }).where(eq(organizations.id, o.id));
}

/**
 * Brings existing sample data up to date WITHOUT deleting anything: renames the organization, facilities and
 * accounts (earlier versions used the word "demo" in them), fixes facility assignments, adds missing accounts,
 * and gives the Main Admin account the organization-review permission. Batches and history are not touched.
 */
export async function upgradeSampleData(log: (m: string) => void = () => undefined) {
  const org = await findOrg([DEMO_ORG_NAME, ...LEGACY_ORG_NAMES]);
  if (!org) return false;
  // Already refreshed for this layout: do nothing at all, so routine restarts never touch anyone's records.
  if (((org.settings ?? {}) as { sampleDataVersion?: number }).sampleDataVersion != null && ((org.settings as { sampleDataVersion: number }).sampleDataVersion) >= SAMPLE_DATA_VERSION) return false;
  const passwordHash = await hash(DEMO_PASSWORD);
  await db.transaction(async (tx) => {
    await tx.update(organizations).set({ name: DEMO_ORG_NAME, registrationNumber: sql`replace(${organizations.registrationNumber}, 'DEMO-', 'SAMPLE-')`, address: sql`replace(${organizations.address}, 'Demo', 'Sample')`, contactEmail: sql`replace(${organizations.contactEmail}, ${"@" + LEGACY_DOMAIN}, ${"@" + SAMPLE_DOMAIN})` }).where(eq(organizations.id, org.id));
    // Facilities: rename by their previous names; create hospital B only if this older data never had it.
    const facs = await tx.select().from(facilities).where(eq(facilities.organizationId, org.id));
    const find = (names: string[]) => facs.find((f) => names.includes(f.name));
    const ids: Record<string, string> = {};
    for (const key of ["hospitalA", "hospitalB", "plant"] as const) {
      const f = find([DEMO_FACILITIES[key], ...LEGACY_FACILITY_NAMES[key]]);
      if (f) {
        const fields = key === "hospitalA" ? HOSPITAL_A_FIELDS : key === "hospitalB" ? HOSPITAL_B_FIELDS : { registrationId: "SAMPLE-CBWTF-77" };
        await tx.update(facilities).set({ name: DEMO_FACILITIES[key], authorizationRef: sql`replace(${facilities.authorizationRef}, 'DEMO-', 'SAMPLE-')`, ...fields }).where(eq(facilities.id, f.id));
        ids[key] = f.id;
      } else if (key === "hospitalB") {
        const [b] = await tx.insert(facilities).values({ organizationId: org.id, name: DEMO_FACILITIES.hospitalB, type: "generator", address: "Radha Nagar, Chromepet", city: "Chennai", contactName: "Divya Menon", contactPhone: "+91 90000 00002", authorizationRef: "SAMPLE-HCF-002", ...HOSPITAL_B_FIELDS, latitude: 12.9516, longitude: 80.1462 }).returning();
        ids[key] = b.id;
      }
    }
    if (ids.plant) {
      const cur = (org.settings ?? {}) as Record<string, unknown>;
      if (!cur.defaultTreatmentFacilityId) await tx.update(organizations).set({ settings: { ...cur, defaultTreatmentFacilityId: ids.plant } }).where(eq(organizations.id, org.id));
    }
    // Accounts: move to the sample domain / names, create any that are missing, fix facility assignments.
    await tx.update(users).set({ email: sql`replace(${users.email}, ${"@" + LEGACY_DOMAIN}, ${"@" + SAMPLE_DOMAIN})` }).where(like(users.email, `%@${LEGACY_DOMAIN}`));
    const facilityOf: Record<string, string[]> = { staff: [ids.hospitalA], staffB: [ids.hospitalB], plant: [ids.plant] };
    for (const p of orgMembers) {
      let [u] = await tx.select().from(users).where(eq(users.email, p.email));
      if (!u) [u] = await tx.insert(users).values({ email: p.email, fullName: p.fullName, passwordHash, phone: "+91 90000 00099" }).returning();
      else await tx.update(users).set({ fullName: p.fullName }).where(eq(users.id, u.id));
      let [m] = await tx.select().from(memberships).where(and(eq(memberships.organizationId, org.id), eq(memberships.userId, u.id)));
      if (!m) [m] = await tx.insert(memberships).values({ organizationId: org.id, userId: u.id, role: p.role as "admin" | "facility_staff" | "transporter", vehicleReg: VEHICLES[p.key] ?? null }).returning();
      else if (VEHICLES[p.key]) await tx.update(memberships).set({ vehicleReg: sql`replace(${memberships.vehicleReg}, 'DEMO', 'BW')` }).where(eq(memberships.id, m.id));
      if (facilityOf[p.key]) {
        await tx.delete(membershipFacilities).where(eq(membershipFacilities.membershipId, m.id));
        await tx.insert(membershipFacilities).values(facilityOf[p.key].map((facilityId) => ({ membershipId: m.id, facilityId })));
      }
      if (p.key === "admin") await tx.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, u.id)); // may review OTHER organizations
    }
    // The separate platform-reviewer account no longer exists.
    await tx.delete(users).where(inArray(users.email, [`platform@${SAMPLE_DOMAIN}`, `platform@${LEGACY_DOMAIN}`]));
    // Visible text on mutable records.
    await tx.update(assignments).set({ notes: sql`regexp_replace(replace(${assignments.notes}, 'Demo job', 'Sample collection'), '[Dd]emo', 'sample', 'g')`, vehicleReg: sql`replace(${assignments.vehicleReg}, 'DEMO', 'BW')` }).where(eq(assignments.organizationId, org.id));
    await tx.execute(sql`update disposal_records set document_ref = replace(document_ref, 'DEMO-', 'SAMPLE-') where organization_id = ${org.id}`);
    // Applicant organizations to review: rename, or create if this older data never had them.
    for (const a of applicants) {
      await tx.update(users).set({ fullName: person(a.key).fullName }).where(eq(users.email, person(a.key).email));
      const [ex] = await tx.select().from(organizations).where(inArray(organizations.name, [a.name, ...a.legacy]));
      if (ex) {
        await tx.update(organizations).set({ name: a.name, type: a.type, registrationNumber: a.reg, address: a.address, contactPhone: a.phone, contactEmail: person(a.key).email }).where(eq(organizations.id, ex.id));
        const fs = await tx.select().from(facilities).where(eq(facilities.organizationId, ex.id));
        if (fs.length === 0) await tx.insert(facilities).values({ ...a.facility, organizationId: ex.id });
        for (const f of fs) await tx.update(facilities).set({ name: f.name.replace(" (demo)", ""), authorizationRef: sql`replace(${facilities.authorizationRef}, 'DEMO-', 'SAMPLE-')`, kind: f.kind ?? a.facility.kind, registrationId: f.registrationId ?? a.facility.registrationId, state: f.state ?? a.facility.state, postalCode: f.postalCode ?? a.facility.postalCode }).where(eq(facilities.id, f.id));
      }
    }
  });
  for (const a of applicants) {
    if (await findOrg([a.name, ...a.legacy])) continue;
    let [u] = await db.select().from(users).where(eq(users.email, person(a.key).email));
    if (!u) [u] = await db.insert(users).values({ email: person(a.key).email, fullName: person(a.key).fullName, passwordHash, phone: "+91 90000 00098" }).returning();
    await createApplicantOrg(a, u.id);
  }
  await db.update(organizations).set({ settings: sql`coalesce(${organizations.settings}, '{}'::jsonb) || ${JSON.stringify({ sampleDataVersion: SAMPLE_DATA_VERSION })}::jsonb` }).where(eq(organizations.id, org.id));
  log("Sample data refreshed in place (no batches or history were changed).");
  return true;
}

/** Creates the sample data when absent, otherwise upgrades it in place. Never deletes. */
export async function ensureSampleData(log: (m: string) => void = () => undefined) {
  if (await findOrg([DEMO_ORG_NAME, ...LEGACY_ORG_NAMES])) return upgradeSampleData(log);
  return seedDemo({ log });
}

/** Creates the sample data. With reset it FIRST DELETES the sample organizations and sample accounts. */
export async function seedDemo({ reset = false, log = console.log }: { reset?: boolean; log?: (msg: string) => void } = {}): Promise<boolean> {
  const existing = await findOrg([DEMO_ORG_NAME, ...LEGACY_ORG_NAMES]);
  if (existing && !reset) {
    await upgradeSampleData(log);
    log("Sample organization already exists (kept as is). Use `npm run db:seed:reset` to wipe and recreate it.");
    return false;
  }
  const old = await db.select({ id: organizations.id }).from(organizations).where(inArray(organizations.name, [DEMO_ORG_NAME, ...LEGACY_ORG_NAMES, ...DEMO_APPLICANT_ORGS, ...LEGACY_APPLICANT_ORGS]));
  if (old.length) {
    await db.delete(organizations).where(inArray(organizations.id, old.map((o) => o.id)));
    log("Removed the previous sample organizations.");
  }
  // Leftover sample accounts (e.g. the org was deleted by hand) would block re-creation.
  await db.delete(users).where(or(like(users.email, `%@${SAMPLE_DOMAIN}`), like(users.email, `%@${LEGACY_DOMAIN}`)));

  const passwordHash = await hash(DEMO_PASSWORD);
  const ids: Record<string, string> = {};
  for (const [i, p] of demoPeople.entries()) {
    const [u] = await db.insert(users).values({ email: p.email, fullName: p.fullName, passwordHash, phone: `+91 90000 000${String(i).padStart(2, "0")}`, isPlatformAdmin: p.key === "admin" }).returning();
    ids[p.key] = u.id;
  }

  const { org, facility: hospitalA } = await db.transaction((tx) =>
    createOrganization(tx, {
      org: { name: DEMO_ORG_NAME, type: "health_network" },
      adminUserId: ids.admin,
      contactEmail: person("admin").email,
      facility: { name: DEMO_FACILITIES.hospitalA, type: "generator", canReceive: false, address: "GST Road, Tambaram", city: "Chennai", contactName: "Karthik Selvam", contactPhone: "+91 90000 00001", authorizationRef: "SAMPLE-HCF-001", ...HOSPITAL_A_FIELDS, latitude: 12.9249, longitude: 80.1275 },
    }),
  );
  // The sample organization is pre-approved (it cannot approve itself).
  await db.update(organizations).set({ registrationNumber: "SAMPLE-REG-0001", contactPhone: "+91 90000 00000", address: "12 Sample Avenue, Chennai (synthetic)", status: "approved", reviewedAt: new Date(), reviewNote: "Pre-approved sample organization (synthetic data)." }).where(eq(organizations.id, org.id));
  const [hospitalB] = await db.insert(facilities).values({ organizationId: org.id, name: DEMO_FACILITIES.hospitalB, type: "generator", address: "Radha Nagar, Chromepet", city: "Chennai", contactName: "Divya Menon", contactPhone: "+91 90000 00002", authorizationRef: "SAMPLE-HCF-002", ...HOSPITAL_B_FIELDS, latitude: 12.9516, longitude: 80.1462 }).returning();
  const [plant] = await db.insert(facilities).values({ organizationId: org.id, name: DEMO_FACILITIES.plant, type: "treatment", canReceive: true, address: "SIPCOT Industrial Estate, Irungattukottai", city: "Chennai", contactName: "Meena Iyer", contactPhone: "+91 90000 00003", authorizationRef: "SAMPLE-CBWTF-77", registrationId: "SAMPLE-CBWTF-77", latitude: 12.9716, longitude: 79.9864 }).returning();
  await db.update(organizations).set({ settings: { defaultTreatmentFacilityId: plant.id, sampleDataVersion: SAMPLE_DATA_VERSION } }).where(eq(organizations.id, org.id));

  const facilityOf: Record<string, string[]> = { staff: [hospitalA!.id], staffB: [hospitalB.id], plant: [plant.id] };
  for (const p of orgMembers) {
    if (p.key === "admin") continue; // createOrganization already made the admin membership
    const [m] = await db.insert(memberships).values({ organizationId: org.id, userId: ids[p.key], role: p.role as "facility_staff" | "transporter", vehicleReg: VEHICLES[p.key] ?? null }).returning();
    if (facilityOf[p.key]) await db.insert(membershipFacilities).values(facilityOf[p.key].map((facilityId) => ({ membershipId: m.id, facilityId })));
  }

  const memberRows = await db.select().from(memberships).where(eq(memberships.organizationId, org.id));
  const actor = (key: string): Actor => {
    const m = memberRows.find((x) => x.userId === ids[key])!;
    return { userId: ids[key], orgId: org.id, role: m.role, facilityIds: facilityOf[key] ?? [], membershipId: m.id };
  };
  const staffA = actor("staff"), staffB = actor("staffB"), plantStaff = actor("plant"), driver = actor("driver"), driver2 = actor("driver2");
  void plantStaff;
  const cats = await db.select().from(wasteCategories).where(eq(wasteCategories.organizationId, org.id));
  const cat = (code: string) => cats.find((c) => c.code === code)!.id;

  /** Registers a batch the same way the API does, back-dated by `hoursAgo`. SMP- codes mark preloaded records. */
  async function batch(code: string, qty: number, containersN: number, area: string, by: Actor, hoursAgo: number) {
    const origin = by.facilityIds[0];
    const when = new Date(Date.now() - hoursAgo * 3600_000);
    const trackingCode = `SMP-${when.toISOString().slice(2, 10).replaceAll("-", "")}-${humanCode(6)}`;
    const [b] = await db
      .insert(wasteBatches)
      .values({ organizationId: org.id, trackingCode, originFacilityId: origin, categoryId: cat(code), quantity: qty, unit: "kg", containerCount: containersN, containerType: code === "WHITE" ? "Sharps container" : `${code.toLowerCase()} bag`, sourceArea: area, responsibleUserId: by.userId, currentCustodianFacilityId: origin, generatedAt: when, createdAt: when, statusChangedAt: when, collectionDueAt: new Date(when.getTime() + 24 * 3600_000) })
      .returning();
    for (let i = 1; i <= containersN; i++) {
      const [c] = await db.insert(containers).values({ organizationId: org.id, batchId: b.id, label: `${trackingCode}-C${i}`, sequence: i }).returning();
      await createQrIdentifier(db, org.id, c.id, by.userId);
    }
    await db.insert(custodyEvents).values({ organizationId: org.id, batchId: b.id, eventType: "created", toStatus: "generated", actorUserId: by.userId, actorRole: "facility_staff", facilityId: origin, toCustodianFacilityId: origin, details: { synthetic: true }, createdAt: when });
    return b;
  }
  const seg = (by: Actor, id: string) => performAction(by, id, "segregate", { confirmSegregation: true });
  /** A collection request raised earlier by hospital staff (back-dated job window). */
  const job = (batchIds: string[], by: Actor, d: Actor) =>
    createAssignment(by, { transporterUserId: d.userId, originFacilityId: by.facilityIds[0], destinationFacilityId: plant.id, batchIds, scheduledPickupAt: new Date(Date.now() - 3600_000), dueBy: new Date(Date.now() + 3 * 3600_000), vehicleReg: null, notes: "Sample collection — synthetic data" }, { backfill: true });
  const noScan = { scanMethod: "manual", notes: "Preloaded record: recorded without a physical scan" };
  async function arrive(b: { id: string }, by: Actor, d: Actor) {
    await seg(by, b.id);
    const a = await job([b.id], by, d);
    await assignmentAction(d, a.id, "accept");
    await performAction(d, b.id, "pickup", noScan);
    await assignmentAction(d, a.id, "start");
    await performAction(d, b.id, "handover", noScan);
  }

  // 1. Hospital A — on the road right now with Suresh, with a SIMULATED position trail
  const moving = await batch("YELLOW", 22.5, 2, "Ward 1", staffA, 3);
  await seg(staffA, moving.id);
  const live = await job([moving.id], staffA, driver2);
  await assignmentAction(driver2, live.id, "accept");
  await performAction(driver2, moving.id, "pickup", noScan);
  await setTracking(driver2, live.id, true);
  await assignmentAction(driver2, live.id, "start");
  const pts = 12;
  const now = Date.now();
  for (let i = 0; i < pts; i++) {
    const t = (i / (pts - 1)) * 0.55;
    await db.insert(locationPoints).values({
      organizationId: org.id,
      assignmentId: live.id,
      transporterUserId: ids.driver2,
      latitude: 12.9249 + (12.9716 - 12.9249) * t + Math.sin(i) * 0.0015,
      longitude: 80.1275 + (79.9864 - 80.1275) * t,
      accuracyM: 12 + (i % 4) * 3,
      recordedAt: new Date(now - (pts - 1 - i) * 30_000),
      source: "simulated",
    });
  }
  await db.update(assignments).set({ lastLocationAt: new Date(now) }).where(eq(assignments.id, live.id));

  // 2. Hospital A — segregated, ready for "Request collection" (Ravi and Latha are free to be chosen)
  const readyA = await batch("BLUE", 3.3, 1, "Pharmacy", staffA, 1);
  await seg(staffA, readyA.id);

  // 3. Hospital B — segregated, ready for "Request collection"
  const readyB = await batch("WHITE", 2.4, 1, "Emergency", staffB, 2);
  await seg(staffB, readyB.id);

  // 4. Hospital B — arrived at the plant, waiting for the plant to confirm receipt: the plant stage starts here
  await arrive(await batch("YELLOW", 12.0, 1, "Labour ward", staffB, 6), staffB, driver);

  // Two organizations waiting for review (synthetic applicants); the Main Admin account can review them
  for (const a of applicants) await createApplicantOrg(a, ids[a.key]);

  log(`Sample organization created: ${DEMO_ORG_NAME}`);
  log("  4 synthetic batches (tracking codes start with SMP-): one on the road, two ready to request collection, one arrived at the plant.");
  log(`  ${applicants.length} synthetic organizations are waiting for approval (review them as the Main Admin account).`);
  log(`  Sign in with any of these (password: ${DEMO_PASSWORD}), or use the sign-in buttons on the home page:`);
  for (const p of demoPeople) log(`    ${p.email.padEnd(28)} ${p.role}`);
  return true;
}

/**
 * OPT-IN cleanup: deletes the PRELOADED synthetic batches (those whose "created" history event is marked synthetic) of
 * the sample organization, together with their labels, history, receipts/disposals and the transport orders that only
 * carried them. Batches registered by people (not marked synthetic) are never selected. Dry run unless `confirm` is set.
 */
export async function trimSampleBatches({ confirm = false }: { confirm?: boolean } = {}) {
  const org = await findOrg([DEMO_ORG_NAME, ...LEGACY_ORG_NAMES]);
  if (!org) return { organization: null as string | null, batches: 0, assignments: 0, deleted: false };
  const synthetic = await db.execute<{ id: string }>(sql`
    select b.id from waste_batches b
    where b.organization_id = ${org.id}
      and exists (select 1 from custody_events e where e.batch_id = b.id and e.event_type = 'created' and e.details->>'synthetic' = 'true')`);
  const batchIds = synthetic.rows.map((r) => r.id);
  const asgRows = batchIds.length
    ? await db.execute<{ id: string }>(sql`
        select a.id from assignments a
        where a.organization_id = ${org.id}
          and exists (select 1 from assignment_batches ab where ab.assignment_id = a.id and ab.batch_id in (${sql.join(batchIds.map((i) => sql`${i}::uuid`), sql`, `)}))
          and not exists (select 1 from assignment_batches ab where ab.assignment_id = a.id and ab.batch_id not in (${sql.join(batchIds.map((i) => sql`${i}::uuid`), sql`, `)}))`)
    : { rows: [] as { id: string }[] };
  const asgIds = asgRows.rows.map((r) => r.id);
  if (confirm && batchIds.length) {
    await db.transaction(async (tx) => {
      await tx.delete(wasteBatches).where(inArray(wasteBatches.id, batchIds));
      if (asgIds.length) await tx.delete(assignments).where(inArray(assignments.id, asgIds));
    });
  }
  return { organization: org.name, batches: batchIds.length, assignments: asgIds.length, deleted: confirm && batchIds.length > 0 };
}

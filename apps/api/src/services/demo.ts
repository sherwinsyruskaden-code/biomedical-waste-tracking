/**
 * Demo data — SYNTHETIC DATA ONLY.
 *
 * Creates one clearly-labelled demo organization ("Sunrise Health Network") with two hospitals,
 * one treatment plant and two transporters, plus a demo platform reviewer and two pending
 * applicant organizations to review. Batches are created through the same services the API uses
 * (so custody history is consistent). Location points created here are stored with
 * source = "simulated" and are shown as simulated on the map.
 *
 *   npm run db:seed            # creates the demo data (skips if it already exists)
 *   npm run db:seed:reset      # deletes the demo data first, then recreates it
 *
 * With DEMO_MODE=true the one-click demo sign-in also calls seedDemo() if the demo is missing or incomplete.
 * Only organizations with the names below and users with an @demo.bwts.local email are ever deleted.
 */
import { and, eq, inArray, like } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { db } from "../db/client.js";
import { assignments, containers, custodyEvents, facilities, locationPoints, membershipFacilities, memberships, organizations, users, wasteBatches, wasteCategories } from "../db/schema.js";
import { createOrganization } from "./orgs.js";
import { performAction } from "./lifecycle.js";
import { assignmentAction, createAssignment, requestCollection, setTracking } from "./assignments.js";
import type { Actor } from "../lib/http.js";
import { humanCode } from "../lib/crypto.js";
import { createQrIdentifier } from "./identification.js";
import { reviewOrganization } from "./platform.js";

export const DEMO_ORG_NAME = "Sunrise Health Network (DEMO — synthetic data)";
export const DEMO_APPLICANT_ORGS = ["Lakeview Clinic (DEMO applicant — synthetic)", "Coastal Biomedical Transport (DEMO applicant — synthetic)"];
export const DEMO_PASSWORD = "Demo-pass-2026";
export const DEMO_FACILITIES = {
  hospitalA: "Sunrise General Hospital (demo · Hospital A)",
  hospitalB: "Sunrise Women & Children Hospital (demo · Hospital B)",
  plant: "GreenCycle CBWTF (demo treatment plant)",
};

type DemoRole = "admin" | "facility_staff" | "transporter" | "platform" | "applicant";
export const demoPeople: { key: string; email: string; fullName: string; role: DemoRole }[] = [
  { key: "admin", email: "admin@demo.bwts.local", fullName: "Anita Raman (demo org admin)", role: "admin" },
  { key: "staff", email: "staff@demo.bwts.local", fullName: "Karthik Selvam (demo · Hospital A staff)", role: "facility_staff" },
  { key: "staffB", email: "staff.b@demo.bwts.local", fullName: "Divya Menon (demo · Hospital B staff)", role: "facility_staff" },
  { key: "plant", email: "plant@demo.bwts.local", fullName: "Meena Iyer (demo plant staff)", role: "facility_staff" },
  { key: "driver", email: "driver@demo.bwts.local", fullName: "Ravi Kumar (demo transporter)", role: "transporter" },
  { key: "driver2", email: "driver2@demo.bwts.local", fullName: "Suresh Babu (demo transporter)", role: "transporter" },
  { key: "platform", email: "platform@demo.bwts.local", fullName: "Farah Qureshi (demo platform reviewer)", role: "platform" },
  { key: "applicant1", email: "lakeview@demo.bwts.local", fullName: "Arjun Pillai (demo applicant)", role: "applicant" },
  { key: "applicant2", email: "coastal@demo.bwts.local", fullName: "Nisha Rao (demo applicant)", role: "applicant" },
];
const orgMembers = demoPeople.filter((p) => p.role === "admin" || p.role === "facility_staff" || p.role === "transporter");

/** True when the demo organization has every demo account it needs (an older demo version may not). */
export async function demoIsComplete() {
  const [org] = await db.select({ id: organizations.id, status: organizations.status }).from(organizations).where(eq(organizations.name, DEMO_ORG_NAME));
  if (!org || org.status !== "approved") return false;
  const rows = await db
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, org.id), eq(memberships.status, "active")));
  if (!orgMembers.every((p) => rows.some((r) => r.email === p.email))) return false;
  const [reviewer] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, "platform@demo.bwts.local"), eq(users.isPlatformAdmin, true)));
  return !!reviewer;
}

/** Creates the demo data. Returns false if it already existed and reset was not requested. */
export async function seedDemo({ reset = false, log = console.log }: { reset?: boolean; log?: (msg: string) => void } = {}): Promise<boolean> {
  const [existing] = await db.select().from(organizations).where(eq(organizations.name, DEMO_ORG_NAME));
  if (existing && !reset) {
    log("Demo organization already exists. Use `npm run db:seed:reset` to recreate it.");
    return false;
  }
  const old = await db.select({ id: organizations.id }).from(organizations).where(inArray(organizations.name, [DEMO_ORG_NAME, ...DEMO_APPLICANT_ORGS]));
  if (old.length) {
    await db.delete(organizations).where(inArray(organizations.id, old.map((o) => o.id)));
    log("Removed previous demo organizations.");
  }
  // Leftover demo users (e.g. the org was deleted by hand) would block re-creation.
  await db.delete(users).where(like(users.email, "%@demo.bwts.local"));

  const passwordHash = await hash(DEMO_PASSWORD);
  const ids: Record<string, string> = {};
  for (const [i, p] of demoPeople.entries()) {
    const [u] = await db.insert(users).values({ email: p.email, fullName: p.fullName, passwordHash, phone: `+91 90000 000${String(i).padStart(2, "0")}`, isPlatformAdmin: p.role === "platform" }).returning();
    ids[p.key] = u.id;
  }

  // The demo organization is registered and then approved exactly like a real one.
  const { org, facility: hospitalA } = await db.transaction((tx) =>
    createOrganization(tx, {
      org: { name: DEMO_ORG_NAME, type: "health_network" },
      adminUserId: ids.admin,
      contactEmail: "admin@demo.bwts.local",
      facility: { name: DEMO_FACILITIES.hospitalA, type: "generator", canReceive: false, address: "GST Road, Tambaram", city: "Chennai", contactName: "Karthik Selvam", contactPhone: "+91 90000 00001", authorizationRef: "DEMO-HCF-001", latitude: 12.9249, longitude: 80.1275 },
    }),
  );
  await db.update(organizations).set({ registrationNumber: "DEMO-REG-0001", contactPhone: "+91 90000 00000", address: "12 Demo Avenue, Chennai (synthetic)" }).where(eq(organizations.id, org.id));
  await reviewOrganization(ids.platform, org.id, "approve", "Demo organization approved during demo setup (synthetic data).");
  const [hospitalB] = await db.insert(facilities).values({ organizationId: org.id, name: DEMO_FACILITIES.hospitalB, type: "generator", address: "Radha Nagar, Chromepet", city: "Chennai", contactName: "Divya Menon", contactPhone: "+91 90000 00002", authorizationRef: "DEMO-HCF-002", latitude: 12.9516, longitude: 80.1462 }).returning();
  const [plant] = await db.insert(facilities).values({ organizationId: org.id, name: DEMO_FACILITIES.plant, type: "treatment", canReceive: true, address: "SIPCOT Industrial Estate, Irungattukottai", city: "Chennai", contactName: "Meena Iyer", contactPhone: "+91 90000 00003", authorizationRef: "DEMO-CBWTF-77", latitude: 12.9716, longitude: 79.9864 }).returning();
  await db.update(organizations).set({ settings: { defaultTreatmentFacilityId: plant.id } }).where(eq(organizations.id, org.id));

  const facilityOf: Record<string, string[]> = { staff: [hospitalA!.id], staffB: [hospitalB.id], plant: [plant.id] };
  const vehicles: Record<string, string> = { driver: "TN 22 DEMO 101", driver2: "TN 22 DEMO 202" };
  for (const p of orgMembers) {
    if (p.key === "admin") continue; // createOrganization already made the admin membership
    const [m] = await db.insert(memberships).values({ organizationId: org.id, userId: ids[p.key], role: p.role as "facility_staff" | "transporter", vehicleReg: vehicles[p.key] ?? null }).returning();
    if (facilityOf[p.key]) await db.insert(membershipFacilities).values(facilityOf[p.key].map((facilityId) => ({ membershipId: m.id, facilityId })));
  }

  const memberRows = await db.select().from(memberships).where(eq(memberships.organizationId, org.id));
  const actor = (key: string): Actor => {
    const m = memberRows.find((x) => x.userId === ids[key])!;
    return { userId: ids[key], orgId: org.id, role: m.role, facilityIds: facilityOf[key] ?? [], membershipId: m.id };
  };
  const staffA = actor("staff"), staffB = actor("staffB"), plantStaff = actor("plant"), driver = actor("driver"), driver2 = actor("driver2");
  const cats = await db.select().from(wasteCategories).where(eq(wasteCategories.organizationId, org.id));
  const cat = (code: string) => cats.find((c) => c.code === code)!.id;

  /** Registers a batch the same way the API does, back-dated by `hoursAgo`. */
  async function batch(code: string, qty: number, containersN: number, area: string, by: Actor, hoursAgo: number) {
    const origin = by.facilityIds[0];
    const when = new Date(Date.now() - hoursAgo * 3600_000);
    const trackingCode = `BW-${when.toISOString().slice(2, 10).replaceAll("-", "")}-${humanCode(6)}`;
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
  const seg = (by: Actor, id: string) => performAction(by, id, "segregate", { confirmSegregation: true, notes: "Demo: bag colour checked" });
  /** A collection request raised earlier by hospital staff (back-dated job window). */
  const job = (batchIds: string[], by: Actor, d: Actor) =>
    createAssignment(by, { transporterUserId: d.userId, originFacilityId: by.facilityIds[0], destinationFacilityId: plant.id, batchIds, scheduledPickupAt: new Date(Date.now() - 3600_000), dueBy: new Date(Date.now() + 3 * 3600_000), vehicleReg: null, notes: "Collection request — demo (synthetic data)" }, { backfill: true });
  const noScan = { scanMethod: "manual", notes: "Demo seed: recorded without a physical scan" };
  async function deliver(b: { id: string }, by: Actor, d: Actor) {
    await seg(by, b.id);
    const a = await job([b.id], by, d);
    await assignmentAction(d, a.id, "accept");
    await performAction(d, b.id, "pickup", noScan);
    await assignmentAction(d, a.id, "start");
    await performAction(d, b.id, "handover", noScan);
  }

  // Completed journeys (history for reports)
  for (const [code, qty, area, by, d, h, method] of [
    ["YELLOW", 18.4, "Ward 3", staffA, driver, 50, "incineration"],
    ["RED", 9.2, "ICU", staffA, driver2, 30, "autoclave"],
    ["WHITE", 3.1, "OT-2", staffB, driver2, 28, "autoclave"],
  ] as const) {
    const b = await batch(code, qty, 1, area, by, h);
    await deliver(b, by, d);
    await performAction(plantStaff, b.id, "receive", { accepted: true, receivedQuantity: qty, unit: "kg", condition: "intact" });
    await performAction(plantStaff, b.id, "dispose", { method, treatedQuantity: qty, unit: "kg", documentRef: `DEMO-LOG-${humanCode(4)}` });
  }

  // Hospital A: on the road right now, with a SIMULATED position trail
  const moving1 = await batch("YELLOW", 22.5, 2, "Ward 1", staffA, 3);
  const moving2 = await batch("RED", 7.8, 1, "Dialysis unit", staffA, 3);
  await seg(staffA, moving1.id);
  await seg(staffA, moving2.id);
  const live = await job([moving1.id, moving2.id], staffA, driver);
  await assignmentAction(driver, live.id, "accept");
  await performAction(driver, moving1.id, "pickup", noScan);
  await performAction(driver, moving2.id, "pickup", noScan);
  await setTracking(driver, live.id, true);
  await assignmentAction(driver, live.id, "start");
  const pts = 12;
  const now = Date.now();
  for (let i = 0; i < pts; i++) {
    const t = (i / (pts - 1)) * 0.55;
    await db.insert(locationPoints).values({
      organizationId: org.id,
      assignmentId: live.id,
      transporterUserId: ids.driver,
      latitude: 12.9249 + (12.9716 - 12.9249) * t + Math.sin(i) * 0.0015,
      longitude: 80.1275 + (79.9864 - 80.1275) * t,
      accuracyM: 12 + (i % 4) * 3,
      recordedAt: new Date(now - (pts - 1 - i) * 30_000),
      source: "simulated",
    });
  }
  await db.update(assignments).set({ lastLocationAt: new Date(now) }).where(eq(assignments.id, live.id));

  // Hospital A: segregated and ready for "Request collection"; one just registered
  const ready = await batch("BLUE", 3.3, 1, "Pharmacy", staffA, 1);
  await seg(staffA, ready.id);
  await batch("YELLOW", 6.7, 2, "Maternity", staffA, 0.5);

  // Hospital B: delivered, waiting for the plant to confirm receipt
  await deliver(await batch("YELLOW", 12.0, 1, "Labour ward", staffB, 6), staffB, driver2);

  // Hospital B: received, waiting for treatment / disposal
  const received = await batch("RED", 11.2, 2, "NICU", staffB, 8);
  await deliver(received, staffB, driver2);
  await performAction(plantStaff, received.id, "receive", { accepted: true, receivedQuantity: 11.0, unit: "kg", condition: "intact" });

  // Hospital B: collection requested, waiting for the transporter (Ravi) to accept — the transporter demo starts here
  const waiting = await batch("WHITE", 2.4, 1, "Emergency", staffB, 4);
  await seg(staffB, waiting.id);
  await requestCollection(staffB, waiting.id, { notes: "Sharps box full — please collect today." }, { transporterUserId: driver.userId });

  // Hospital B: never collected → overdue-collection alert
  await batch("RED", 5.1, 1, "Ward 2", staffB, 30);

  // Two organizations waiting for platform review (synthetic applicants)
  const applicants = [
    { key: "applicant1", org: { name: DEMO_APPLICANT_ORGS[0], type: "clinic" as const }, reg: "DEMO-CLINIC-4471", phone: "+91 90000 00071", address: "4 Lake View Road, Velachery, Chennai (synthetic)", facility: { name: "Lakeview Clinic, Velachery (demo)", type: "generator" as const, canReceive: false, address: "4 Lake View Road, Velachery", city: "Chennai", contactName: "Arjun Pillai", contactPhone: "+91 90000 00071", authorizationRef: "DEMO-PCB-2291", latitude: 12.9815, longitude: 80.218 } },
    { key: "applicant2", org: { name: DEMO_APPLICANT_ORGS[1], type: "transport_operator" as const }, reg: "DEMO-TRN-8810", phone: "+91 90000 00072", address: "Port Access Road, Ennore, Chennai (synthetic)", facility: null },
  ];
  for (const a of applicants) {
    const { org: o } = await db.transaction((tx) => createOrganization(tx, { org: a.org, facility: a.facility, adminUserId: ids[a.key], contactEmail: demoPeople.find((p) => p.key === a.key)!.email }));
    await db.update(organizations).set({ registrationNumber: a.reg, contactPhone: a.phone, address: a.address }).where(eq(organizations.id, o.id));
  }

  const counts = await db.select({ status: wasteBatches.status }).from(wasteBatches).where(eq(wasteBatches.organizationId, org.id));
  log(`Demo organization created: ${DEMO_ORG_NAME}`);
  log(`  ${counts.length} synthetic batches across two hospitals and one treatment plant.`);
  log(`  ${DEMO_APPLICANT_ORGS.length} synthetic organizations are waiting for platform approval.`);
  log(`  Sign in with any of these (password: ${DEMO_PASSWORD}), or use the demo buttons on the home page:`);
  for (const p of demoPeople) log(`    ${p.email.padEnd(28)} ${p.role}`);
  return true;
}

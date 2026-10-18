/**
 * Demo seed — SYNTHETIC DATA ONLY.
 *
 * Creates one clearly-labelled demo organization with fictional people, facilities and
 * waste batches in every lifecycle state, by calling the same services the API uses
 * (so the custody history is consistent). Location points created here are stored with
 * source = "simulated" and are shown as simulated on the map.
 *
 *   npm run db:seed            # creates the demo org (skips if it already exists)
 *   npm run db:seed -- --reset # deletes the demo org first, then recreates it
 */
import { eq, inArray, like } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { db, pool } from "./client.js";
import { runMigrations } from "./migrate.js";
import { assignments, custodyEvents, facilities, locationPoints, membershipFacilities, memberships, organizations, users, wasteBatches, wasteCategories } from "./schema.js";
import { createOrganization } from "../services/orgs.js";
import { performAction } from "../services/lifecycle.js";
import { assignmentAction, createAssignment, setTracking } from "../services/assignments.js";
import type { Actor } from "../lib/http.js";
import { humanCode } from "../lib/crypto.js";
import { createQrIdentifier } from "../services/identification.js";
import { containers } from "./schema.js";

const ORG_NAME = "Sunrise Health Network (DEMO — synthetic data)";
export const DEMO_PASSWORD = "Demo-pass-2026";
const people = [
  { key: "admin", email: "admin@demo.bwts.local", fullName: "Anita Raman (demo admin)", role: "admin" as const },
  { key: "staff", email: "staff@demo.bwts.local", fullName: "Karthik Selvam (demo ward staff)", role: "facility_staff" as const },
  { key: "plant", email: "plant@demo.bwts.local", fullName: "Meena Iyer (demo plant staff)", role: "facility_staff" as const },
  { key: "driver", email: "driver@demo.bwts.local", fullName: "Ravi Kumar (demo transporter)", role: "transporter" as const },
  { key: "driver2", email: "driver2@demo.bwts.local", fullName: "Suresh Babu (demo transporter)", role: "transporter" as const },
];

async function main() {
  await runMigrations();
  const reset = process.argv.includes("--reset");
  const [existing] = await db.select().from(organizations).where(eq(organizations.name, ORG_NAME));
  if (existing && !reset) {
    console.log("Demo organization already exists. Use `npm run db:seed -- --reset` to recreate it.");
    return;
  }
  if (existing) {
    await db.delete(organizations).where(eq(organizations.id, existing.id));
    await db.delete(users).where(like(users.email, "%@demo.bwts.local"));
    console.log("Removed previous demo organization.");
  }

  const passwordHash = await hash(DEMO_PASSWORD);
  const ids: Record<string, string> = {};
  for (const p of people) {
    const [u] = await db.insert(users).values({ email: p.email, fullName: p.fullName, passwordHash, phone: "+91 90000 0000" + people.indexOf(p) }).returning();
    ids[p.key] = u.id;
  }

  const { org, facility: hospital } = await db.transaction((tx) =>
    createOrganization(tx, {
      org: { name: ORG_NAME, type: "health_network" },
      adminUserId: ids.admin,
      contactEmail: "admin@demo.bwts.local",
      facility: { name: "Sunrise General Hospital (demo)", type: "generator", canReceive: false, address: "GST Road, Tambaram", city: "Chennai", contactName: "Karthik Selvam", contactPhone: "+91 90000 00001", authorizationRef: "DEMO-AUTH-001", latitude: 12.9249, longitude: 80.1275 },
    }),
  );
  const [clinic] = await db.insert(facilities).values({ organizationId: org.id, name: "Sunrise Clinic Chromepet (demo)", type: "generator", address: "Radha Nagar, Chromepet", city: "Chennai", latitude: 12.9516, longitude: 80.1462 }).returning();
  const [plant] = await db.insert(facilities).values({ organizationId: org.id, name: "GreenCycle CBWTF (demo)", type: "treatment", canReceive: true, address: "SIPCOT Industrial Estate, Irungattukottai", city: "Chennai", contactName: "Meena Iyer", contactPhone: "+91 90000 00002", authorizationRef: "DEMO-CBWTF-77", latitude: 12.9716, longitude: 79.9864 }).returning();

  const mem = async (key: string, role: "admin" | "facility_staff" | "transporter", facs: string[] = [], vehicleReg: string | null = null) => {
    if (key === "admin") return;
    const [m] = await db.insert(memberships).values({ organizationId: org.id, userId: ids[key], role, vehicleReg }).returning();
    if (facs.length) await db.insert(membershipFacilities).values(facs.map((facilityId) => ({ membershipId: m.id, facilityId })));
  };
  await mem("staff", "facility_staff", [hospital!.id, clinic.id]);
  await mem("plant", "facility_staff", [plant.id]);
  await mem("driver", "transporter", [], "TN 22 DEMO 101");
  await mem("driver2", "transporter", [], "TN 22 DEMO 202");

  const memberIds = await db.select().from(memberships).where(eq(memberships.organizationId, org.id));
  const actor = (key: string): Actor => {
    const m = memberIds.find((x) => x.userId === ids[key])!;
    const facilityIds = key === "staff" ? [hospital!.id, clinic.id] : key === "plant" ? [plant.id] : [];
    return { userId: ids[key], orgId: org.id, role: m.role, facilityIds, membershipId: m.id };
  };
  const admin = actor("admin"), staff = actor("staff"), plantStaff = actor("plant"), driver = actor("driver"), driver2 = actor("driver2");
  const cats = await db.select().from(wasteCategories).where(eq(wasteCategories.organizationId, org.id));
  const cat = (code: string) => cats.find((c) => c.code === code)!.id;

  /** Creates a batch the same way the API does, back-dated by `hoursAgo`. */
  async function batch(code: string, qty: number, containersN: number, area: string, origin = hospital!.id, hoursAgo = 2) {
    const when = new Date(Date.now() - hoursAgo * 3600_000);
    const trackingCode = `BW-${when.toISOString().slice(2, 10).replaceAll("-", "")}-${humanCode(6)}`;
    const [b] = await db
      .insert(wasteBatches)
      .values({ organizationId: org.id, trackingCode, originFacilityId: origin, categoryId: cat(code), quantity: qty, unit: "kg", containerCount: containersN, containerType: code === "WHITE" ? "Sharps container" : `${code.toLowerCase()} bag`, sourceArea: area, responsibleUserId: ids.staff, currentCustodianFacilityId: origin, generatedAt: when, createdAt: when, statusChangedAt: when, collectionDueAt: new Date(when.getTime() + 24 * 3600_000) })
      .returning();
    for (let i = 1; i <= containersN; i++) {
      const [c] = await db.insert(containers).values({ organizationId: org.id, batchId: b.id, label: `${trackingCode}-C${i}`, sequence: i }).returning();
      await createQrIdentifier(db, org.id, c.id, ids.staff);
    }
    await db.insert(custodyEvents).values({ organizationId: org.id, batchId: b.id, eventType: "created", toStatus: "generated", actorUserId: ids.staff, actorRole: "facility_staff", facilityId: origin, toCustodianFacilityId: origin, details: { synthetic: true }, createdAt: when });
    return b;
  }
  const seg = (id: string) => performAction(staff, id, "segregate", { confirmSegregation: true, notes: "Demo: checked bag colour" });
  const job = (batchIds: string[], d: Actor, origin = hospital!.id) =>
    createAssignment(admin, { transporterUserId: d.userId, originFacilityId: origin, destinationFacilityId: plant.id, batchIds, scheduledPickupAt: new Date(Date.now() - 3600_000), dueBy: new Date(Date.now() + 3 * 3600_000), vehicleReg: null, notes: "Demo job — synthetic data" });

  // 1. Fully disposed batches (history for reports)
  for (const [code, qty, area, h] of [["YELLOW", 18.4, "Ward 3", 50], ["RED", 9.2, "ICU", 49], ["WHITE", 3.1, "OT-2", 30], ["BLUE", 4.6, "Pathology lab", 28]] as const) {
    const b = await batch(code, qty, 2, area, hospital!.id, h);
    await seg(b.id);
    const a = await job([b.id], driver);
    await assignmentAction(driver, a.id, "accept");
    await performAction(driver, b.id, "pickup", { scanMethod: "manual", notes: "Demo seed (no physical scan)" });
    await assignmentAction(driver, a.id, "start");
    await performAction(driver, b.id, "handover", { scanMethod: "manual", notes: "Demo seed (no physical scan)" });
    await performAction(plantStaff, b.id, "receive", { accepted: true, receivedQuantity: qty, unit: "kg", condition: "intact" });
    const method = { YELLOW: "incineration", RED: "autoclave", WHITE: "autoclave", BLUE: "autoclave" }[code];
    await performAction(plantStaff, b.id, "dispose", { method, treatedQuantity: qty, unit: "kg", documentRef: `DEMO-LOG-${humanCode(4)}` });
  }

  // 2. Awaiting receipt (delivered)
  const delivered = await batch("YELLOW", 12.0, 1, "Ward 5", hospital!.id, 6);
  await seg(delivered.id);
  const ja = await job([delivered.id], driver2);
  await assignmentAction(driver2, ja.id, "accept");
  await performAction(driver2, delivered.id, "pickup", { scanMethod: "manual", notes: "Demo seed" });
  await assignmentAction(driver2, ja.id, "start");
  await performAction(driver2, delivered.id, "handover", { scanMethod: "manual", notes: "Demo seed" });

  // 3. On the road right now, with a SIMULATED position trail
  const moving1 = await batch("YELLOW", 22.5, 3, "Ward 1", hospital!.id, 3);
  const moving2 = await batch("RED", 7.8, 1, "Dialysis unit", hospital!.id, 3);
  await seg(moving1.id);
  await seg(moving2.id);
  const live = await job([moving1.id, moving2.id], driver);
  await assignmentAction(driver, live.id, "accept");
  await performAction(driver, moving1.id, "pickup", { scanMethod: "manual", notes: "Demo seed" });
  await performAction(driver, moving2.id, "pickup", { scanMethod: "manual", notes: "Demo seed" });
  await setTracking(driver, live.id, true);
  await assignmentAction(driver, live.id, "start");
  const pts = 12;
  const now = Date.now();
  for (let i = 0; i < pts; i++) {
    const t = i / (pts - 1) * 0.55;
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

  // 4. Assigned, waiting for the transporter to accept
  const waiting = await batch("WHITE", 2.4, 1, "Emergency", clinic.id, 4);
  await seg(waiting.id);
  await job([waiting.id], driver2, clinic.id);

  // 5. Waiting at the facility: one segregated, one just generated, one overdue
  const ready = await batch("BLUE", 3.3, 1, "Pharmacy", hospital!.id, 1);
  await seg(ready.id);
  await batch("YELLOW", 6.7, 2, "Maternity", hospital!.id, 0.5);
  await batch("RED", 5.1, 1, "Ward 2", clinic.id, 30); // older than the 24 h default threshold → overdue alert

  // 6. Received, awaiting disposal
  const received = await batch("RED", 11.2, 2, "Ward 4", hospital!.id, 8);
  await seg(received.id);
  const jr = await job([received.id], driver2);
  await assignmentAction(driver2, jr.id, "accept");
  await performAction(driver2, received.id, "pickup", { scanMethod: "manual", notes: "Demo seed" });
  await assignmentAction(driver2, jr.id, "start");
  await performAction(driver2, received.id, "handover", { scanMethod: "manual", notes: "Demo seed" });
  await performAction(plantStaff, received.id, "receive", { accepted: true, receivedQuantity: 11.0, unit: "kg", condition: "intact" });

  const counts = await db.select({ status: wasteBatches.status }).from(wasteBatches).where(inArray(wasteBatches.organizationId, [org.id]));
  console.log(`\nDemo organization created: ${ORG_NAME}`);
  console.log(`  ${counts.length} synthetic batches across every lifecycle stage.`);
  console.log(`  Sign in with any of these (password: ${DEMO_PASSWORD}):`);
  for (const p of people) console.log(`    ${p.email.padEnd(26)} ${p.role}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

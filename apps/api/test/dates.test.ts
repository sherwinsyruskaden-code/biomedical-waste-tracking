import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client.js";
import { wasteBatches } from "../src/db/schema.js";
import { assertDisposalTime, assertDueTime, assertPickupTime, assertRerouteDue, resolveRange, todayIn, tzOffsetMs, zonedTimeToUtc } from "../src/lib/dates.js";
import { addMember, signupOrg, type Client } from "./helpers.js";

const IST = "Asia/Kolkata";
const NOW = Date.UTC(2026, 9, 18, 12, 0, 0); // fixed "now" for the unit tests: 18 Oct 2026, 12:00 UTC
const H = 3600_000;
const DAY = 24 * H;
const fieldOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { details?: { fields?: Record<string, string> } }).details?.fields ?? { _: String(e) };
  }
  return null;
};

describe("timezone arithmetic", () => {
  it("knows offsets and wall-clock midnights", () => {
    expect(tzOffsetMs(NOW, IST)).toBe(5.5 * H);
    expect(new Date(zonedTimeToUtc(2026, 1, 11, 0, 0, IST)).toISOString()).toBe("2026-01-10T18:30:00.000Z");
    expect(todayIn(IST, Date.UTC(2026, 0, 10, 18, 45))).toBe("2026-01-11"); // 00:15 IST is already the 11th
    expect(todayIn("UTC", Date.UTC(2026, 0, 10, 18, 45))).toBe("2026-01-10");
  });
  it("handles daylight-saving changes (New York, 8 Mar 2026 is 23 h long)", () => {
    const start = zonedTimeToUtc(2026, 3, 8, 0, 0, "America/New_York"); // still EST (UTC-5)
    const next = zonedTimeToUtc(2026, 3, 9, 0, 0, "America/New_York"); // now EDT (UTC-4)
    expect(new Date(start).toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(new Date(next).toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect((next - start) / H).toBe(23);
  });
});

describe("report / search ranges", () => {
  const ok = (from?: string, to?: string, tz = IST) => resolveRange({ from, to }, tz, NOW);
  it("accepts valid and past days and treats them as days in the org timezone", () => {
    const r = ok("2026-10-01", "2026-10-18");
    expect(r.from!.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(r.to!.toISOString()).toBe("2026-10-18T18:29:59.999Z"); // inclusive end of 18 Oct IST
    expect(ok("2000-01-01", "2000-01-01").from).toBeDefined(); // legitimate old date
    expect(ok(undefined, undefined)).toEqual({ from: undefined, to: undefined });
  });
  it("allows today but rejects tomorrow, using the org's own 'today'", () => {
    expect(ok("2026-10-18", "2026-10-18").to).toBeDefined();
    expect(fieldOf(() => ok(undefined, "2026-10-19"))?.to).toMatch(/future/);
    // 19:00 UTC on 18 Oct is already 19 Oct in Kolkata but still 18 Oct in New York
    const lateNow = Date.UTC(2026, 9, 18, 19, 0);
    expect(resolveRange({ to: "2026-10-19" }, IST, lateNow).to).toBeDefined();
    expect(fieldOf(() => resolveRange({ to: "2026-10-19" }, "America/New_York", lateNow))?.to).toMatch(/future/);
  });
  it("rejects year 3000, years before 2000, impossible dates and reversed ranges", () => {
    expect(fieldOf(() => ok("3000-01-01"))?.from).toMatch(/future/);
    expect(fieldOf(() => ok(undefined, "3000-12-31"))?.to).toMatch(/future/);
    expect(fieldOf(() => ok("1999-12-31"))?.from).toMatch(/before 2000/);
    expect(fieldOf(() => ok("2026-02-30"))?.from).toMatch(/date like/);
    expect(fieldOf(() => ok("tomorrow"))?.from).toMatch(/date like/);
    expect(fieldOf(() => ok("2026-10-10", "2026-10-09"))?.from).toMatch(/on or before/);
    expect(fieldOf(() => ok("275760-09-13"))?.from).toBeTruthy();
  });
  it("accepts a full ISO timestamp in the past, rejects one in the future", () => {
    expect(ok("2026-10-01T00:00:00Z").from!.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(fieldOf(() => ok("3000-01-01T00:00:00Z"))?.from).toMatch(/future/);
  });
});

describe("scheduling rules", () => {
  it("pickup: from now (small grace) up to 90 days ahead", () => {
    expect(fieldOf(() => assertPickupTime(new Date(NOW + H), IST, NOW))).toBeNull();
    expect(fieldOf(() => assertPickupTime(new Date(NOW - 5 * 60_000), IST, NOW))).toBeNull(); // form-filling grace
    expect(fieldOf(() => assertPickupTime(new Date(NOW - DAY), IST, NOW))?.scheduledPickupAt).toMatch(/between/);
    expect(fieldOf(() => assertPickupTime(new Date(NOW + 91 * DAY), IST, NOW))?.scheduledPickupAt).toMatch(/between/);
    expect(fieldOf(() => assertPickupTime(new Date("3000-01-01T00:00:00Z"), IST, NOW))?.scheduledPickupAt).toMatch(/between/);
    expect(fieldOf(() => assertPickupTime(new Date("not a date"), IST, NOW))?.scheduledPickupAt).toMatch(/valid/);
  });
  it("due time: after pickup, within 30 days of it", () => {
    const pickup = new Date(NOW + H);
    expect(fieldOf(() => assertDueTime(new Date(NOW + 5 * H), pickup, IST, NOW))).toBeNull();
    expect(fieldOf(() => assertDueTime(pickup, pickup, IST, NOW))?.dueBy).toMatch(/after the scheduled pickup/);
    expect(fieldOf(() => assertDueTime(new Date(NOW), pickup, IST, NOW))?.dueBy).toMatch(/after the scheduled pickup/);
    expect(fieldOf(() => assertDueTime(new Date(pickup.getTime() + 31 * DAY), pickup, IST, NOW))?.dueBy).toMatch(/between/);
    expect(fieldOf(() => assertDueTime(new Date("3000-01-01T00:00:00Z"), pickup, IST, NOW))?.dueBy).toMatch(/between/);
  });
  it("re-route due time: in the future, within 30 days", () => {
    expect(fieldOf(() => assertRerouteDue(new Date(NOW + 6 * H), IST, NOW))).toBeNull();
    expect(fieldOf(() => assertRerouteDue(new Date(NOW - H), IST, NOW))?.dueBy).toMatch(/future/);
    expect(fieldOf(() => assertRerouteDue(new Date("3000-01-01T00:00:00Z"), IST, NOW))?.dueBy).toMatch(/between/);
  });
  it("disposal time: may be back-dated to after receipt, never in the future", () => {
    const received = new Date(NOW - 3 * H);
    expect(fieldOf(() => assertDisposalTime(new Date(NOW - H), received, IST, NOW))).toBeNull();
    expect(fieldOf(() => assertDisposalTime(new Date(NOW + 2 * 60_000), received, IST, NOW))).toBeNull(); // clock skew
    expect(fieldOf(() => assertDisposalTime(new Date(NOW + DAY), received, IST, NOW))?.disposedAt).toMatch(/future/);
    expect(fieldOf(() => assertDisposalTime(new Date("3000-01-01T00:00:00Z"), received, IST, NOW))?.disposedAt).toMatch(/future/);
    expect(fieldOf(() => assertDisposalTime(new Date(NOW - 4 * H), received, IST, NOW))?.disposedAt).toMatch(/before the batch was received/);
    expect(fieldOf(() => assertDisposalTime(new Date("1999-01-01T00:00:00Z"), null, IST, NOW))?.disposedAt).toMatch(/before 2000/);
  });
});

describe("dates through the API", () => {
  let admin: Client, staff: Client, hospitalId: string, plantId: string, driverId: string, yellowId: string;
  let batchId: string;
  const today = () => todayIn(IST); // a new organization defaults to Asia/Kolkata
  const dayOffset = (n: number) => new Date(Date.parse(today() + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);

  beforeAll(async () => {
    const org = await signupOrg("Dates Hospital");
    admin = org.admin;
    hospitalId = org.hospitalId;
    plantId = org.plantId;
    yellowId = org.categories.find((c) => c.code === "YELLOW")!.id;
    staff = (await addMember(admin, "facility_staff", [hospitalId])).c;
    driverId = (await addMember(admin, "transporter")).userId;
    const b = await staff.post("/api/batches", { originFacilityId: hospitalId, categoryId: yellowId, quantity: 5, unit: "kg", containerCount: 1, containerType: "Yellow bag", sourceArea: "Ward 1" });
    batchId = b.body.id;
    await staff.post(`/api/batches/${batchId}/actions/segregate`, { confirmSegregation: true });
  });

  it("batch search rejects year 3000, pre-2000, future and reversed ranges with a field error", async () => {
    for (const [qs, field] of [
      ["from=3000-01-01", "from"],
      ["to=3000-01-01", "to"],
      ["from=1999-01-01", "from"],
      [`to=${dayOffset(1)}`, "to"],
      ["from=2026-02-30", "from"],
      [`from=${dayOffset(0)}&to=${dayOffset(-1)}`, "from"],
    ] as const) {
      const r = await admin.get(`/api/batches?${qs}`);
      expect(r.status, qs).toBe(400);
      expect(r.body.error.details.fields[field], qs).toBeTruthy();
    }
  });

  it("batch search uses whole calendar days in the organization's timezone", async () => {
    // 10 Jan 2026 18:45 UTC is 11 Jan 00:15 in Kolkata.
    await db.update(wasteBatches).set({ createdAt: new Date("2026-01-10T18:45:00Z") }).where(eq(wasteBatches.id, batchId));
    const ids = async (qs: string) => ((await admin.get(`/api/batches?${qs}`)).body.items as { id: string }[]).map((x) => x.id);
    expect(await ids("from=2026-01-11&to=2026-01-11")).toContain(batchId);
    expect(await ids("from=2026-01-10&to=2026-01-10")).not.toContain(batchId); // UTC-based filtering would wrongly include it
    // The very last second of the day belongs to that day; one second later does not.
    await db.update(wasteBatches).set({ createdAt: new Date("2026-01-11T18:29:59Z") }).where(eq(wasteBatches.id, batchId));
    expect(await ids("from=2026-01-11&to=2026-01-11")).toContain(batchId);
    await db.update(wasteBatches).set({ createdAt: new Date("2026-01-11T18:30:01Z") }).where(eq(wasteBatches.id, batchId));
    expect(await ids("from=2026-01-11&to=2026-01-11")).not.toContain(batchId);
    expect(await ids("from=2026-01-12&to=2026-01-12")).toContain(batchId);
    // A batch created right now is found by "today".
    await db.update(wasteBatches).set({ createdAt: new Date() }).where(eq(wasteBatches.id, batchId));
    expect(await ids(`from=${today()}&to=${today()}`)).toContain(batchId);
  });

  it("reports (JSON, CSV, PDF) reject invalid ranges and accept valid ones", async () => {
    for (const format of ["json", "csv", "pdf"]) {
      const bad = await admin.get(`/api/reports?type=batches&format=${format}&from=3000-01-01`);
      expect(bad.status, format).toBe(400);
      expect(bad.body.error.details.fields.from).toBeTruthy();
      expect((await admin.get(`/api/reports?type=batches&format=${format}&to=1999-01-01`)).status).toBe(400);
    }
    const ok = await admin.get(`/api/reports?type=batches&from=${dayOffset(-30)}&to=${today()}`);
    expect(ok.status).toBe(200);
    expect(ok.body.rowCount).toBeGreaterThan(0);
    expect((await admin.get(`/api/reports?type=batches&format=csv&from=${dayOffset(-30)}&to=${today()}`)).status).toBe(200);
    expect((await admin.get(`/api/reports?type=batches&format=pdf&from=${dayOffset(-30)}&to=${today()}`)).status).toBe(200);
  });

  const job = (over: object) => {
    const pickup = new Date(Date.now() + 2 * H);
    return admin.post("/api/assignments", { transporterUserId: driverId, originFacilityId: hospitalId, destinationFacilityId: plantId, batchIds: [batchId], scheduledPickupAt: pickup.toISOString(), dueBy: new Date(pickup.getTime() + 6 * H).toISOString(), ...over });
  };
  it("a job cannot be scheduled in the year 3000, in the past, or too far ahead", async () => {
    const bad: [object, string][] = [
      [{ scheduledPickupAt: "3000-01-01T09:00:00Z", dueBy: "3000-01-01T15:00:00Z" }, "scheduledPickupAt"],
      [{ scheduledPickupAt: new Date(Date.now() - 2 * DAY).toISOString(), dueBy: new Date(Date.now() + H).toISOString() }, "scheduledPickupAt"],
      [{ scheduledPickupAt: new Date(Date.now() + 120 * DAY).toISOString(), dueBy: new Date(Date.now() + 121 * DAY).toISOString() }, "scheduledPickupAt"],
      [{ dueBy: "3000-01-01T00:00:00Z" }, "dueBy"],
      [{ dueBy: new Date(Date.now() + 40 * DAY).toISOString() }, "dueBy"],
      [{ dueBy: new Date(Date.now() + H).toISOString() }, "dueBy"], // before the pickup
    ];
    for (const [over, field] of bad) {
      const r = await job(over);
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect(r.body.error.details.fields[field], JSON.stringify(over)).toBeTruthy();
    }
    expect((await job({ scheduledPickupAt: "not-a-date" })).status).toBe(400);
  });
  it("a valid job (near future, due a few hours later) is accepted; its due time can be moved but not into year 3000", async () => {
    const r = await job({});
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const good = await admin.patch(`/api/assignments/${r.body.id}`, { dueBy: new Date(Date.now() + 10 * H).toISOString() });
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    const bad = await admin.patch(`/api/assignments/${r.body.id}`, { dueBy: "3000-01-01T00:00:00Z" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields.dueBy).toBeTruthy();
  });

  it("a GPS fix stamped in the year 3000 is rejected", async () => {
    const driver = (await addMember(admin, "transporter"));
    const b = await staff.post("/api/batches", { originFacilityId: hospitalId, categoryId: yellowId, quantity: 2, unit: "kg", containerCount: 1, containerType: "Yellow bag", sourceArea: "Ward 2" });
    await staff.post(`/api/batches/${b.body.id}/actions/segregate`, { confirmSegregation: true });
    const pickup = new Date(Date.now() + 60_000);
    const a = await admin.post("/api/assignments", { transporterUserId: driver.userId, originFacilityId: hospitalId, destinationFacilityId: plantId, batchIds: [b.body.id], scheduledPickupAt: pickup.toISOString(), dueBy: new Date(pickup.getTime() + 4 * H).toISOString() });
    await driver.c.post(`/api/assignments/${a.body.id}/accept`);
    await driver.c.put(`/api/assignments/${a.body.id}/tracking`, { active: true });
    const far = await driver.c.post(`/api/assignments/${a.body.id}/locations`, { points: [{ latitude: 12.9, longitude: 80.1, recordedAt: "3000-01-01T00:00:00Z" }] });
    expect(far.status).toBe(400);
    const old = await driver.c.post(`/api/assignments/${a.body.id}/locations`, { points: [{ latitude: 12.9, longitude: 80.1, recordedAt: "2001-01-01T00:00:00Z" }] });
    expect(old.status).toBe(400);
  });
});

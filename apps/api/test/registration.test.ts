import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { facilities, organizations, users } from "../src/db/schema.js";
import { addMember, client, PASSWORD, platformAdmin, registrationFacility, signupOrg, uniq } from "./helpers.js";

const body = (over: Record<string, unknown> = {}, facility: Record<string, unknown> = {}) => ({
  fullName: "Ritu Reviewable",
  email: `ritu-${uniq()}@clinic.example.org`,
  password: PASSWORD,
  confirmPassword: PASSWORD,
  organization: { name: `Reg Org ${uniq()}`, type: "hospital" },
  facility: registrationFacility(facility),
  acceptTerms: true,
  ...over,
});

describe("organization registration: facility type and Facility Registration ID", () => {
  it("accepts only Hospital and Lab as the facility type", async () => {
    for (const kind of ["hospital", "lab"]) expect((await client().post("/api/auth/signup", body({}, { kind }))).status, kind).toBe(201);
    for (const kind of ["treatment", "generator", "storage", "clinic", "laboratory", "Hospital", "", null]) {
      const r = await client().post("/api/auth/signup", body({}, { kind }));
      expect(r.status, String(kind)).toBe(400);
      expect(r.body.error.details.fields["facility.kind"], String(kind)).toBeTruthy();
    }
  });

  it("requires a valid Facility Registration ID, and stores it exactly as entered", async () => {
    for (const bad of [undefined, "", "  ", "ab", "x".repeat(41), "REG<1>", "-LEADING", "TRAILING-", "REG;DROP"]) {
      const r = await client().post("/api/auth/signup", body({}, { registrationId: bad }));
      expect(r.status, String(bad)).toBe(400);
      expect(r.body.error.details.fields["facility.registrationId"], String(bad)).toBeTruthy();
    }
    const c = client();
    const email = `store-${uniq()}@clinic.example.org`;
    const r = await c.post("/api/auth/signup", body({ email }, { registrationId: "  TN/HCF-2291.A  " }));
    expect(r.status).toBe(201);
    const [f] = await db.select().from(facilities).where(eq(facilities.id, r.body.facilityId));
    expect(f.registrationId).toBe("TN/HCF-2291.A"); // trimmed, otherwise untouched
    expect(f.kind).toBe("hospital");
    expect(f.type).toBe("generator"); // internal type is fixed; a client cannot pick treatment
    expect(f.canReceive).toBe(false);
    expect([f.city, f.state, f.postalCode]).toEqual(["Chennai", "Tamil Nadu", "600045"]);
  });

  it("requires a full address (street, city, state, postal code) and a facility name; phone is optional but validated", async () => {
    for (const [k, v] of [["address", "x"], ["city", ""], ["state", ""], ["postalCode", "!!"], ["name", "A"], ["contactPhone", "abc"]] as const) {
      const r = await client().post("/api/auth/signup", body({}, { [k]: v }));
      expect(r.status, k).toBe(400);
    }
    expect((await client().post("/api/auth/signup", body({}, { contactPhone: null }))).status).toBe(201);
    const noFacility = await client().post("/api/auth/signup", { ...body(), facility: undefined });
    expect(noFacility.status).toBe(400);
  });

  it("the same rules apply to creating an additional organization", async () => {
    const { admin } = await signupOrg("Second Org Maker");
    const base = { organization: { name: `Extra ${uniq()}`, type: "clinic" } };
    expect((await admin.post("/api/auth/create-organization", { ...base, facility: registrationFacility({ kind: "treatment" }) })).status).toBe(400);
    expect((await admin.post("/api/auth/create-organization", { ...base, facility: registrationFacility({ registrationId: "" }) })).status).toBe(400);
    expect((await admin.post("/api/auth/create-organization", { ...base, facility: registrationFacility({ kind: "lab" }) })).status).toBe(201);
  });

  it("registration needs no invitations: the organization is submitted, approved, and usable with no transporter or staff", async () => {
    const c = client();
    const r = await c.post("/api/auth/signup", body());
    expect(r.status).toBe(201);
    expect((await c.get("/api/facilities")).status).toBe(403); // pending: blocked until approved
    const p = await platformAdmin();
    expect((await p.post(`/api/platform/organizations/${r.body.organizationId}/approve`, {})).status).toBe(200);
    expect((await c.get("/api/facilities")).status).toBe(200);
    expect((await c.get("/api/members")).body).toHaveLength(1); // just the administrator; nobody was attached
    // Usable without any transporter: registering and segregating work, and the request says clearly what is missing.
    const plant = await c.post("/api/facilities", { name: "Own Plant", type: "treatment", canReceive: true, address: "Plot 1, Industrial Estate", city: "Chennai" });
    expect(plant.status).toBe(201);
    const cats = (await c.get("/api/categories")).body as { id: string }[];
    const batch = await c.post("/api/batches", { categoryId: cats[0].id, quantity: 4, unit: "kg" });
    expect(batch.status).toBe(201);
    await c.post(`/api/batches/${batch.body.id}/actions/segregate`, { confirmSegregation: true });
    expect((await c.get(`/api/batches/${batch.body.id}/transporters`)).body).toMatchObject({ items: [], total: 0 });
    const ask = await c.post(`/api/batches/${batch.body.id}/request-collection`, {});
    expect(ask.status).toBe(400);
    expect(ask.body.error.message).toMatch(/No active transporter is available/);
  });

  it("a new organization never gets another organization's people or transporters", async () => {
    const a = await signupOrg("Has Drivers");
    const driver = await addMember(a.admin, "transporter");
    const c = client();
    const r = await c.post("/api/auth/signup", body());
    await (await platformAdmin()).post(`/api/platform/organizations/${r.body.organizationId}/approve`, {});
    expect((await c.get("/api/members")).body.map((m: { userId: string }) => m.userId)).not.toContain(driver.userId);
    expect((await c.get("/api/transporters/available")).body).toMatchObject({ items: [], total: 0 });
  });
});

describe("approval panel shows what was actually submitted", () => {
  it("lists organization, administrator, facility kind/name/ID, full address, phone and dates exactly as stored", async () => {
    const c = client();
    const email = `Admin.Name+tag-${uniq()}@gmail.com`; // the full address is shown as typed (lower-cased by sign-up), never shortened
    const payload = body({ fullName: "Dr. Meera Krishnan", email }, { name: "Krishna Lab Services", kind: "lab", registrationId: "LAB/2291-X", address: "7 Gandhi Road, T. Nagar", city: "Chennai", state: "Tamil Nadu", postalCode: "600017", contactPhone: "+91 98765 43210" });
    const r = await c.post("/api/auth/signup", payload);
    expect(r.status).toBe(201);
    const p = await platformAdmin();
    const item = (await p.get("/api/platform/organizations?status=pending")).body.items.find((o: { id: string }) => o.id === r.body.organizationId);
    expect(item.name).toBe(payload.organization.name);
    expect(item.status).toBe("pending");
    expect(item.submittedAt).toBeTruthy();
    expect(item.applicant).toMatchObject({ fullName: "Dr. Meera Krishnan", email: email.toLowerCase() });
    expect(item.applicant.email).toContain("@gmail.com");
    expect(item.facilities).toHaveLength(1);
    expect(item.facilities[0]).toMatchObject({ name: "Krishna Lab Services", kind: "lab", registrationId: "LAB/2291-X", address: "7 Gandhi Road, T. Nagar", city: "Chennai", state: "Tamil Nadu", postalCode: "600017", contactPhone: "+91 98765 43210" });
    expect(item.address).toBe("7 Gandhi Road, T. Nagar, Chennai, Tamil Nadu, 600017");
    expect(item.contactPhone).toBe("+91 98765 43210");
  });

  it("the queue is searchable by Facility Registration ID, facility, organization, administrator and email", async () => {
    const c = client();
    const tag = uniq().toUpperCase();
    const r = await c.post("/api/auth/signup", body({ fullName: `Searchable Person ${tag}`, email: `find-${tag.toLowerCase()}@school.example.edu` }, { registrationId: `FIND-${tag}`, name: `Findable Facility ${tag}` }));
    expect(r.status).toBe(201);
    const p = await platformAdmin();
    const find = async (q: string) => ((await p.get(`/api/platform/organizations?status=pending&q=${encodeURIComponent(q)}`)).body.items as { id: string }[]).map((o) => o.id);
    for (const q of [`FIND-${tag}`, `find-${tag}`.toLowerCase(), `Findable Facility ${tag}`, `Searchable Person ${tag}`, `find-${tag.toLowerCase()}@school.example.edu`]) expect(await find(q), q).toContain(r.body.organizationId);
    expect(await find(`NOT-A-REAL-ID-${tag}`)).toEqual([]);
    expect((await find("%")).length).toBeLessThan(1000); // wildcards are escaped, not interpreted
    expect(await find(`%${tag}%`)).toEqual([]); // a literal percent sign matches nothing
    const noPermission = await client().get("/api/platform/organizations?q=x");
    expect(noPermission.status).toBe(401);
  });

  it("older organizations without a registration ID or kind still appear and nothing breaks", async () => {
    const [org] = await db.insert(organizations).values({ name: `Legacy Org ${uniq()}`, type: "hospital", status: "pending" }).returning();
    const [u] = await db.insert(users).values({ email: `legacy-${uniq()}@x.test`, fullName: "Old Admin", passwordHash: "x" }).returning();
    await db.update(organizations).set({ applicantUserId: u.id }).where(eq(organizations.id, org.id));
    await db.insert(facilities).values({ organizationId: org.id, name: "Old Hospital", type: "generator", address: "Old Road 1" });
    const item = (await (await platformAdmin()).get("/api/platform/organizations?status=pending&q=Legacy Org")).body.items.find((o: { id: string }) => o.id === org.id);
    expect(item.facilities[0]).toMatchObject({ name: "Old Hospital", kind: null, registrationId: null, state: null, postalCode: null });
    expect(item.applicant.fullName).toBe("Old Admin");
  });

  it("the review permission and self-approval rules still hold", async () => {
    const { admin, orgId } = await signupOrg("Not A Reviewer", { approve: false });
    expect((await admin.get("/api/platform/organizations")).status).toBe(403);
    expect((await admin.post(`/api/platform/organizations/${orgId}/approve`, {})).status).toBe(403);
    const p = await platformAdmin();
    const own = await p.post("/api/auth/create-organization", { organization: { name: `Reviewer Own ${uniq()}`, type: "clinic" }, facility: registrationFacility() });
    expect((await p.post(`/api/platform/organizations/${own.body.organizationId}/approve`, {})).status).toBe(403);
  });
});

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { auditLogs, organizations, users } from "../src/db/schema.js";
import { client, platformAdmin, registrationFacility, signupOrg, uniq } from "./helpers.js";

describe("organization registration and platform approval", () => {
  it("a new organization starts pending and cannot use operational features", async () => {
    const { admin, orgId } = await signupOrg("Pending Clinic", { approve: false });
    const me = (await admin.get("/api/auth/me")).body;
    expect(me.organization.status).toBe("pending");
    expect(me.membership.role).toBe("admin");
    for (const url of ["/api/batches", "/api/facilities", "/api/dashboard", "/api/members"]) {
      const r = await admin.get(url);
      expect(r.status, url).toBe(403);
      expect(r.body.error.code).toBe("organization_pending");
    }
    const create = await admin.post("/api/facilities", { name: "Sneaky Plant", type: "treatment", canReceive: true, address: "1 Somewhere Road" });
    expect(create.status).toBe(403);
    const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    expect(row.status).toBe("pending");
    expect(row.reviewedAt).toBeNull();
  });

  it("only platform administrators can see the review queue or decide", async () => {
    const { admin, orgId } = await signupOrg("Self Approver", { approve: false });
    expect((await admin.get("/api/platform/organizations")).status).toBe(403);
    expect((await admin.post(`/api/platform/organizations/${orgId}/approve`, {})).status).toBe(403);
    expect((await client().get("/api/platform/organizations")).status).toBe(401);
  });

  it("there is no way to become a platform administrator through the API", async () => {
    const c = client();
    const email = `wannabe-${uniq()}@example.test`;
    const r = await c.post("/api/auth/signup", { fullName: "Wanna Be", email, password: "Str0ng-Passw0rd!", confirmPassword: "Str0ng-Passw0rd!", organization: { name: `X ${uniq()}`, type: "hospital" }, facility: registrationFacility(), acceptTerms: true, isPlatformAdmin: true });
    expect(r.status).toBe(201);
    const [u] = await db.select().from(users).where(eq(users.email, email));
    expect(u.isPlatformAdmin).toBe(false);
    await c.patch("/api/auth/profile", { fullName: "Wanna Be", isPlatformAdmin: true });
    expect((await c.get("/api/platform/organizations")).status).toBe(403);
  });

  it("the platform admin sees applicant details, approves, and the organization can then operate", async () => {
    const { admin, orgId, email } = await signupOrg("Review Me Hospital", { approve: false });
    const p = await platformAdmin();
    const queue = await p.get("/api/platform/organizations?status=pending");
    expect(queue.status).toBe(200);
    const item = queue.body.items.find((o: { id: string }) => o.id === orgId);
    expect(item.applicant.email).toBe(email);
    expect(item.facilities[0].name).toBe("Main Hospital");
    const ok = await p.post(`/api/platform/organizations/${orgId}/approve`, { note: "Registration documents checked" });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("approved");
    expect(ok.body.reviewedAt).toBeTruthy();
    expect((await admin.get("/api/facilities")).status).toBe(200);
    expect((await admin.get("/api/auth/me")).body.organization.status).toBe("approved");
    // A decision is final.
    expect((await p.post(`/api/platform/organizations/${orgId}/reject`, { note: "Changed my mind" })).status).toBe(422);
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, orgId));
    expect(trail.map((t) => t.action)).toContain("platform.organization_approved");
  });

  it("rejection needs a reason, keeps the organization and its audit history, and blocks operations", async () => {
    const { admin, orgId } = await signupOrg("Reject Me Lab", { approve: false });
    const p = await platformAdmin();
    expect((await p.post(`/api/platform/organizations/${orgId}/reject`, {})).status).toBe(400);
    const r = await p.post(`/api/platform/organizations/${orgId}/reject`, { note: "Registration number could not be verified" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("rejected");
    const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    expect(row.reviewNote).toBe("Registration number could not be verified");
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, orgId));
    expect(trail.map((t) => t.action)).toEqual(expect.arrayContaining(["auth.signup", "platform.organization_rejected"]));
    const blocked = await admin.get("/api/batches");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("organization_rejected");
    const me = (await admin.get("/api/auth/me")).body;
    expect(me.organization.status).toBe("rejected");
    expect(me.organization.reviewNote).toMatch(/could not be verified/);
  });

  it("a platform administrator cannot approve an organization they belong to", async () => {
    const p = await platformAdmin();
    const r = await p.post("/api/auth/create-organization", { organization: { name: `Own Org ${uniq()}`, type: "clinic" }, facility: registrationFacility() });
    expect(r.status).toBe(201);
    const self = await p.post(`/api/platform/organizations/${r.body.organizationId}/approve`, {});
    expect(self.status).toBe(403);
    expect(self.body.error.message).toMatch(/cannot review an organization you belong to/);
  });
});

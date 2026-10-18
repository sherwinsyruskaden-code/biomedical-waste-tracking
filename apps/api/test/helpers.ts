import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { devOutbox } from "../src/lib/mailer.js";

export const app: Express = createApp();
let seq = 0;
export const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A cookie-keeping client that sends the CSRF header on every request. */
export function client() {
  const agent = request.agent(app);
  const h = { "x-bwts-csrf": "1" };
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object, headers: Record<string, string> = {}) => agent.post(url).set({ ...h, ...headers }).send(body ?? {}),
    patch: (url: string, body?: object) => agent.patch(url).set(h).send(body ?? {}),
    put: (url: string, body?: object) => agent.put(url).set(h).send(body ?? {}),
    del: (url: string) => agent.delete(url).set(h),
  };
}
export type Client = ReturnType<typeof client>;

export const PASSWORD = "Str0ng-Passw0rd!";

export async function signupOrg(name = "Test Hospital") {
  const c = client();
  const email = `admin-${uniq()}@example.test`;
  const res = await c.post("/api/auth/signup", {
    fullName: "Asha Admin",
    email,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    organization: { name: `${name} ${uniq()}`, type: "hospital" },
    facility: { name: "Main Hospital", type: "generator", address: "1 Hospital Road, Chennai", city: "Chennai", latitude: 12.9249, longitude: 80.1 },
    acceptTerms: true,
  });
  if (res.status !== 201) throw new Error(`signup failed ${res.status} ${JSON.stringify(res.body)}`);
  const plant = await c.post("/api/facilities", { name: "Green CBWTF", type: "treatment", canReceive: true, address: "Plot 9, SIPCOT, Chennai", city: "Chennai", latitude: 12.98, longitude: 80.2 });
  if (plant.status !== 201) throw new Error(`facility failed ${JSON.stringify(plant.body)}`);
  const cats = await c.get("/api/categories");
  return { admin: c, email, orgId: res.body.organizationId as string, hospitalId: res.body.facilityId as string, plantId: plant.body.id as string, categories: cats.body as { id: string; code: string }[] };
}

/** Invites a member and accepts the invitation in a fresh client. */
export async function addMember(admin: Client, role: "facility_staff" | "transporter" | "admin", facilityIds: string[] = []) {
  const email = `${role}-${uniq()}@example.test`;
  const inv = await admin.post("/api/invitations", { email, role, facilityIds, fullName: `${role} user` });
  if (inv.status !== 201) throw new Error(`invite failed ${JSON.stringify(inv.body)}`);
  const token = String(inv.body.link).split("/invite/")[1];
  const c = client();
  const acc = await c.post("/api/invitations/accept", { token, fullName: `Test ${role}`, password: PASSWORD, acceptTerms: true });
  if (acc.status !== 200) throw new Error(`accept failed ${JSON.stringify(acc.body)}`);
  const me = await c.get("/api/auth/me");
  return { c, email, userId: me.body.user.id as string };
}

export const lastMailTo = (email: string) => [...devOutbox].reverse().find((m) => m.to === email);

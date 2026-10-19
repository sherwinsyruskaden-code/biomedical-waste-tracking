import { describe, expect, it } from "vitest";
import { PASSWORD, app, client, lastMailTo, registrationFacility, signupOrg, uniq } from "./helpers.js";
import request from "supertest";

describe("registration", () => {
  it("creates user, organization, facility, default categories and a session", async () => {
    const { admin, email } = await signupOrg();
    const me = await admin.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.membership.role).toBe("admin");
    const cats = await admin.get("/api/categories");
    expect(cats.body.map((c: { code: string }) => c.code)).toEqual(["BLUE", "RED", "WHITE", "YELLOW"]);
    const facs = await admin.get("/api/facilities");
    expect(facs.body).toHaveLength(2);
  });

  it("rejects a duplicate email with 409 (case-insensitive)", async () => {
    const { email } = await signupOrg();
    const c = client();
    const res = await c.post("/api/auth/signup", {
      fullName: "Someone",
      email: email.toUpperCase(),
      password: PASSWORD,
      confirmPassword: PASSWORD,
      organization: { name: "Dup Org", type: "clinic" },
      facility: registrationFacility(),
      acceptTerms: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already exists/);
  });

  it("validates input with useful messages", async () => {
    const c = client();
    const weak = await c.post("/api/auth/signup", { fullName: "A B", email: "not-an-email", password: "abc", confirmPassword: "abc", organization: { name: "X", type: "clinic" }, facility: registrationFacility(), acceptTerms: true });
    expect(weak.status).toBe(400);
    expect(weak.body.error.details.fields).toHaveProperty("email");
    expect(weak.body.error.details.fields).toHaveProperty("password");
    const mismatch = await c.post("/api/auth/signup", { fullName: "Ana B", email: `m-${uniq()}@x.test`, password: PASSWORD, confirmPassword: PASSWORD + "x", organization: { name: "Org", type: "clinic" }, facility: registrationFacility(), acceptTerms: true });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.details.fields).toHaveProperty("confirmPassword");
    const terms = await c.post("/api/auth/signup", { fullName: "Ana B", email: `t-${uniq()}@x.test`, password: PASSWORD, confirmPassword: PASSWORD, organization: { name: "Org", type: "clinic" }, facility: registrationFacility(), acceptTerms: false });
    expect(terms.status).toBe(400);
  });
});

describe("login / logout / sessions", () => {
  it("logs in with correct credentials, rejects wrong ones, and logout invalidates the session", async () => {
    const { email } = await signupOrg();
    const c = client();
    expect((await c.post("/api/auth/login", { email, password: "Wrong-pass-123" })).status).toBe(401);
    const ok = await c.post("/api/auth/login", { email, password: PASSWORD });
    expect(ok.status).toBe(200);
    const cookie = ok.headers["set-cookie"][0] as string;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect((await c.get("/api/auth/me")).status).toBe(200);
    expect((await c.post("/api/auth/logout")).status).toBe(200);
    // Replaying the old cookie must fail — the session row is gone.
    const replay = await request(app).get("/api/auth/me").set("Cookie", cookie.split(";")[0]);
    expect(replay.status).toBe(401);
  });

  it("does not reveal whether an email exists on login", async () => {
    const c = client();
    const res = await c.post("/api/auth/login", { email: `nobody-${uniq()}@x.test`, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Invalid email or password.");
  });

  it("rate-limits repeated login attempts", async () => {
    const email = `ratelimit-${uniq()}@x.test`;
    const c = client();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await c.post("/api/auth/login", { email, password: "Wrong-pass-123" })).status);
    expect(codes.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(codes[11]).toBe(429);
  });

  it("protects APIs from unauthenticated access", async () => {
    expect((await request(app).get("/api/batches")).status).toBe(401);
    expect((await request(app).get("/api/dashboard")).status).toBe(401);
  });
});

describe("CSRF protection", () => {
  it("blocks state-changing requests without the CSRF header or from another origin", async () => {
    const noHeader = await request(app).post("/api/auth/login").send({ email: "a@b.test", password: "x" });
    expect(noHeader.status).toBe(403);
    const foreign = await request(app).post("/api/auth/login").set("x-bwts-csrf", "1").set("Origin", "https://evil.example").send({ email: "a@b.test", password: "x" });
    expect(foreign.status).toBe(403);
  });
});

describe("password reset", () => {
  it("emails a single-use link that sets a new password and signs out other sessions", async () => {
    const { email, admin } = await signupOrg();
    const anon = client();
    const r = await anon.post("/api/auth/forgot-password", { email });
    expect(r.status).toBe(200);
    const unknown = await anon.post("/api/auth/forgot-password", { email: `ghost-${uniq()}@x.test` });
    expect(unknown.body.message).toBe(r.body.message); // no account enumeration
    const mail = lastMailTo(email);
    expect(mail).toBeDefined();
    const token = mail!.text.match(/token=([A-Za-z0-9_-]+)/)![1];
    const newPass = "N3w-Password-xyz";
    expect((await anon.post("/api/auth/reset-password", { token, password: newPass })).status).toBe(200);
    expect((await anon.post("/api/auth/reset-password", { token, password: newPass })).status).toBe(400); // single use
    expect((await admin.get("/api/auth/me")).status).toBe(401); // old session revoked
    expect((await anon.post("/api/auth/login", { email, password: PASSWORD })).status).toBe(401);
    expect((await anon.post("/api/auth/login", { email, password: newPass })).status).toBe(200);
  });
});

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../src/db/client.js";
import { sessions } from "../src/db/schema.js";
import { sha256 } from "../src/lib/crypto.js";
import { client, PASSWORD, signupOrg } from "./helpers.js";

const cookieOf = (res: { headers: Record<string, unknown> }) => ((res.headers["set-cookie"] as string[] | undefined) ?? []).find((c) => c.startsWith("bwts_session="))!;
const tokenOf = (cookie: string) => cookie.split(";")[0].split("=")[1];

describe("session handling (regression: signup button disappearing / visitors looking signed in)", () => {
  it("anonymous visitors get 401 from /me and the response is never cacheable", async () => {
    const r = await client().get("/api/auth/me");
    expect(r.status).toBe(401);
    expect(r.headers["cache-control"]).toContain("no-store");
  });

  it("a visitor with a garbage or unknown session cookie is anonymous", async () => {
    const c = client();
    const r = await c.agent.get("/api/auth/me").set("Cookie", "bwts_session=" + "x".repeat(43));
    expect(r.status).toBe(401);
  });

  it("demo sign-in is a short-lived browser-session cookie, not a 7-day login", async () => {
    const c = client();
    const r = await c.post("/api/auth/demo-login", { account: "admin" });
    expect(r.status).toBe(200);
    const cookie = cookieOf(r);
    expect(cookie).not.toMatch(/Max-Age|Expires/i);
    expect(cookie).toMatch(/HttpOnly/i);
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sha256(tokenOf(cookie))));
    const hours = (row.expiresAt.getTime() - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(3);
    expect(hours).toBeLessThanOrEqual(4.01);
  }, 60_000);

  it("a normal sign-in is a persistent cookie", async () => {
    const { email } = await signupOrg();
    const r = await client().post("/api/auth/login", { email, password: PASSWORD });
    expect(cookieOf(r)).toMatch(/Max-Age=\d+/i);
  });

  it("signing out makes the same cookie anonymous again", async () => {
    const c = client();
    await c.post("/api/auth/demo-login", { account: "admin" });
    expect((await c.get("/api/auth/me")).status).toBe(200);
    expect((await c.post("/api/auth/logout")).status).toBe(200);
    expect((await c.get("/api/auth/me")).status).toBe(401);
  }, 60_000);

  it("signing in again replaces the previous session instead of leaving it valid", async () => {
    const { email } = await signupOrg();
    const c = client();
    const first = await c.post("/api/auth/login", { email, password: PASSWORD });
    const oldToken = tokenOf(cookieOf(first));
    await c.post("/api/auth/login", { email, password: PASSWORD });
    const [stale] = await db.select().from(sessions).where(eq(sessions.id, sha256(oldToken)));
    expect(stale).toBeUndefined();
    expect((await c.get("/api/auth/me")).status).toBe(200);
  });

  it("an expired session is anonymous", async () => {
    const { email } = await signupOrg();
    const c = client();
    const r = await c.post("/api/auth/login", { email, password: PASSWORD });
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, sha256(tokenOf(cookieOf(r)))));
    expect((await c.get("/api/auth/me")).status).toBe(401);
  });
});

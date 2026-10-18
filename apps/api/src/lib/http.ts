import type { Request, Response, Router } from "express";
import { z, type ZodType } from "zod";
import type { Role } from "../db/schema.js";
import { badRequest, forbidden, unauthorized } from "./errors.js";

export interface AuthContext {
  user: { id: string; email: string; fullName: string };
  sessionId: string;
  /** Present when the user has an active membership in the selected organization. */
  membership: {
    id: string;
    organizationId: string;
    role: Role;
    facilityIds: string[];
  } | null;
}

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthContext;
  }
}

export type Access = "public" | "user" | "member";

export interface RouteSpec<B extends ZodType | undefined, Q extends ZodType | undefined> {
  method: "get" | "post" | "patch" | "put" | "delete";
  path: string;
  summary: string;
  tag: string;
  access: Access;
  /** Restrict to these roles (requires access: "member"). */
  roles?: Role[];
  body?: B;
  query?: Q;
  /** Response is not JSON (file / stream); used for docs only. */
  produces?: string;
}

export interface Ctx<B, Q> {
  req: Request;
  res: Response;
  body: B;
  query: Q;
  params: Record<string, string>;
  auth: AuthContext;
}

export type Membership = NonNullable<AuthContext["membership"]>;
export interface Actor {
  userId: string;
  orgId: string;
  role: Role;
  facilityIds: string[];
  membershipId: string;
  ip?: string;
}

/** The acting organization member (the route() wrapper already guaranteed it exists for member routes). */
export function actorOf(ctx: { auth: AuthContext; req: Request }): Actor {
  const m = ctx.auth.membership;
  if (!m) throw forbidden("You are not an active member of an organization.");
  return { userId: ctx.auth.user.id, orgId: m.organizationId, role: m.role, facilityIds: m.facilityIds, membershipId: m.id, ip: ctx.req.ip };
}

type Infer<T> = T extends ZodType ? z.infer<T> : undefined;

/** Return this from a handler that writes/streams the response itself. */
export const HANDLED = Symbol("handled");

export const registry: (RouteSpec<ZodType | undefined, ZodType | undefined> & { fullPath: string })[] = [];

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Registers an Express route with validation, auth/role enforcement and OpenAPI metadata.
 * Every protected route goes through here, so authorization cannot be forgotten per handler.
 */
export function route<B extends ZodType | undefined = undefined, Q extends ZodType | undefined = undefined>(
  router: Router,
  basePath: string,
  spec: RouteSpec<B, Q>,
  handler: (ctx: Ctx<Infer<B>, Infer<Q>>) => Promise<unknown>,
) {
  registry.push({ ...(spec as RouteSpec<ZodType | undefined, ZodType | undefined>), fullPath: basePath + spec.path });
  router[spec.method](spec.path, async (req, res) => {
    // Path params named *Id must be UUIDs — avoids DB errors and probing.
    for (const [k, v] of Object.entries(req.params)) {
      if (k.toLowerCase().endsWith("id") && typeof v === "string" && !uuidRe.test(v)) throw badRequest(`Invalid ${k}.`);
    }
    if (spec.access !== "public" && !req.auth) throw unauthorized();
    if (spec.access === "member") {
      if (!req.auth!.membership) throw forbidden("You are not an active member of an organization.");
      if (spec.roles && !spec.roles.includes(req.auth!.membership.role)) throw forbidden();
    }
    const body = spec.body ? parse(spec.body, req.body ?? {}, "body") : undefined;
    const query = spec.query ? parse(spec.query, req.query, "query") : undefined;
    const result = await handler({
      req,
      res,
      body: body as Infer<B>,
      query: query as Infer<Q>,
      params: req.params as Record<string, string>,
      auth: req.auth as never,
    } as never);
    if (result !== HANDLED && !res.headersSent) {
      if (result === undefined) res.status(204).end();
      else res.json(result);
    }
  });
}

function parse(schema: ZodType, value: unknown, where: string) {
  const r = schema.safeParse(value);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) fields[issue.path.join(".") || where] ??= issue.message;
    const first = Object.entries(fields)[0];
    throw badRequest(first ? `${first[0]}: ${first[1]}` : `Invalid ${where}.`, { fields });
  }
  return r.data;
}

/** Common Zod helpers */
export const zId = z.string().uuid();
export const zPage = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const zOptionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { pool } from "./db/client.js";
import { env, isProd, isTest } from "./env.js";
import { AppError } from "./lib/errors.js";
import { registry } from "./lib/http.js";
import { logger } from "./lib/logger.js";
import { loadSession } from "./lib/session.js";
import { router as authRouter } from "./routes/auth.js";
import { router as orgRouter } from "./routes/org.js";
import { router as batchRouter } from "./routes/batches.js";
import { router as idRouter } from "./routes/identification.js";
import { router as asgRouter } from "./routes/assignments.js";
import { router as opsRouter } from "./routes/ops.js";
import { router as insightsRouter } from "./routes/insights.js";
import { router as platformRouter } from "./routes/platform.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback"); // correct client IPs behind the Vite dev proxy / a local reverse proxy
  app.set("query parser", "simple");

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Map tiles (OpenStreetMap or configured provider) and QR SVG data URIs
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
          fontSrc: ["'self'", "data:", "https://cdn.jsdelivr.net"],
          connectSrc: ["'self'", "https:"],
          workerSrc: ["'self'", "blob:"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  if (!isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/api/health" || req.url === "/api/events/stream" } }));
  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());

  // Coarse API-wide rate limit (per IP); auth endpoints have stricter limits of their own.
  app.use(
    "/api",
    rateLimit({ windowMs: 60_000, limit: isTest ? 100_000 : 600, standardHeaders: "draft-8", legacyHeaders: false, handler: (_req, res) => res.status(429).json({ error: { code: "rate_limited", message: "Too many requests — slow down a little." } }) }),
  );

  // CSRF defence for cookie-authenticated, state-changing requests:
  //  1. session cookie is SameSite=Lax, 2. a custom header is required (forces a CORS preflight,
  //  which this API never approves for other origins), 3. Origin, when sent, must be our own.
  const allowedOrigins = new Set([new URL(env.APP_URL).origin]);
  app.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (req.get("x-bwts-csrf") !== "1") return res.status(403).json({ error: { code: "csrf", message: "Missing CSRF header." } });
    const origin = req.get("origin");
    if (origin && !allowedOrigins.has(origin) && origin !== `${req.protocol}://${req.get("host")}`) {
      return res.status(403).json({ error: { code: "csrf", message: "Cross-site request blocked." } });
    }
    next();
  });

  // Who-am-I answers must never come from a browser or proxy cache: a cached "signed in" /me is exactly how a visitor could look logged in.
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", loadSession);

  app.get("/api/health", async (_req, res) => {
    try {
      await pool.query("select 1");
      res.json({ status: "ok", database: "ok", time: new Date() });
    } catch {
      res.status(503).json({ status: "degraded", database: "unreachable" });
    }
  });

  app.use("/api/auth", authRouter);
  app.use("/api", orgRouter);
  app.use("/api", batchRouter);
  app.use("/api", idRouter);
  app.use("/api", asgRouter);
  app.use("/api", opsRouter);
  app.use("/api", insightsRouter);
  app.use("/api/platform", platformRouter);

  // API documentation (OpenAPI 3.1 generated from the same Zod schemas that validate requests)
  app.get("/api/openapi.json", (_req, res) => res.json(buildOpenApi()));
  app.get("/api/docs", (_req, res) => {
    res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>BWTS API</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><script id="api-reference" data-url="/api/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1"></script>
<noscript>Open <a href="/api/openapi.json">/api/openapi.json</a> in any OpenAPI viewer.</noscript></body></html>`);
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: { code: "not_found", message: "Endpoint not found." } }));

  // In production the API also serves the built web app (single process, single origin).
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (isProd && existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { type?: string; code?: string; status?: number };
    if (e?.type === "entity.parse.failed") return res.status(400).json({ error: { code: "bad_json", message: "Request body is not valid JSON." } });
    if (e?.type === "entity.too.large") return res.status(413).json({ error: { code: "too_large", message: "Request body is too large." } });
    if (e?.code === "23505") return res.status(409).json({ error: { code: "conflict", message: "That record already exists." } });
    if (e?.code === "23503") return res.status(400).json({ error: { code: "bad_reference", message: "A referenced record does not exist." } });
    if (e?.code === "P0001") return res.status(409).json({ error: { code: "immutable", message: "History records cannot be changed." } });
    (req.log ?? logger).error({ err }, "unhandled error");
    res.status(500).json({ error: { code: "internal", message: isProd ? "Something went wrong. Please try again." : String((err as Error)?.message ?? err) } });
  });

  return app;
}

function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  const toJson = (s: unknown) => {
    try {
      return z.toJSONSchema(s as z.ZodType, { io: "input", unrepresentable: "any" });
    } catch {
      return { type: "object" };
    }
  };
  for (const r of registry) {
    const p = r.fullPath.replace(/:(\w+)/g, "{$1}");
    const params = [...r.fullPath.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    if (r.query) {
      const js = toJson(r.query) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, schema] of Object.entries(js.properties ?? {})) params.push({ name, in: "query", required: js.required?.includes(name) ?? false, schema: schema as never });
    }
    paths[p] ??= {};
    paths[p][r.method] = {
      summary: r.summary,
      tags: [r.tag],
      description: `Access: ${r.access === "public" ? "public" : r.access === "user" ? "signed-in user" : r.access === "platform" ? "platform administrator" : `member of an approved organization${r.roles ? ` (${r.roles.join(", ")})` : ""}`}`,
      parameters: params,
      ...(r.body ? { requestBody: { required: true, content: { "application/json": { schema: toJson(r.body) } } } } : {}),
      responses: {
        "200": { description: "OK", content: { [r.produces ?? "application/json"]: {} } },
        "400": { description: "Validation error" },
        "401": { description: "Not signed in" },
        "403": { description: "Forbidden" },
        "404": { description: "Not found (also returned for records outside your organization)" },
        "422": { description: "Invalid lifecycle transition" },
      },
    };
  }
  paths["/api/events/stream"] = { get: { summary: "Server-sent events: location, notification and invalidate events", tags: ["Tracking"], responses: { "200": { description: "text/event-stream" } } } };
  return {
    openapi: "3.1.0",
    info: {
      title: "Biomedical Waste Tracking System API",
      version: "1.0.0",
      description:
        "Cookie-session REST API. State-changing requests must send the header `X-BWTS-CSRF: 1`. Errors have the shape `{ error: { code, message, details? } }`.",
    },
    components: { securitySchemes: { session: { type: "apiKey", in: "cookie", name: "bwts_session" } } },
    security: [{ session: [] }],
    paths,
  };
}

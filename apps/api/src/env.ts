import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  // On Render, RENDER_EXTERNAL_URL is the public https address of this service, so APP_URL need not be set by hand.
  APP_URL: z.string().url().default(process.env.RENDER_EXTERNAL_URL ?? "http://localhost:5173"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  COOKIE_SECURE: bool,
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  SMTP_FROM: z.string().default("BWTS <no-reply@example.com>"),
  ROUTING_URL: z.string().optional().default(""),
  DEMO_MODE: bool,
  ALERT_JOB_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  /** Optional. When set, session lookups are cached in Redis for a few seconds (PostgreSQL stays the source of truth). */
  REDIS_URL: z.string().optional().default(""),
  LOG_LEVEL: z.string().default("info"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast with a readable message rather than a stack trace deep inside the app.
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

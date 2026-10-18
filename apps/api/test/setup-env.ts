import { existsSync } from "node:fs";
import path from "node:path";

const envFile = path.resolve(import.meta.dirname, "../../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/bwts_test";
process.env.APP_URL = "http://localhost:5173";
process.env.SMTP_HOST = ""; // tests use the in-memory console outbox
process.env.DEMO_MODE = "true";
process.env.ROUTING_URL = "";

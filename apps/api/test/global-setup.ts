import { existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/** Recreates the test database schema and applies migrations once per test run. */
export default async function setup() {
  const envFile = path.resolve(import.meta.dirname, "../../../.env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set (see .env.example). It is wiped by the tests.");
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL — tests wipe it.");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await client.end();
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = url;
  const { runMigrations } = await import("../src/db/migrate.js");
  const { pool } = await import("../src/db/client.js");
  await runMigrations();
  await pool.end();
}

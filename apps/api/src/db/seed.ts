/**
 * CLI for the demo organization (SYNTHETIC DATA ONLY).
 *   npm run db:seed          # create it if missing
 *   npm run db:seed:reset    # delete and recreate it
 */
import { pool } from "./client.js";
import { runMigrations } from "./migrate.js";
import { seedDemo } from "../services/demo.js";

runMigrations()
  .then(() => seedDemo({ reset: process.argv.includes("--reset") }))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

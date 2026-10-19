/**
 * Grants or revokes platform-administrator rights. Server CLI only — there is deliberately no API for this.
 *   npm run platform-admin -- reviewer@example.org            # grant (the account must already exist)
 *   npm run platform-admin -- reviewer@example.org --revoke
 */
import { pool } from "./client.js";
import { runMigrations } from "./migrate.js";
import { setPlatformAdmin } from "../services/platform.js";

const email = process.argv.slice(2).find((a) => !a.startsWith("--"));
const revoke = process.argv.includes("--revoke");

if (!email) {
  console.error("Usage: npm run platform-admin -- <email> [--revoke]");
  process.exitCode = 1;
} else {
  runMigrations()
    .then(() => setPlatformAdmin(email, !revoke))
    .then(() => console.log(`${email} is ${revoke ? "no longer" : "now"} a platform administrator.`))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

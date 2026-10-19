/**
 * OPT-IN cleanup of the preloaded synthetic batches in the sample organization. Never runs automatically.
 *   npm run db:seed:trim            # dry run: shows what WOULD be deleted
 *   npm run db:seed:trim -- --yes   # deletes the preloaded synthetic batches (and what only they carried)
 * Batches registered by people are not selected. It does not touch any other organization.
 */
import { pool } from "./client.js";
import { runMigrations } from "./migrate.js";
import { trimSampleBatches } from "../services/demo.js";

const confirm = process.argv.includes("--yes");

runMigrations()
  .then(() => trimSampleBatches({ confirm }))
  .then((r) => {
    if (!r.organization) return console.log("No sample organization found. Nothing to do.");
    console.log(`Sample organization: ${r.organization}`);
    console.log(`Preloaded synthetic batches: ${r.batches}; transport orders only they carried: ${r.assignments}.`);
    console.log(r.deleted ? "Deleted." : r.batches ? "Dry run: nothing was deleted. Add --yes to delete them." : "Nothing to delete.");
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

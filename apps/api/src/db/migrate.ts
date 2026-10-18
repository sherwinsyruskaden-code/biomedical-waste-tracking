import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { db, pool } from "./client.js";

export const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export async function runMigrations() {
  await migrate(db, { migrationsFolder });
}

// Run directly: `npm run db:migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => {
      console.log("Migrations applied.");
      return pool.end();
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

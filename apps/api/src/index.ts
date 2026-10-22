import { createApp } from "./app.js";
import { pool } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { env } from "./env.js";
import { logger } from "./lib/logger.js";
import { mailConfigured } from "./lib/mailer.js";
import { startAlertJob, stopAlertJob } from "./services/alerts.js";
import { stopSimulations } from "./routes/assignments.js";
import { upgradeSampleData } from "./services/demo.js";
import { closeRedis } from "./lib/redis.js";

async function main() {
  // Apply pending migrations on boot so a fresh checkout "just works". Safe to run repeatedly.
  await runMigrations();
  if (env.DEMO_MODE) {
    // Existing sample data (from earlier versions) is renamed / topped up in place. Nothing is created or deleted here.
    await upgradeSampleData().catch((err) => logger.warn({ err }, "Could not refresh the existing sample data"));
  }
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`BWTS API listening on http://localhost:${env.PORT}  (docs: http://localhost:${env.PORT}/api/docs)`);
    if (!mailConfigured()) logger.warn("SMTP not configured — password-reset and invite emails are printed to this log (console-mail mode).");
    if (env.DEMO_MODE) logger.warn("DEMO_MODE is on — admins can run clearly-labelled simulated GPS trips.");
  });
  startAlertJob(env.ALERT_JOB_INTERVAL_SECONDS);

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    stopAlertJob();
    stopSimulations();
    server.close(() => closeRedis().then(() => pool.end()).finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "Failed to start. Is PostgreSQL running and DATABASE_URL correct?");
  process.exit(1);
});

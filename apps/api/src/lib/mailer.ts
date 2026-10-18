import nodemailer from "nodemailer";
import { env } from "../env.js";
import { logger } from "./logger.js";

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

export const mailConfigured = () => transport !== null;

/** Outbox used by tests and "console mail" mode so links can be inspected. */
export const devOutbox: { to: string; subject: string; text: string }[] = [];

export async function sendMail(to: string, subject: string, text: string) {
  if (!transport) {
    devOutbox.push({ to, subject, text });
    if (devOutbox.length > 50) devOutbox.shift();
    // Console mode: deliberately visible so a developer can follow the link locally.
    logger.warn({ to, subject }, `[console-mail] SMTP not configured. Message body:\n${text}`);
    return { delivered: false as const };
  }
  await transport.sendMail({ from: env.SMTP_FROM, to, subject, text });
  return { delivered: true as const };
}

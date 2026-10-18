import pino from "pino";
import { env, isTest } from "../env.js";

export const logger = pino({
  level: isTest ? "silent" : env.LOG_LEVEL,
  // Never log secrets even if someone logs a whole request/body by mistake.
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      'res.headers["set-cookie"]',
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.currentPassword",
      "*.newPassword",
    ],
    censor: "[redacted]",
  },
  transport: env.NODE_ENV === "development" ? { target: "pino-pretty", options: { colorize: true } } : undefined,
});

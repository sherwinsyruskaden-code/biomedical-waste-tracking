/**
 * Optional Redis cache.
 *
 * Redis is used for ONE thing: caching the session lookup for a few seconds (see lib/session.ts), so a signed-in
 * user's requests do not hit PostgreSQL for the session on every call. PostgreSQL stays the source of truth:
 * with no REDIS_URL, or when Redis is down, every function here is a no-op and the app behaves exactly as before.
 */
import { createClient } from "redis";
import { env } from "../env.js";
import { logger } from "./logger.js";

const client = env.REDIS_URL ? createClient({ url: env.REDIS_URL }) : null;

if (client) {
  client.on("error", (err) => logger.warn({ err: String(err) }, "Redis error (continuing without cache)"));
  client.connect().then(() => logger.info("Redis connected: session lookups are cached"), () => undefined);
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!client?.isReady) return null;
  try {
    const v = await client.get(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number) {
  if (!client?.isReady) return;
  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch {
    /* the cache is optional */
  }
}

export async function cacheDel(...keys: string[]) {
  if (!client?.isReady || keys.length === 0) return;
  try {
    await client.del(keys);
  } catch {
    /* the cache is optional */
  }
}

export async function closeRedis() {
  if (client?.isOpen) await client.quit().catch(() => undefined);
}

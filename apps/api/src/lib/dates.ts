/**
 * Date rules in one place, so every endpoint applies the same, explainable limits.
 *
 * - "Now" is always the server clock. Nothing here hardcodes a year.
 * - Day filters (reports, batch search) are calendar days in the ORGANIZATION's timezone:
 *   "To 18 Oct" means up to 23:59:59.999 on 18 Oct in the organization's zone, not UTC midnight.
 * - Each operation has its own limits (see the constants); errors name the field and the allowed window.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { organizations } from "../db/schema.js";
import { badRequest } from "./errors.js";

/** No record in this system can sensibly predate this. */
export const MIN_YEAR = 2000;
export const MIN_DATE = new Date(Date.UTC(MIN_YEAR, 0, 1));
const MIN = 60_000;
const DAY = 86_400_000;
/** How far ahead a pickup can be scheduled. */
export const MAX_SCHEDULE_AHEAD_DAYS = 90;
/** A trip must be completed within this long after its scheduled pickup. */
export const MAX_TRIP_WINDOW_DAYS = 30;
/** Tolerated while a form is open, plus device clock drift. */
export const PAST_GRACE_MS = 10 * MIN;
export const CLOCK_SKEW_MS = 5 * MIN;

// ------------------------------------------------------------------ timezone arithmetic (Intl only, no dependency)
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(instant: number, tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(instant))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o;
}
/** Offset of `tz` from UTC at `instant`, in ms (IST = +19_800_000). */
export function tzOffsetMs(instant: number, tz: string) {
  const p = parts(instant, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}
/** The instant at which the wall clock in `tz` reads y-m-d h:mi. DST gaps/overlaps resolve to the later valid instant. */
export function zonedTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string) {
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let t = naive - tzOffsetMs(naive, tz);
  t = naive - tzOffsetMs(t, tz);
  return t;
}
/** Today's calendar date in `tz` as YYYY-MM-DD. */
export function todayIn(tz: string, now = Date.now()) {
  const p = parts(now, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
export async function orgTimezone(orgId: string) {
  const [o] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, orgId));
  return o && validTimezone(o.tz) ? o.tz : "UTC";
}

// ------------------------------------------------------------------ field errors
const fieldError = (field: string, message: string) => badRequest(message, { fields: { [field]: message } });
const show = (t: number, tz?: string) => new Date(t).toLocaleString("en-GB", { timeZone: tz ?? "UTC", dateStyle: "medium", timeStyle: "short" }) + (tz ? "" : " UTC");

// ------------------------------------------------------------------ report / search ranges (calendar days)
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function dayParts(raw: string) {
  const m = DAY_RE.exec(raw);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, mo, d };
}

/**
 * Resolves `from` / `to` query values for historical filters.
 * Accepts YYYY-MM-DD (a calendar day in the organization's timezone) or a full ISO timestamp.
 * `from` is inclusive; the returned `to` is the last millisecond of the chosen day (inclusive).
 * Rejects impossible dates, years before MIN_YEAR, anything in the future, and from > to.
 */
export function resolveRange(raw: { from?: string; to?: string }, tz: string, now = Date.now()): { from?: Date; to?: Date } {
  const today = todayIn(tz, now);
  const one = (field: "from" | "to", v: string | undefined): Date | undefined => {
    if (!v) return undefined;
    const label = field === "from" ? "From" : "To";
    const dp = dayParts(v);
    if (dp) {
      if (dp.y < MIN_YEAR) throw fieldError(field, `${label} date can't be before ${MIN_YEAR}.`);
      if (v > today) throw fieldError(field, `${label} date can't be in the future (today is ${today}).`);
      const start = zonedTimeToUtc(dp.y, dp.mo, dp.d, 0, 0, tz);
      if (field === "from") return new Date(start);
      const next = new Date(Date.UTC(dp.y, dp.mo - 1, dp.d + 1));
      return new Date(zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz) - 1);
    }
    const t = Date.parse(v);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(v) || Number.isNaN(t)) throw fieldError(field, `${label} must be a date like 2026-01-31.`);
    if (t < MIN_DATE.getTime()) throw fieldError(field, `${label} date can't be before ${MIN_YEAR}.`);
    if (t > now + CLOCK_SKEW_MS) throw fieldError(field, `${label} date can't be in the future.`);
    return new Date(t);
  };
  const from = one("from", raw.from);
  const to = one("to", raw.to);
  if (from && to && from.getTime() > to.getTime()) throw fieldError("from", "From date must be on or before the To date.");
  return { from, to };
}

// ------------------------------------------------------------------ scheduling & recording rules
function assertWindow(field: string, label: string, t: Date, min: number, max: number, tz: string) {
  if (Number.isNaN(t.getTime())) throw fieldError(field, `${label} is not a valid date and time.`);
  if (t.getTime() < min || t.getTime() > max) throw fieldError(field, `${label} must be between ${show(min, tz)} and ${show(max, tz)}.`);
}

/** A pickup is scheduled for the near future: from now (minus a form-filling grace) up to MAX_SCHEDULE_AHEAD_DAYS ahead. */
export function assertPickupTime(t: Date, tz: string, now = Date.now()) {
  assertWindow("scheduledPickupAt", "Scheduled pickup", t, now - PAST_GRACE_MS, now + MAX_SCHEDULE_AHEAD_DAYS * DAY, tz);
}
/** The due time is after the pickup and at most MAX_TRIP_WINDOW_DAYS later (and never in the past). */
export function assertDueTime(t: Date, pickup: Date, tz: string, now = Date.now()) {
  if (Number.isNaN(t.getTime())) throw fieldError("dueBy", "Due time is not a valid date and time.");
  if (t.getTime() <= pickup.getTime()) throw fieldError("dueBy", "The due time must be after the scheduled pickup.");
  assertWindow("dueBy", "Due time", t, Math.max(pickup.getTime(), now - PAST_GRACE_MS), pickup.getTime() + MAX_TRIP_WINDOW_DAYS * DAY, tz);
}
/** A re-routed trip starts now, so its due time runs from now. */
export function assertRerouteDue(t: Date, tz: string, now = Date.now()) {
  if (Number.isNaN(t.getTime())) throw fieldError("dueBy", "Due time is not a valid date and time.");
  if (t.getTime() <= now) throw fieldError("dueBy", "The new due time must be in the future.");
  assertWindow("dueBy", "Due time", t, now, now + MAX_TRIP_WINDOW_DAYS * DAY, tz);
}
/** A disposal time can be back-dated to when it really happened, but not before receipt and not in the future. */
export function assertDisposalTime(t: Date, receivedAt: Date | null, tz: string, now = Date.now()) {
  const min = Math.max(MIN_DATE.getTime(), receivedAt?.getTime() ?? 0);
  if (Number.isNaN(t.getTime())) throw fieldError("disposedAt", "Disposal time is not a valid date and time.");
  if (t.getTime() > now + CLOCK_SKEW_MS) throw fieldError("disposedAt", "Disposal time can't be in the future.");
  if (t.getTime() < min) throw fieldError("disposedAt", receivedAt ? `Disposal time can't be before the batch was received (${show(receivedAt.getTime(), tz)}).` : `Disposal time can't be before ${MIN_YEAR}.`);
}

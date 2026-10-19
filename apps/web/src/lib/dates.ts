/**
 * Date helpers that work in the ORGANIZATION's timezone (never the browser's), plus the same
 * limits the API enforces (apps/api/src/lib/dates.ts). The API is the authority; these exist so
 * pickers stop people early and explain why. Nothing here hardcodes a year.
 */
export const MIN_YEAR = 2000;
export const MIN_DAY = `${MIN_YEAR}-01-01`;
export const MAX_SCHEDULE_AHEAD_DAYS = 90;
export const MAX_TRIP_WINDOW_DAYS = 30;
export const PAST_GRACE_MS = 10 * 60_000;
const DAY = 86_400_000;

const cache = new Map<string, Intl.DateTimeFormat>();
function parts(ms: number, tz: string) {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    cache.set(tz, f);
  }
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o;
}
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const tzOffsetMs = (ms: number, tz: string) => {
  const p = parts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
};

/** Today's calendar date in `tz`, as YYYY-MM-DD. */
export function todayIn(tz: string, now = Date.now()) {
  const p = parts(now, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}
/** YYYY-MM-DD shifted by whole days (calendar arithmetic, no timezone involved). */
export function addDays(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** The wall clock in `tz` at instant `ms`, as a datetime-local value (YYYY-MM-DDTHH:mm). */
export function isoToWall(ms: number, tz: string) {
  const p = parts(ms, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
const WALL_RE = /^(\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
/** A datetime-local value read as wall-clock time in `tz` → the instant it denotes (ms), or null if it isn't a real date. */
export function wallToMs(local: string, tz: string): number | null {
  const m = WALL_RE.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || h > 23 || mi > 59) return null;
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let t = naive - tzOffsetMs(naive, tz);
  t = naive - tzOffsetMs(t, tz);
  return t;
}
export const wallToIso = (local: string, tz: string) => {
  const ms = wallToMs(local, tz);
  return ms === null ? "" : new Date(ms).toISOString();
};

const showWall = (ms: number, tz: string) => new Date(ms).toLocaleString("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" });

/** Problem with a date-only filter value, or null. `max` defaults to today in the org's timezone. */
export function dayIssue(v: string, tz: string, opts: { min?: string; max?: string } = {}): string | null {
  if (!v) return null;
  const m = /^(\d{4,6})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return "Enter a complete date.";
  const [y, mo, d] = m.slice(1).map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return "That date doesn't exist.";
  const min = opts.min ?? MIN_DAY;
  const max = opts.max ?? todayIn(tz);
  if (v < min) return `Date can't be before ${min.slice(0, 4)}.`;
  if (v > max) return "Date can't be in the future.";
  return null;
}

/** Problem with a datetime-local value, given the allowed window in ms, or null. */
export function wallIssue(v: string, tz: string, minMs: number, maxMs: number): string | null {
  if (!v) return "Choose a date and time.";
  const ms = wallToMs(v, tz);
  if (ms === null) return "That date and time doesn't exist.";
  if (ms < minMs || ms > maxMs) return `Choose a time between ${showWall(minMs, tz)} and ${showWall(maxMs, tz)}.`;
  return null;
}

/** The window the API allows for a pickup time. */
export const pickupWindow = (now = Date.now()) => ({ min: now - PAST_GRACE_MS, max: now + MAX_SCHEDULE_AHEAD_DAYS * DAY });
/** The window for a due time given the pickup instant. */
export const dueWindow = (pickupMs: number, now = Date.now()) => ({ min: Math.max(pickupMs + 60_000, now - PAST_GRACE_MS), max: pickupMs + MAX_TRIP_WINDOW_DAYS * DAY });
/** The window for a re-routed trip's due time (starts now). */
export const rerouteWindow = (now = Date.now()) => ({ min: now + 60_000, max: now + MAX_TRIP_WINDOW_DAYS * DAY });

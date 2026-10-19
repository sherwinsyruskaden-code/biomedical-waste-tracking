import type { AssignmentStatus, BatchStatus, Role } from "./types";

let tz: string | undefined;
/** Timestamps are stored in UTC and shown in the ORGANIZATION's timezone (set when the session loads), so every screen, report and picker agrees. */
export const setDisplayTimezone = (t?: string) => (tz = t);

export function fmtDateTime(v?: string | Date | null) {
  if (!v) return "—";
  return new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: tz });
}
export function fmtDate(v?: string | Date | null) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: tz });
}
export function fmtTime(v?: string | Date | null) {
  if (!v) return "—";
  return new Date(v).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: tz });
}

export function timeAgo(v?: string | Date | null, now = Date.now()) {
  if (!v) return "never";
  const s = Math.round((now - new Date(v).getTime()) / 1000);
  if (s < 0) return "just now";
  if (s < 45) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const fmtQty = (q: number | null | undefined, unit?: string | null) =>
  q === null || q === undefined ? "—" : `${Number(q).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit === "litre" ? "L" : unit ?? ""}`.trim();

export const humanize = (s?: string | null) => (s ? s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()) : "");

export const roleLabel: Record<Role, string> = { admin: "Organization admin", facility_staff: "Facility staff", transporter: "Transporter" };

/** Plain-language facility types (stored as generator / storage / treatment). */
export const facilityTypeLabel: Record<string, string> = { generator: "Hospital / clinic", storage: "Storage area", treatment: "Treatment plant" };

/** Lifecycle order used by the custody rail. */
export const lifecycle: BatchStatus[] = ["generated", "segregated", "collected", "in_transit", "delivered", "received", "disposed"];

export const statusMeta: Record<BatchStatus, { label: string; tone: "neutral" | "emerald" | "signal" | "lime" | "warn" | "danger" | "ink" }> = {
  generated: { label: "Generated", tone: "neutral" },
  segregated: { label: "Segregated", tone: "emerald" },
  collected: { label: "Collected", tone: "signal" },
  in_transit: { label: "In transit", tone: "signal" },
  delivered: { label: "Delivered", tone: "warn" },
  received: { label: "Received", tone: "emerald" },
  disposed: { label: "Disposed", tone: "ink" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const assignmentMeta: Record<AssignmentStatus, { label: string; tone: "neutral" | "emerald" | "signal" | "warn" | "danger" | "ink" }> = {
  assigned: { label: "Awaiting transporter", tone: "warn" },
  accepted: { label: "Accepted", tone: "emerald" },
  in_progress: { label: "On the road", tone: "signal" },
  completed: { label: "Completed", tone: "ink" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const eventLabel: Record<string, string> = {
  created: "Batch registered",
  updated: "Details edited",
  segregated: "Segregation verified",
  assigned: "Collection requested — transporter assigned",
  unassigned: "Removed from assignment",
  pickup: "Picked up — custody to transporter",
  transit_started: "Trip started",
  handover: "Handed over at destination",
  received: "Receipt confirmed",
  rejected: "Delivery rejected",
  rerouted: "Rerouted to new destination",
  disposed: "Disposal recorded",
  cancelled: "Batch cancelled",
  incident: "Incident reported",
};

export const disposalMethods = [
  "incineration", "plasma_pyrolysis", "autoclave", "microwave", "hydroclave", "shredding",
  "chemical_disinfection", "deep_burial", "encapsulation", "sharps_pit", "recycling_after_treatment", "other",
] as const;

export const incidentTypes = ["spill", "leak", "damaged_container", "wrong_segregation", "weight_discrepancy", "vehicle_breakdown", "delay", "exposure", "other"] as const;

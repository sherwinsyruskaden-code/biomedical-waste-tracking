/**
 * Alerts: raised by lifecycle events and by a periodic background check.
 *
 * The periodic job (runAlertChecks) evaluates documented, per-organization thresholds
 * (see services/settings.ts). Alerts are operational signals — they do not assert that a
 * regulation was breached. Conditions that clear are auto-resolved.
 */
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { alerts, alertTypeEnum, assignments, locationPoints, organizations, severityEnum, wasteBatches } from "../db/schema.js";
import { publish } from "../lib/events.js";
import { logger } from "../lib/logger.js";
import { notify } from "./notify.js";
import { readSettings } from "./settings.js";

type AlertType = (typeof alertTypeEnum.enumValues)[number];
type Severity = (typeof severityEnum.enumValues)[number];

export interface AlertInput {
  organizationId: string;
  type: AlertType;
  severity: Severity;
  title: string;
  message: string;
  batchId?: string | null;
  assignmentId?: string | null;
  facilityId?: string | null;
  dedupeKey: string;
  adminOnly?: boolean;
  /** Extra users to notify (e.g. the transporter on the assignment). */
  notifyUserIds?: string[];
}

/** Inserts an alert unless an open alert with the same dedupe key exists. Returns true if new. */
export async function raiseAlert(a: AlertInput): Promise<boolean> {
  const rows = await db
    .insert(alerts)
    .values({
      organizationId: a.organizationId,
      type: a.type,
      severity: a.severity,
      title: a.title,
      message: a.message,
      batchId: a.batchId ?? null,
      assignmentId: a.assignmentId ?? null,
      facilityId: a.facilityId ?? null,
      dedupeKey: a.dedupeKey,
    })
    .onConflictDoNothing({ target: [alerts.organizationId, alerts.dedupeKey], where: sql`status = 'open'` })
    .returning();
  const alert = rows[0];
  if (!alert) return false;
  const link = a.batchId ? `/batches/${a.batchId}` : a.assignmentId ? `/assignments/${a.assignmentId}` : "/alerts";
  await notify(
    db,
    a.organizationId,
    { admins: true, facilityStaffAt: a.adminOnly ? [] : [a.facilityId], userIds: a.adminOnly ? [] : a.notifyUserIds },
    { kind: `alert.${a.type}`, title: a.title, body: a.message, link, alertId: alert.id },
  );
  publish({ type: "alert", organizationId: a.organizationId, payload: alert });
  return true;
}

/** Types the periodic job owns (and may auto-resolve). */
const JOB_TYPES: AlertType[] = ["overdue_collection", "delayed_transport", "missing_handover", "pending_receipt", "stale_gps"];

export async function runAlertChecks(now = new Date()) {
  const orgs = await db.select({ id: organizations.id, settings: organizations.settings }).from(organizations);
  let raised = 0;
  for (const org of orgs) {
    const s = readSettings(org.settings);
    const active = new Set<string>();
    const pending: AlertInput[] = [];

    // 1. Overdue collection
    const overdue = await db
      .select({ id: wasteBatches.id, code: wasteBatches.trackingCode, origin: wasteBatches.originFacilityId, generatedAt: wasteBatches.generatedAt })
      .from(wasteBatches)
      .where(and(eq(wasteBatches.organizationId, org.id), inArray(wasteBatches.status, ["generated", "segregated"]), lt(wasteBatches.generatedAt, new Date(now.getTime() - s.collectionOverdueHours * 3600_000))));
    for (const b of overdue) {
      const key = `overdue_collection:${b.id}`;
      active.add(key);
      pending.push({ organizationId: org.id, type: "overdue_collection", severity: "medium", title: `Collection overdue: ${b.code}`, message: `Not collected within ${s.collectionOverdueHours} h of generation (configured threshold).`, batchId: b.id, facilityId: b.origin, dedupeKey: key });
    }

    // 2. Delayed transport
    const delayed = await db
      .select({ id: assignments.id, ref: assignments.reference, transporter: assignments.transporterUserId, dest: assignments.destinationFacilityId })
      .from(assignments)
      .where(and(eq(assignments.organizationId, org.id), inArray(assignments.status, ["assigned", "accepted", "in_progress"]), lt(assignments.dueBy, new Date(now.getTime() - s.transportDelayGraceMinutes * 60_000))));
    for (const a of delayed) {
      const key = `delayed_transport:${a.id}`;
      active.add(key);
      pending.push({ organizationId: org.id, type: "delayed_transport", severity: "high", title: `Transport delayed: ${a.ref}`, message: `Past its due time by more than ${s.transportDelayGraceMinutes} min.`, assignmentId: a.id, facilityId: a.dest, dedupeKey: key, notifyUserIds: [a.transporter] });
    }

    // 3. Missing handover — custody held by a transporter for too long
    const held = await db.execute<{ id: string; code: string; since: Date; assignment_id: string | null; custodian: string | null }>(sql`
      select b.id, b.tracking_code as code, b.current_assignment_id as assignment_id, b.current_custodian_user_id as custodian,
             (select max(e.created_at) from custody_events e where e.batch_id = b.id and e.event_type in ('pickup','rerouted','rejected')) as since
      from waste_batches b
      where b.organization_id = ${org.id} and b.status in ('collected','in_transit','rejected')`);
    for (const b of held.rows) {
      if (!b.since || new Date(b.since).getTime() > now.getTime() - s.custodyMaxHours * 3600_000) continue;
      const key = `missing_handover:${b.id}`;
      active.add(key);
      pending.push({ organizationId: org.id, type: "missing_handover", severity: "high", title: `No handover recorded: ${b.code}`, message: `A transporter has held custody for over ${s.custodyMaxHours} h without a recorded handover.`, batchId: b.id, assignmentId: b.assignment_id, dedupeKey: key, notifyUserIds: b.custodian ? [b.custodian] : [] });
    }

    // 4. Delivered but not received
    const unreceived = await db
      .select({ id: wasteBatches.id, code: wasteBatches.trackingCode, dest: wasteBatches.destinationFacilityId })
      .from(wasteBatches)
      .where(and(eq(wasteBatches.organizationId, org.id), eq(wasteBatches.status, "delivered"), lt(wasteBatches.statusChangedAt, new Date(now.getTime() - s.receiptPendingMinutes * 60_000))));
    for (const b of unreceived) {
      const key = `pending_receipt:${b.id}`;
      active.add(key);
      pending.push({ organizationId: org.id, type: "pending_receipt", severity: "medium", title: `Receipt pending: ${b.code}`, message: `Handed over more than ${s.receiptPendingMinutes} min ago but receipt has not been confirmed.`, batchId: b.id, facilityId: b.dest, dedupeKey: key });
    }

    // 5. Stale / missing GPS during an active transport
    const moving = await db
      .select({ id: assignments.id, ref: assignments.reference, tracking: assignments.trackingActive, last: assignments.lastLocationAt, startedAt: assignments.startedAt, trackingStartedAt: assignments.trackingStartedAt, transporter: assignments.transporterUserId })
      .from(assignments)
      .where(and(eq(assignments.organizationId, org.id), eq(assignments.status, "in_progress")));
    const staleBefore = now.getTime() - s.staleGpsMinutes * 60_000;
    for (const a of moving) {
      const reference = a.last ?? a.trackingStartedAt ?? a.startedAt;
      const stale = !a.tracking || !reference || reference.getTime() < staleBefore;
      if (!stale) continue;
      const key = `stale_gps:${a.id}`;
      active.add(key);
      pending.push({
        organizationId: org.id,
        type: "stale_gps",
        severity: "medium",
        title: a.tracking ? `GPS stale: ${a.ref}` : `Tracking off: ${a.ref}`,
        message: a.tracking
          ? `No location received for over ${s.staleGpsMinutes} min during an active transport.`
          : "Transport is in progress but location sharing is not switched on.",
        assignmentId: a.id,
        dedupeKey: key,
        notifyUserIds: [a.transporter],
      });
    }

    for (const p of pending) if (await raiseAlert(p)) raised++;

    // Auto-resolve job alerts whose condition has cleared
    const open = await db
      .select({ id: alerts.id, key: alerts.dedupeKey })
      .from(alerts)
      .where(and(eq(alerts.organizationId, org.id), eq(alerts.status, "open"), inArray(alerts.type, JOB_TYPES)));
    const cleared = open.filter((o) => !active.has(o.key)).map((o) => o.id);
    if (cleared.length) await db.update(alerts).set({ status: "resolved", resolvedAt: now, autoResolved: true }).where(inArray(alerts.id, cleared));

    // Location retention policy
    await db.delete(locationPoints).where(and(eq(locationPoints.organizationId, org.id), lt(locationPoints.receivedAt, new Date(now.getTime() - s.locationRetentionDays * 86400_000))));
  }
  return { raised };
}

let timer: NodeJS.Timeout | null = null;
export function startAlertJob(intervalSeconds: number) {
  const tick = () => runAlertChecks().catch((err) => logger.error({ err }, "alert job failed"));
  timer = setInterval(tick, intervalSeconds * 1000);
  timer.unref();
  setTimeout(tick, 5000).unref();
}
export const stopAlertJob = () => timer && clearInterval(timer);

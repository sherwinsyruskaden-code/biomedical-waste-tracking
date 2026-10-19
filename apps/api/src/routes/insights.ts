import { Router } from "express";
import { and, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { db } from "../db/client.js";
import { alerts, assignments, batchStatusEnum, incidents, organizations, wasteBatches } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { orgTimezone, resolveRange } from "../lib/dates.js";
import { actorOf, HANDLED, route, zId, type Actor } from "../lib/http.js";
import { visibilityFilter } from "../services/lifecycle.js";

export const router = Router();
const base = "/api";

const rowsOf = async <T>(q: SQL) => (await db.execute(q)).rows as T[];

/** SQL fragment restricting batch alias `b` to what the actor may see. */
function batchScope(a: Actor, alias = "b"): SQL {
  if (a.role === "admin") return sql`true`;
  if (a.role === "facility_staff") {
    if (!a.facilityIds.length) return sql`false`;
    const ids = sql.join(a.facilityIds.map((id) => sql`${id}::uuid`), sql`, `);
    return sql`(${sql.raw(alias)}.origin_facility_id in (${ids}) or (${sql.raw(alias)}.destination_facility_id in (${ids}) and ${sql.raw(alias)}.status in ('collected','in_transit','delivered','received','disposed','rejected')))`;
  }
  return sql`exists (select 1 from assignment_batches ab join assignments a2 on a2.id = ab.assignment_id where ab.batch_id = ${sql.raw(alias)}.id and a2.transporter_user_id = ${a.userId} and a2.status not in ('declined','cancelled'))`;
}

// ------------------------------------------------------------------ dashboard
route(router, base, { method: "get", path: "/dashboard", summary: "Operational overview from live data (scoped to what you may see)", tag: "Dashboard", access: "member" }, async (ctx) => {
  const a = actorOf(ctx);
  const org = a.orgId;
  const scope = batchScope(a);
  const vis = visibilityFilter(a);

  const statusCounts = await rowsOf<{ status: string; n: number }>(sql`
    select status, count(*)::int as n from waste_batches b where b.organization_id = ${org} and ${scope} group by status`);
  const byStatus = Object.fromEntries(batchStatusEnum.enumValues.map((s) => [s, statusCounts.find((r) => r.status === s)?.n ?? 0]));

  const asgScope = a.role === "admin" ? sql`true` : a.role === "transporter" ? sql`a.transporter_user_id = ${a.userId}` : a.facilityIds.length ? sql`(a.origin_facility_id in (${sql.join(a.facilityIds.map((i) => sql`${i}::uuid`), sql`, `)}) or (a.status in ('accepted','in_progress','completed') and a.destination_facility_id in (${sql.join(a.facilityIds.map((i) => sql`${i}::uuid`), sql`, `)})))` : sql`false`;
  const [asg] = await rowsOf<{ active: number; in_progress: number; overdue: number; tracking: number }>(sql`
    select count(*) filter (where status in ('assigned','accepted','in_progress'))::int as active,
           count(*) filter (where status = 'in_progress')::int as in_progress,
           count(*) filter (where status in ('assigned','accepted','in_progress') and due_by < now())::int as overdue,
           count(*) filter (where status in ('accepted','in_progress') and tracking_active)::int as tracking
    from assignments a where a.organization_id = ${org} and ${asgScope}`);

  const [disposed30] = await rowsOf<{ n: number; avg_hours: number | null }>(sql`
    select count(*)::int as n, avg(extract(epoch from (d.disposed_at - b.generated_at)) / 3600)::float as avg_hours
    from disposal_records d join waste_batches b on b.id = d.batch_id
    where d.organization_id = ${org} and d.disposed_at > now() - interval '30 days' and ${scope}`);

  const trend = await rowsOf<{ day: string; generated: number; generated_kg: number; disposed: number }>(sql`
    with days as (select generate_series((now() at time zone 'utc')::date - 13, (now() at time zone 'utc')::date, interval '1 day')::date as day)
    select to_char(days.day, 'YYYY-MM-DD') as day,
      (select count(*)::int from waste_batches b where b.organization_id = ${org} and ${scope} and (b.generated_at at time zone 'utc')::date = days.day) as generated,
      (select coalesce(sum(b.quantity),0)::float from waste_batches b where b.organization_id = ${org} and ${scope} and b.unit = 'kg' and (b.generated_at at time zone 'utc')::date = days.day) as generated_kg,
      (select count(*)::int from disposal_records d join waste_batches b on b.id = d.batch_id where d.organization_id = ${org} and ${scope} and (d.disposed_at at time zone 'utc')::date = days.day) as disposed
    from days order by days.day`);

  const byCategory = await rowsOf<{ code: string; name: string; color_hex: string; batches: number; kg: number }>(sql`
    select c.code, c.name, c.color_hex, count(b.id)::int as batches, coalesce(sum(b.quantity) filter (where b.unit = 'kg'), 0)::float as kg
    from waste_categories c left join waste_batches b on b.category_id = c.id and b.generated_at > now() - interval '30 days' and b.status <> 'cancelled' and ${scope}
    where c.organization_id = ${org} group by c.id order by c.code`);

  const byFacility = await rowsOf<{ name: string; generated: number; awaiting: number; kg: number }>(sql`
    select f.name, count(b.id)::int as generated,
      count(b.id) filter (where b.status in ('generated','segregated'))::int as awaiting,
      coalesce(sum(b.quantity) filter (where b.unit = 'kg'), 0)::float as kg
    from facilities f join waste_batches b on b.origin_facility_id = f.id and b.generated_at > now() - interval '30 days' and ${scope}
    where f.organization_id = ${org} group by f.id order by generated desc limit 8`);

  const recentEvents = await rowsOf<Record<string, unknown>>(sql`
    select e.id, e.event_type, e.from_status, e.to_status, e.created_at, b.id as batch_id, b.tracking_code, u.full_name as actor_name, f.name as facility_name
    from custody_events e join waste_batches b on b.id = e.batch_id left join users u on u.id = e.actor_user_id left join facilities f on f.id = e.facility_id
    where e.organization_id = ${org} and ${scope} order by e.created_at desc, e.id desc limit 10`);

  void vis;
  return {
    generatedAt: new Date(),
    kpis: {
      inProgress: byStatus.generated + byStatus.segregated + byStatus.collected + byStatus.in_transit + byStatus.delivered + byStatus.received + byStatus.rejected,
      awaitingCollection: byStatus.generated + byStatus.segregated,
      inTransit: byStatus.collected + byStatus.in_transit,
      awaitingReceipt: byStatus.delivered,
      awaitingDisposal: byStatus.received,
      rejected: byStatus.rejected,
      disposedLast30Days: disposed30?.n ?? 0,
      avgCycleHours: disposed30?.avg_hours ?? null,
      activeAssignments: asg?.active ?? 0,
      assignmentsInProgress: asg?.in_progress ?? 0,
      overdueAssignments: asg?.overdue ?? 0,
      trackingNow: asg?.tracking ?? 0,
    },
    byStatus,
    trend,
    byCategory,
    byFacility,
    recentEvents,
  };
});

// ------------------------------------------------------------------ reports
const reportTypes = ["batches", "volume_by_category", "facility_activity", "transport_performance", "custody_history", "disposal"] as const;
type ReportType = (typeof reportTypes)[number];

const reportQuery = z.object({
  type: z.enum(reportTypes),
  /** Calendar days (YYYY-MM-DD) in the organization's timezone; validated by resolveRange. */
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  facilityId: zId.optional(),
  categoryId: zId.optional(),
  status: z.enum(batchStatusEnum.enumValues).optional(),
  transporterUserId: zId.optional(),
  disposal: z.enum(["disposed", "pending"]).optional(),
  format: z.enum(["json", "csv", "pdf"]).default("json"),
});
type ReportQuery = Omit<z.infer<typeof reportQuery>, "from" | "to"> & { from?: Date; to?: Date };

interface Column {
  key: string;
  label: string;
  width?: number;
}
const reportMeta: Record<ReportType, { title: string; columns: Column[] }> = {
  batches: {
    title: "Waste batch register",
    columns: [
      { key: "tracking_code", label: "Tracking code", width: 95 },
      { key: "generated_at", label: "Generated", width: 85 },
      { key: "category", label: "Category", width: 70 },
      { key: "quantity", label: "Qty", width: 45 },
      { key: "unit", label: "Unit", width: 40 },
      { key: "origin", label: "Origin", width: 100 },
      { key: "destination", label: "Destination", width: 100 },
      { key: "status", label: "Status", width: 60 },
      { key: "disposed_at", label: "Disposed", width: 85 },
      { key: "disposal_method", label: "Method", width: 80 },
    ],
  },
  volume_by_category: {
    title: "Waste volume by category",
    columns: [
      { key: "code", label: "Code", width: 70 },
      { key: "category", label: "Category", width: 220 },
      { key: "unit", label: "Unit", width: 60 },
      { key: "batches", label: "Batches", width: 70 },
      { key: "total_quantity", label: "Total qty", width: 90 },
      { key: "disposed_quantity", label: "Disposed qty", width: 90 },
    ],
  },
  facility_activity: {
    title: "Facility activity",
    columns: [
      { key: "facility", label: "Facility", width: 170 },
      { key: "type", label: "Type", width: 70 },
      { key: "generated_batches", label: "Generated", width: 70 },
      { key: "generated_kg", label: "Generated kg", width: 80 },
      { key: "received_batches", label: "Received", width: 70 },
      { key: "rejected_batches", label: "Rejected", width: 70 },
      { key: "disposed_batches", label: "Disposed", width: 70 },
    ],
  },
  transport_performance: {
    title: "Collection & transport performance",
    columns: [
      { key: "reference", label: "Reference", width: 85 },
      { key: "transporter", label: "Transporter", width: 95 },
      { key: "origin", label: "From", width: 95 },
      { key: "destination", label: "To", width: 95 },
      { key: "status", label: "Status", width: 60 },
      { key: "batches", label: "Batches", width: 45 },
      { key: "due_by", label: "Due", width: 85 },
      { key: "completed_at", label: "Completed", width: 85 },
      { key: "trip_minutes", label: "Trip min", width: 50 },
      { key: "on_time", label: "On time", width: 45 },
    ],
  },
  custody_history: {
    title: "Custody history",
    columns: [
      { key: "created_at", label: "Time", width: 90 },
      { key: "tracking_code", label: "Batch", width: 95 },
      { key: "event_type", label: "Event", width: 70 },
      { key: "from_status", label: "From", width: 60 },
      { key: "to_status", label: "To", width: 60 },
      { key: "actor", label: "Actor", width: 90 },
      { key: "facility", label: "Facility", width: 95 },
      { key: "custodian", label: "New custodian", width: 95 },
      { key: "scan_method", label: "Scan", width: 45 },
    ],
  },
  disposal: {
    title: "Disposal records",
    columns: [
      { key: "disposed_at", label: "Disposed", width: 90 },
      { key: "tracking_code", label: "Batch", width: 95 },
      { key: "category", label: "Category", width: 70 },
      { key: "facility", label: "Facility", width: 110 },
      { key: "method", label: "Method", width: 90 },
      { key: "treated_quantity", label: "Qty", width: 50 },
      { key: "unit", label: "Unit", width: 40 },
      { key: "performed_by", label: "Recorded by", width: 90 },
      { key: "document_ref", label: "Document ref", width: 90 },
    ],
  },
};

function batchFilters(q: ReportQuery, a: Actor, dateCol: SQL) {
  const parts: SQL[] = [sql`b.organization_id = ${a.orgId}`, batchScope(a)];
  if (q.from) parts.push(sql`${dateCol} >= ${q.from}`);
  if (q.to) parts.push(sql`${dateCol} <= ${q.to}`);
  if (q.facilityId) parts.push(sql`(b.origin_facility_id = ${q.facilityId} or b.destination_facility_id = ${q.facilityId})`);
  if (q.categoryId) parts.push(sql`b.category_id = ${q.categoryId}`);
  if (q.status) parts.push(sql`b.status = ${q.status}`);
  if (q.disposal === "disposed") parts.push(sql`b.status = 'disposed'`);
  if (q.disposal === "pending") parts.push(sql`b.status not in ('disposed','cancelled')`);
  if (q.transporterUserId) parts.push(sql`exists (select 1 from assignment_batches ab join assignments a3 on a3.id = ab.assignment_id where ab.batch_id = b.id and a3.transporter_user_id = ${q.transporterUserId})`);
  return sql.join(parts, sql` and `);
}

async function runReport(q: ReportQuery, a: Actor): Promise<Record<string, unknown>[]> {
  const LIMIT = sql`limit 10000`;
  switch (q.type) {
    case "batches":
      return rowsOf(sql`
        select b.tracking_code, b.generated_at, c.code as category, b.quantity, b.unit, o.name as origin, d.name as destination, b.status,
               dr.disposed_at, dr.method as disposal_method
        from waste_batches b join waste_categories c on c.id = b.category_id join facilities o on o.id = b.origin_facility_id
        left join facilities d on d.id = b.destination_facility_id left join disposal_records dr on dr.batch_id = b.id
        where ${batchFilters(q, a, sql`b.generated_at`)} order by b.generated_at desc ${LIMIT}`);
    case "volume_by_category":
      return rowsOf(sql`
        select c.code, c.name as category, b.unit, count(*)::int as batches, sum(b.quantity)::float as total_quantity,
               coalesce(sum(b.quantity) filter (where b.status = 'disposed'), 0)::float as disposed_quantity
        from waste_batches b join waste_categories c on c.id = b.category_id
        where ${batchFilters(q, a, sql`b.generated_at`)} and b.status <> 'cancelled'
        group by c.code, c.name, b.unit order by c.code, b.unit`);
    case "facility_activity": {
      const fFilter = q.facilityId ? sql`and f.id = ${q.facilityId}` : sql``;
      const scoped = a.role === "facility_staff" ? (a.facilityIds.length ? sql`and f.id in (${sql.join(a.facilityIds.map((i) => sql`${i}::uuid`), sql`, `)})` : sql`and false`) : sql``;
      const dateParts = (col: string) => sql`${q.from ? sql`and ${sql.raw(col)} >= ${q.from}` : sql``} ${q.to ? sql`and ${sql.raw(col)} <= ${q.to}` : sql``} ${q.categoryId ? sql`and b.category_id = ${q.categoryId}` : sql``}`;
      return rowsOf(sql`
        select f.name as facility, f.type,
          (select count(*)::int from waste_batches b where b.origin_facility_id = f.id and b.status <> 'cancelled' ${dateParts("b.generated_at")}) as generated_batches,
          (select coalesce(sum(b.quantity),0)::float from waste_batches b where b.origin_facility_id = f.id and b.unit = 'kg' and b.status <> 'cancelled' ${dateParts("b.generated_at")}) as generated_kg,
          (select count(*)::int from receipt_records r join waste_batches b on b.id = r.batch_id where r.facility_id = f.id and r.accepted ${dateParts("r.received_at")}) as received_batches,
          (select count(*)::int from receipt_records r join waste_batches b on b.id = r.batch_id where r.facility_id = f.id and not r.accepted ${dateParts("r.received_at")}) as rejected_batches,
          (select count(*)::int from disposal_records d join waste_batches b on b.id = d.batch_id where d.facility_id = f.id ${dateParts("d.disposed_at")}) as disposed_batches
        from facilities f where f.organization_id = ${a.orgId} ${fFilter} ${scoped} order by f.name`);
    }
    case "transport_performance": {
      const parts: SQL[] = [sql`a.organization_id = ${a.orgId}`];
      if (a.role === "transporter") parts.push(sql`a.transporter_user_id = ${a.userId}`);
      if (a.role === "facility_staff") parts.push(a.facilityIds.length ? sql`(a.origin_facility_id in (${sql.join(a.facilityIds.map((i) => sql`${i}::uuid`), sql`, `)}) or (a.status in ('accepted','in_progress','completed') and a.destination_facility_id in (${sql.join(a.facilityIds.map((i) => sql`${i}::uuid`), sql`, `)})))` : sql`false`);
      if (q.from) parts.push(sql`a.scheduled_pickup_at >= ${q.from}`);
      if (q.to) parts.push(sql`a.scheduled_pickup_at <= ${q.to}`);
      if (q.transporterUserId) parts.push(sql`a.transporter_user_id = ${q.transporterUserId}`);
      if (q.facilityId) parts.push(sql`(a.origin_facility_id = ${q.facilityId} or a.destination_facility_id = ${q.facilityId})`);
      return rowsOf(sql`
        select a.reference, u.full_name as transporter, o.name as origin, d.name as destination, a.status,
          (select count(*)::int from assignment_batches ab where ab.assignment_id = a.id and ab.removed_at is null) as batches,
          a.scheduled_pickup_at, a.due_by, a.started_at, a.completed_at,
          case when a.completed_at is not null and a.started_at is not null then round(extract(epoch from (a.completed_at - a.started_at)) / 60)::int end as trip_minutes,
          case when a.completed_at is null then null when a.completed_at <= a.due_by then 'yes' else 'no' end as on_time
        from assignments a join users u on u.id = a.transporter_user_id join facilities o on o.id = a.origin_facility_id join facilities d on d.id = a.destination_facility_id
        where ${sql.join(parts, sql` and `)} order by a.scheduled_pickup_at desc ${LIMIT}`);
    }
    case "custody_history":
      return rowsOf(sql`
        select e.created_at, b.tracking_code, e.event_type, e.from_status, e.to_status, u.full_name as actor, f.name as facility,
          coalesce(tu.full_name, tf.name) as custodian, e.scan_method
        from custody_events e join waste_batches b on b.id = e.batch_id left join users u on u.id = e.actor_user_id
        left join facilities f on f.id = e.facility_id left join users tu on tu.id = e.to_custodian_user_id left join facilities tf on tf.id = e.to_custodian_facility_id
        where ${batchFilters({ ...q, status: undefined }, a, sql`e.created_at`)} order by e.created_at desc, e.id desc ${LIMIT}`);
    case "disposal":
      return rowsOf(sql`
        select dr.disposed_at, b.tracking_code, c.code as category, f.name as facility, dr.method, dr.treated_quantity, dr.unit, u.full_name as performed_by, dr.document_ref
        from disposal_records dr join waste_batches b on b.id = dr.batch_id join waste_categories c on c.id = b.category_id
        join facilities f on f.id = dr.facility_id join users u on u.id = dr.performed_by_id
        where ${batchFilters({ ...q, status: undefined, disposal: undefined }, a, sql`dr.disposed_at`)} order by dr.disposed_at desc ${LIMIT}`);
  }
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v).replaceAll("_", " ");
}

/** CSV with quoting and spreadsheet-formula neutralisation (CWE-1236). */
export function toCsv(columns: Column[], rows: Record<string, unknown>[]) {
  const cell = (v: unknown) => {
    let s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [columns.map((c) => cell(c.label)).join(","), ...rows.map((r) => columns.map((c) => cell(r[c.key])).join(","))].join("\r\n") + "\r\n";
}

route(router, base, { method: "get", path: "/reports", summary: "Run a report (format=json|csv|pdf). Always scoped to your organization and permissions.", tag: "Reports", access: "member", roles: ["admin", "facility_staff"], query: reportQuery, produces: "application/json, text/csv, application/pdf" }, async (ctx) => {
  const a = actorOf(ctx);
  const tz = await orgTimezone(a.orgId);
  const { from: rawFrom, to: rawTo, ...rest } = ctx.query;
  const q: ReportQuery = { ...rest, ...resolveRange({ from: rawFrom, to: rawTo }, tz) };
  const meta = reportMeta[q.type];
  const rows = await runReport(q, a);
  await audit({ organizationId: a.orgId, actorUserId: a.userId, action: "report.run", metadata: { type: q.type, format: q.format, rows: rows.length }, ip: a.ip });
  const stamp = new Date().toISOString().slice(0, 10);
  if (q.format === "csv") {
    ctx.res.setHeader("Content-Type", "text/csv; charset=utf-8");
    ctx.res.setHeader("Content-Disposition", `attachment; filename="bwts-${q.type}-${stamp}.csv"`);
    ctx.res.send("\uFEFF" + toCsv(meta.columns, rows)); // BOM so Excel opens UTF-8 correctly
    return HANDLED;
  }
  if (q.format === "pdf") {
    const [org] = await db.select({ name: organizations.name, timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, a.orgId));
    ctx.res.setHeader("Content-Type", "application/pdf");
    ctx.res.setHeader("Content-Disposition", `attachment; filename="bwts-${q.type}-${stamp}.pdf"`);
    renderPdf(ctx.res, { title: meta.title, orgName: org.name, timezone: org.timezone, q, columns: meta.columns, rows });
    return HANDLED;
  }
  return { type: q.type, title: meta.title, columns: meta.columns, rows, rowCount: rows.length };
});

function renderPdf(out: NodeJS.WritableStream, p: { title: string; orgName: string; timezone: string; q: ReportQuery; columns: Column[]; rows: Record<string, unknown>[] }) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true, info: { Title: p.title, Producer: "BWTS" } });
  doc.pipe(out);
  const green = "#059669";
  const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { timeZone: p.timezone, dateStyle: "medium" });
  const fmtDate = (d: unknown) => (d ? new Date(d as string).toLocaleString("en-GB", { timeZone: p.timezone, dateStyle: "medium", timeStyle: "short" }) : "");
  const header = () => {
    doc.rect(0, 0, doc.page.width, 6).fill(green);
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(16).text(p.title, 36, 24);
    doc.font("Helvetica").fontSize(9).fillColor("#475569").text(`${p.orgName}  ·  Generated ${fmtDate(new Date())} (${p.timezone})`, 36, 44);
  };
  header();
  const filters = [p.q.from && `From ${fmtDay(p.q.from)}`, p.q.to && `To ${fmtDay(p.q.to)}`, p.q.status && `Status ${p.q.status}`, p.q.disposal && `Disposal ${p.q.disposal}`, p.q.facilityId && "Facility filter", p.q.categoryId && "Category filter", p.q.transporterUserId && "Transporter filter"].filter(Boolean);
  doc.fontSize(9).fillColor("#475569").text(`Filters: ${filters.length ? filters.join(" · ") : "none"}   ·   Rows: ${p.rows.length}`, 36, 58);
  const totalW = p.columns.reduce((s, c) => s + (c.width ?? 80), 0);
  const scale = (doc.page.width - 72) / totalW;
  let y = 80;
  const drawHead = () => {
    let x = 36;
    doc.rect(36, y - 3, doc.page.width - 72, 18).fill("#ecfdf5");
    doc.fillColor("#065f46").font("Helvetica-Bold").fontSize(8);
    for (const c of p.columns) {
      doc.text(c.label, x + 3, y + 1, { width: (c.width ?? 80) * scale - 6, lineBreak: false, ellipsis: true });
      x += (c.width ?? 80) * scale;
    }
    y += 18;
  };
  drawHead();
  doc.font("Helvetica").fontSize(8);
  const shown = p.rows.slice(0, 2000);
  shown.forEach((r, i) => {
    if (y > doc.page.height - 50) {
      doc.addPage();
      header();
      y = 70;
      drawHead();
      doc.font("Helvetica").fontSize(8);
    }
    if (i % 2 === 1) doc.rect(36, y - 2, doc.page.width - 72, 15).fill("#f8fafc");
    let x = 36;
    doc.fillColor("#0f172a");
    for (const c of p.columns) {
      const raw = r[c.key];
      const v = /(_at|^due_by)$/.test(c.key) ? fmtDate(raw) : fmt(raw);
      doc.text(v, x + 3, y + 1, { width: (c.width ?? 80) * scale - 6, lineBreak: false, ellipsis: true });
      x += (c.width ?? 80) * scale;
    }
    y += 15;
  });
  if (p.rows.length > shown.length) doc.moveDown().text(`… ${p.rows.length - shown.length} more rows — export CSV for the full data set.`, 36, y + 6);
  if (!p.rows.length) doc.fillColor("#64748b").fontSize(10).text("No records match these filters.", 36, y + 10);
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.fontSize(7).fillColor("#94a3b8").text(
      `Generated by the Biomedical Waste Tracking System from recorded data. This report is not a regulatory certificate. Page ${i + 1} of ${range.count}`,
      36,
      doc.page.height - 28,
      { width: doc.page.width - 72, align: "center", lineBreak: false },
    );
  }
  doc.end();
}

export { alerts, assignments, gte, lte, wasteBatches };

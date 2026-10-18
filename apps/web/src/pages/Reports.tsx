import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Download, FileText } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, ErrorState, Field, Input, LoadingBlock, PageHeader, Panel, Select } from "../components/ui";
import { api, qs } from "../lib/api";
import { fmtDateTime, humanize } from "../lib/format";
import { useCategories, useFacilities, useMembers } from "../lib/queries";

const types = [
  { id: "batches", label: "Batch register", desc: "Every batch with route, status and disposal" },
  { id: "volume_by_category", label: "Volume by category", desc: "Quantities generated and disposed" },
  { id: "facility_activity", label: "Facility activity", desc: "Generated, received, rejected, disposed" },
  { id: "transport_performance", label: "Transport performance", desc: "Trips, durations and on-time delivery" },
  { id: "custody_history", label: "Custody history", desc: "Every recorded event and custodian" },
  { id: "incidents", label: "Incidents & delays", desc: "Reported incidents and delay alerts" },
  { id: "disposal", label: "Disposal records", desc: "Treatment method, quantity, plant reference" },
] as const;

interface Report {
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

const cell = (k: string, v: unknown) => {
  if (v === null || v === undefined || v === "") return <span className="text-ink-3">—</span>;
  if (/(_at|^due_by)$/.test(k)) return fmtDateTime(v as string);
  if (typeof v === "number") return <span className="tabular">{Number.isInteger(v) ? v : v.toFixed(2)}</span>;
  if (k === "tracking_code" || k === "reference") return <span className="font-mono">{String(v)}</span>;
  return humanize(String(v));
};

export default function Reports() {
  const [type, setType] = useState<(typeof types)[number]["id"]>("batches");
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [facilityId, setFacilityId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [transporterUserId, setTransporter] = useState("");
  const [disposal, setDisposal] = useState("");
  const facilities = useFacilities(true);
  const categories = useCategories();
  const transporters = useMembers("transporter");
  const params = {
    type,
    from: from ? new Date(from + "T00:00:00").toISOString() : "",
    to: to ? new Date(to + "T23:59:59").toISOString() : "",
    facilityId,
    categoryId,
    status,
    transporterUserId,
    disposal,
  };
  const q = useQuery({ queryKey: ["reports", params], queryFn: () => api.get<Report>(`/api/reports${qs(params)}`), placeholderData: (p) => p });
  const exportUrl = (format: "csv" | "pdf") => `/api/reports${qs({ ...params, format })}`;
  const chart =
    type === "volume_by_category" && q.data
      ? q.data.rows.map((r) => ({ name: `${r.code} (${r.unit})`, total: r.total_quantity as number, disposed: r.disposed_quantity as number }))
      : type === "facility_activity" && q.data
        ? q.data.rows.map((r) => ({ name: String(r.facility), total: r.generated_batches as number, disposed: r.disposed_batches as number }))
        : null;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Built from recorded data and limited to what you're allowed to see. Export to CSV for spreadsheets or PDF for sharing."
        actions={
          <>
            <a href={exportUrl("csv")} className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line-2 bg-paper px-4 text-sm font-semibold hover:border-emerald-600" download><Download className="size-4" /> CSV</a>
            <a href={exportUrl("pdf")} className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700" download><FileText className="size-4" /> PDF</a>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside className="flex flex-col gap-5">
          <nav aria-label="Report type" className="flex flex-col gap-1 rounded-[16px] border border-line bg-paper p-2">
            {types.map((t) => (
              <button key={t.id} onClick={() => setType(t.id)} aria-pressed={type === t.id} className={clsx("rounded-[10px] px-3 py-2.5 text-left transition-colors", type === t.id ? "bg-emerald-600 text-white" : "hover:bg-mist")}>
                <span className="block text-[14.5px] font-semibold">{t.label}</span>
                <span className={clsx("block text-[12.5px]", type === t.id ? "text-white/80" : "text-ink-3")}>{t.desc}</span>
              </button>
            ))}
          </nav>
          <div className="flex flex-col gap-3 rounded-[16px] border border-line bg-paper p-4">
            <div className="grid grid-cols-2 gap-2">
              <Field label="From" htmlFor="rf"><Input id="rf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="To" htmlFor="rt"><Input id="rt" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
            <Field label="Facility" htmlFor="rfa"><Select id="rfa" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}><option value="">All</option>{facilities.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
            <Field label="Category" htmlFor="rc"><Select id="rc" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">All</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</Select></Field>
            <Field label="Batch status" htmlFor="rs"><Select id="rs" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any</option>{["generated", "segregated", "collected", "in_transit", "delivered", "received", "disposed", "rejected", "cancelled"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
            <Field label="Disposal" htmlFor="rd"><Select id="rd" value={disposal} onChange={(e) => setDisposal(e.target.value)}><option value="">Any</option><option value="disposed">Disposed</option><option value="pending">Not yet disposed</option></Select></Field>
            <Field label="Transporter" htmlFor="rtr"><Select id="rtr" value={transporterUserId} onChange={(e) => setTransporter(e.target.value)}><option value="">Any</option>{transporters.data?.map((t) => <option key={t.userId} value={t.userId}>{t.fullName}</option>)}</Select></Field>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
          {chart && chart.length > 0 && (
            <Panel title={type === "volume_by_category" ? "Generated vs disposed quantity" : "Batches generated vs disposed"}>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#dfe7e2" />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#3c4a43" }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#6b7a72" }} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #dfe7e2", fontSize: 13 }} />
                    <Bar dataKey="total" name={type === "volume_by_category" ? "Generated" : "Generated batches"} fill="#059669" radius={[6, 6, 0, 0]} maxBarSize={36} />
                    <Bar dataKey="disposed" name="Disposed" fill="#0891b2" radius={[6, 6, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}
          <Panel title={q.data?.title ?? "Report"} actions={q.data && <span className="tabular text-[12.5px] text-ink-3">{q.data.rowCount} rows{q.data.rowCount > 200 ? " · first 200 shown, export for all" : ""}</span>} bodyClassName="p-0">
            {q.isLoading ? <div className="p-5"><LoadingBlock /></div> : q.isError ? <div className="p-5"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div> : q.data!.rows.length === 0 ? (
              <EmptyState title="No records for these filters">Try a wider date range.</EmptyState>
            ) : (
              <div className={clsx("overflow-x-auto", q.isFetching && "opacity-60")}>
                <table className="w-full text-sm">
                  <thead className="bg-mist text-left text-[12.5px] text-ink-3"><tr>{q.data!.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-4 py-2.5 font-semibold">{c.label}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {q.data!.rows.slice(0, 200).map((r, i) => (
                      <tr key={i}>{q.data!.columns.map((c) => <td key={c.key} className="max-w-[280px] truncate px-4 py-2.5">{cell(c.key, r[c.key])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

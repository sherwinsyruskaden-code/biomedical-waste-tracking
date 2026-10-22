import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { CheckCircle2, Circle, MapPinned, Plus, Radio, ScanLine, Truck } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { ActionDialog } from "../components/ActionDialog";
import { Badge, Button, CategoryChip, EmptyState, ErrorState, LoadingBlock, PageHeader, Panel, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { useCategories } from "../lib/queries";
import { assignmentMeta, eventLabel, fmtDateTime, fmtQty, humanize, timeAgo } from "../lib/format";
import { CountUp } from "../components/CountUp";
import { useActor, useWorkplace } from "../lib/session";
import type { AssignmentStatus, BatchListItem, Facility, Paged } from "../lib/types";

interface DashboardData {
  generatedAt: string;
  kpis: {
    inProgress: number;
    awaitingCollection: number;
    inTransit: number;
    awaitingReceipt: number;
    awaitingDisposal: number;
    rejected: number;
    disposedLast30Days: number;
    avgCycleHours: number | null;
    activeAssignments: number;
    assignmentsInProgress: number;
    overdueAssignments: number;
    trackingNow: number;
  };
  trend: { day: string; generated: number; generated_kg: number; disposed: number }[];
  byCategory: { code: string; name: string; color_hex: string; batches: number; kg: number }[];
  byFacility: { name: string; generated: number; awaiting: number; kg: number }[];
  recentEvents: { id: number; event_type: string; created_at: string; batch_id: string; tracking_code: string; actor_name: string | null; facility_name: string | null }[];
}

function SetupChecklist() {
  const [params] = useSearchParams();
  const facilities = useQuery({ queryKey: ["facilities"], queryFn: () => api.get<Facility[]>("/api/facilities") });
  const batches = useQuery({ queryKey: ["batches", "any"], queryFn: () => api.get<Paged<unknown>>("/api/batches?pageSize=1") });
  if (!facilities.data || !batches.data) return null;
  const steps = [
    { done: facilities.data.some((f) => f.type !== "treatment"), label: "Add a facility that generates waste", to: "/facilities" },
    { done: facilities.data.some((f) => f.canReceive), label: "Add a treatment facility that can receive waste", to: "/facilities" },
    { done: batches.data.total > 0, label: "Register your first waste batch", to: "/batches/new" },
  ];
  const remaining = steps.filter((s) => !s.done).length;
  if (remaining === 0 && !params.get("welcome")) return null;
  return (
    <section className="mb-6 overflow-hidden rounded-[18px] border border-emerald-200 bg-gradient-to-br from-emerald-50 to-paper" aria-label="Setup checklist">
      <div className="flex flex-col gap-5 p-5 md:flex-row md:items-center md:p-6">
        <div className="md:w-[260px]">
          <h2 className="text-[20px] font-bold">{remaining ? "Finish setting up" : "You're set up"}</h2>
          <p className="mt-1 text-sm text-ink-2">{remaining ? `${steps.length - remaining} of ${steps.length} done. These make the full workflow possible.` : "Everything is in place for the full workflow."}</p>
        </div>
        <ol className="grid flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.label}>
              <Link to={s.to} className={clsx("flex items-center gap-2.5 rounded-[12px] border bg-paper px-3 py-2.5 text-sm font-medium transition-colors", s.done ? "border-transparent text-ink-3 line-through decoration-ink-3/40" : "border-line hover:border-emerald-500")}>
                {s.done ? <CheckCircle2 className="size-[18px] shrink-0 text-emerald-600" /> : <Circle className="size-[18px] shrink-0 text-line-2" />}
                <span className="tabular mr-0.5 text-ink-3">{i + 1}.</span>
                {s.label}
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** The signature element: the custody pipeline with live counts at each stage. */
function Pipeline({ k, plant }: { k: DashboardData["kpis"]; plant?: boolean }) {
    const all = [
    { label: "Awaiting collection", value: k.awaitingCollection, to: "/batches?status=generated,segregated", hint: "generated or segregated", hospital: true },
    { label: "In transit", value: k.inTransit, to: plant ? "/receiving?tab=in_transit" : "/batches?status=collected,in_transit", hint: "collected or on the road", live: true },
    { label: "Arrived — awaiting receipt", value: k.awaitingReceipt, to: plant ? "/receiving?tab=delivered" : "/batches?status=delivered", hint: "at the plant" },
    { label: "Received", value: k.awaitingDisposal, to: plant ? "/receiving?tab=received" : "/batches?status=received", hint: "not yet treated" },
    { label: "Disposed", value: k.disposedLast30Days, to: plant ? "/batches?status=disposed" : "/batches?status=disposed", hint: "last 30 days", done: true },
  ];
  const stages = plant ? all.filter((s) => !s.hospital) : all;
  return (
    <section aria-label="Waste pipeline" className="rounded-[20px] border border-line bg-paper p-2">
      <ol className="grid grid-cols-2 gap-2 md:[grid-template-columns:repeat(var(--n),minmax(0,1fr))] md:gap-0" style={{ "--n": stages.length } as React.CSSProperties}>
        {stages.map((s, i) => (
          <li key={s.label} className="relative">
            <Link
              to={s.to}
              className={clsx(
                "group flex h-full flex-col justify-between gap-6 rounded-[14px] p-4 transition-colors md:rounded-none md:first:rounded-l-[14px] md:last:rounded-r-[14px]",
                s.done ? "bg-ink text-white hover:bg-emerald-900" : "bg-mist hover:bg-emerald-50",
              )}
            >
              <span className={clsx("flex items-center gap-2 text-[13px] font-semibold", s.done ? "text-white/70" : "text-ink-2")}>
                {s.live && s.value > 0 && (
                  <span className="relative grid size-2.5 place-items-center">
                    <span className="absolute inset-0 rounded-full bg-lime animate-pulse-ring" />
                    <span className="size-2.5 rounded-full bg-lime-deep" />
                  </span>
                )}
                {s.label}
              </span>
              <span>
                <span className={clsx("tabular block font-display text-[44px] font-extrabold leading-none tracking-tight", s.done ? "text-lime" : "text-ink")}><CountUp value={s.value} /></span>
                <span className={clsx("mt-1 block text-[12px]", s.done ? "text-white/60" : "text-ink-3")}>{s.hint}</span>
              </span>
            </Link>
            {i < stages.length - 1 && (
              <svg className="absolute -right-[9px] top-1/2 z-10 hidden size-[18px] -translate-y-1/2 md:block" viewBox="0 0 18 18" aria-hidden>
                <circle cx="9" cy="9" r="8" fill="white" stroke="#c9d5ce" />
                <path d="M7 5.5 10.5 9 7 12.5" stroke="#059669" strokeWidth="2" fill="none" strokeLinecap="round" />
              </svg>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Treatment-plant staff: what has arrived and is waiting for their confirmation. */
function PlantArrivals() {
  const [open, setOpen] = useState<BatchListItem | null>(null);
  const q = useQuery({ queryKey: ["batches", "arrivals"], queryFn: () => api.get<Paged<BatchListItem>>("/api/batches?status=delivered&pageSize=20&sort=oldest"), refetchInterval: 30_000 });
  const items = q.data?.items ?? [];
  const enRoute = useQuery({ queryKey: ["batches", "en-route"], queryFn: () => api.get<Paged<BatchListItem>>("/api/batches?status=collected,in_transit&pageSize=10&sort=oldest"), refetchInterval: 30_000 });
  return (
    <section aria-label="Arrivals awaiting receipt" className={clsx("mb-5 rounded-[18px] border-2 p-5", items.length ? "border-signal bg-signal-soft/40" : "border-line bg-paper")} data-testid="plant-arrivals">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[18px] font-bold"><Truck className="size-5 text-signal" /> Arrived — awaiting receipt {items.length > 0 && <Badge tone="warn">{q.data!.total}</Badge>}</h2>
        <div className="flex items-center gap-3">
          <Link to="/scan" className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-lime px-3 text-sm font-semibold text-ink hover:bg-[#b8e81f]"><ScanLine className="size-4" /> Scan Incoming Batch</Link>
          <Link to="/receiving" className="text-sm font-semibold text-emerald-700 hover:underline">All arrivals</Link>
        </div>
      </div>
      {q.isLoading ? <LoadingBlock rows={2} /> : items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">Nothing has arrived at your plant right now.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-[12px] bg-paper">
          {items.map((b) => (
            <li key={b.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 text-sm">
                <Link to={`/batches/${b.id}`} className="font-mono font-semibold hover:text-emerald-700">{b.trackingCode}</Link>
                <span className="ml-2 text-ink-3">arrived {fmtDateTime(b.statusChangedAt)}</span>
                <p className="text-ink-2">From {b.originName} · Transporter {b.transporterName ?? "—"} · <span className="tabular font-semibold text-ink">{fmtQty(b.quantity, b.unit)}</span> · <CategoryChip code={b.category.code} color={b.category.colorHex} compact /></p>
              </div>
              <Button onClick={() => setOpen(b)}>Confirm Receipt</Button>
            </li>
          ))}
        </ul>
      )}
      {(enRoute.data?.items.length ?? 0) > 0 && (
        <p className="mt-3 text-sm text-ink-2" data-testid="en-route">
          <strong>In transit ({enRoute.data!.total}):</strong>{" "}
          {enRoute.data!.items.map((b) => `${b.trackingCode} from ${b.originName}${b.transporterName ? ` with ${b.transporterName}` : ""}`).join(" · ")}
        </p>
      )}
      {open && <ActionDialog open action="receive" target={{ id: open.id, trackingCode: open.trackingCode, quantity: open.quantity, unit: open.unit }} onOpenChange={(o) => !o && setOpen(null)} onDone={() => q.refetch()} />}
    </section>
  );
}

/** Treatment-plant staff: batches that were received and still need their disposal recorded (method and time). */
function PlantDisposals() {
  const [open, setOpen] = useState<BatchListItem | null>(null);
  const categories = useCategories(); // the allowed treatment methods differ per category
  const q = useQuery({ queryKey: ["batches", "awaiting-disposal"], queryFn: () => api.get<Paged<BatchListItem>>("/api/batches?status=received&pageSize=20&sort=oldest"), refetchInterval: 30_000 });
  const items = q.data?.items ?? [];
  if (!q.isLoading && items.length === 0) return null;
  return (
    <section aria-label="Received, awaiting disposal" className="mb-5 rounded-[18px] border-2 border-emerald-300 bg-emerald-50/50 p-5" data-testid="plant-disposals">
      <h2 className="flex items-center gap-2 text-[18px] font-bold">Received — record disposal {items.length > 0 && <Badge tone="warn">{q.data!.total}</Badge>}</h2>
      <p className="mt-1 text-sm text-ink-2">Once the waste has been treated, record the method and the date and time it was disposed. Everyone involved sees it on the batch and is notified.</p>
      {q.isLoading ? <LoadingBlock rows={2} /> : (
        <ul className="mt-3 divide-y divide-line rounded-[12px] bg-paper">
          {items.map((b) => (
            <li key={b.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 text-sm">
                <Link to={`/batches/${b.id}`} className="font-mono font-semibold hover:text-emerald-700">{b.trackingCode}</Link>
                <span className="ml-2 text-ink-3">received {fmtDateTime(b.statusChangedAt)}</span>
                <p className="text-ink-2">From {b.originName} · <span className="tabular font-semibold text-ink">{fmtQty(b.quantity, b.unit)}</span> · <CategoryChip code={b.category.code} name={b.category.name} color={b.category.colorHex} compact /></p>
              </div>
              <Button onClick={() => setOpen(b)}>Record disposal</Button>
            </li>
          ))}
        </ul>
      )}
      {open && <ActionDialog open action="dispose" target={{ id: open.id, trackingCode: open.trackingCode, quantity: open.quantity, unit: open.unit, destinationFacilityId: open.destinationFacilityId, category: categories.data?.find((c) => c.id === open.category.id) }} onOpenChange={(o) => !o && setOpen(null)} />}
    </section>
  );
}

function TransporterHome() {
  const jobs = useQuery({ queryKey: ["assignments", "mine-active"], queryFn: () => api.get<Paged<{ id: string; reference: string; status: AssignmentStatus; originName: string; destinationName: string; dueBy: string; batchCount: number; trackingActive: boolean; scheduledPickupAt: string }>>("/api/assignments?status=assigned,accepted,in_progress&pageSize=50") });
  const { me } = useActor();
  return (
    <>
      <PageHeader title={`Hello, ${me.user.fullName.split(" ")[0]}`} description="Your active collections. Open one to accept it, scan at pickup and handover, and share your location." />
      {jobs.isLoading ? (
        <LoadingBlock />
      ) : jobs.isError ? (
        <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
      ) : jobs.data!.items.length === 0 ? (
        <Panel>
          <EmptyState icon={<Truck />} title="No active collections">When a hospital requests a collection from you it appears here and you'll get a notification.</EmptyState>
        </Panel>
      ) : (
        <div className="grid gap-3">
          {jobs.data!.items.map((j) => (
            <Link key={j.id} to={`/assignments/${j.id}`} className="lift flex flex-col gap-3 rounded-[16px] border border-line bg-paper p-5 hover:border-emerald-500 sm:flex-row sm:items-center">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-lg font-bold">{j.reference}</span>
                  <Badge tone={assignmentMeta[j.status].tone}>{assignmentMeta[j.status].label}</Badge>
                  {j.trackingActive && <Badge tone="lime"><Radio className="size-3" /> Sharing location</Badge>}
                </div>
                <p className="mt-1 text-ink-2">Origin: <strong className="text-ink">{j.originName}</strong> → Destination: <strong className="text-ink">{j.destinationName}</strong> · {j.batchCount} batch{j.batchCount === 1 ? "" : "es"}</p>
              </div>
              <div className="text-sm text-ink-2">
                Due <span className="font-semibold text-ink">{fmtDateTime(j.dueBy)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export default function Dashboard() {
  const { me, isAdmin, isTransporter } = useActor();
  const { atHospital, atPlant, name: workplace } = useWorkplace();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<DashboardData>("/api/dashboard"), refetchInterval: 60_000 });
  if (isTransporter) return <TransporterHome />;
  const d = q.data;
  return (
    <>
      <PageHeader
        title={!isAdmin && workplace ? workplace : me.organization?.name ?? "Dashboard"}
        description={d ? `Live from your records — refreshed ${timeAgo(d.generatedAt)}.` : "Loading the latest figures…"}
        actions={
          <>
            {(isAdmin || atPlant) && <Link to="/tracking" className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line-2 bg-paper px-4 text-sm font-semibold hover:border-emerald-600"><MapPinned className="size-4" /> Live map</Link>}
            {atPlant && !isAdmin && <Link to="/scan" className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-lime px-4 text-sm font-semibold text-ink hover:bg-[#b8e81f]"><ScanLine className="size-4" /> Scan Incoming Batch</Link>}
            {(isAdmin || atHospital) && <Link to="/batches/new" className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">
              <Plus className="size-4" /> Register batch
            </Link>}
          </>
        }
      />
      {atPlant && !isAdmin && <PlantArrivals />}
      {atPlant && !isAdmin && <PlantDisposals />}
      {isAdmin && <SetupChecklist />}
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <div className="grid gap-4">
          <Skeleton className="h-36" />
          <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Pipeline k={d.kpis} plant={atPlant && !isAdmin} />

          <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <Panel title="Last 14 days" actions={<span className="text-[12.5px] text-ink-3">kg generated (bars) · batches disposed (line)</span>}>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={d.trend.map((t) => ({ ...t, label: t.day.slice(5) }))} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#dfe7e2" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11.5, fill: "#6b7a72" }} interval="preserveStartEnd" />
                    <YAxis yAxisId="kg" tickLine={false} axisLine={false} tick={{ fontSize: 11.5, fill: "#6b7a72" }} allowDecimals={false} />
                    <YAxis yAxisId="n" orientation="right" hide allowDecimals={false} />
                    <Tooltip cursor={{ fill: "#ecfdf5" }} contentStyle={{ borderRadius: 12, border: "1px solid #dfe7e2", fontSize: 13 }} formatter={(v, name) => (name === "generated_kg" ? [`${v} kg`, "Generated"] : [v, "Disposed batches"])} />
                    <Bar yAxisId="kg" dataKey="generated_kg" fill="#059669" radius={[6, 6, 0, 0]} maxBarSize={28} />
                    <Line yAxisId="n" dataKey="disposed" stroke="#0891b2" strokeWidth={2.5} dot={{ r: 3, fill: "#0891b2" }} type="monotone" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Transport">
              {d.kpis.rejected > 0 && (
                <p className="mb-3 flex items-center justify-between rounded-[12px] bg-danger-soft/50 px-3 py-2.5 text-sm">
                  <Link to="/batches?status=rejected" className="font-medium hover:underline">Rejected deliveries to reroute</Link>
                  <Badge tone="danger">{d.kpis.rejected}</Badge>
                </p>
              )}
              <div className="grid grid-cols-3 gap-2 rounded-[12px] bg-mist p-3 text-center">
                <div><p className="tabular font-display text-2xl font-bold"><CountUp value={d.kpis.activeAssignments} /></p><p className="text-[12px] text-ink-3">active jobs</p></div>
                <div><p className="tabular font-display text-2xl font-bold text-signal-deep"><CountUp value={d.kpis.trackingNow} /></p><p className="text-[12px] text-ink-3">sharing GPS</p></div>
                <div><p className={clsx("tabular font-display text-2xl font-bold", d.kpis.overdueAssignments ? "text-danger" : "")}><CountUp value={d.kpis.overdueAssignments} /></p><p className="text-[12px] text-ink-3">past due</p></div>
              </div>
            </Panel>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
            <Panel title="By category, last 30 days" actions={<span className="text-[12.5px] text-ink-3">kg</span>}>
              {d.byCategory.every((c) => c.batches === 0) ? (
                <EmptyState title="No waste registered in the last 30 days" action={<Link to="/batches/new" className="text-sm font-semibold text-emerald-700">Register a batch</Link>} />
              ) : (
                <>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={d.byCategory} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="code" width={70} tickLine={false} axisLine={false} tick={{ fontSize: 12.5, fill: "#0e1b15", fontWeight: 600 }} />
                        <Tooltip cursor={{ fill: "#f2f6f3" }} contentStyle={{ borderRadius: 12, border: "1px solid #dfe7e2", fontSize: 13 }} formatter={(v) => [`${v} kg`, "Generated"]} />
                        <Bar dataKey="kg" radius={[0, 6, 6, 0]} maxBarSize={26}>
                          {d.byCategory.map((c) => <Cell key={c.code} fill={c.color_hex} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
                    {d.byCategory.map((c) => (
                      <li key={c.code} className="flex items-center justify-between gap-2">
                        <CategoryChip code={c.code} color={c.color_hex} compact />
                        <span className="tabular text-ink-2">{c.batches} batches</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>

            <Panel title="Recent custody events" bodyClassName="p-0">
              {d.recentEvents.length === 0 ? (
                <EmptyState title="No activity yet">Events appear here as batches are registered and handed over.</EmptyState>
              ) : (
                <ol className="divide-y divide-line">
                  {d.recentEvents.map((e) => (
                    <li key={e.id}>
                      <Link to={`/batches/${e.batch_id}`} className="flex items-start gap-3 px-5 py-3 hover:bg-mist">
                        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-emerald-600" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-semibold">{eventLabel[e.event_type] ?? humanize(e.event_type)}</span>
                          <span className="block truncate text-[13px] text-ink-2">
                            <span className="font-mono">{e.tracking_code}</span>
                            {e.actor_name && ` · ${e.actor_name}`}
                            {e.facility_name && ` · ${e.facility_name}`}
                          </span>
                        </span>
                        <span className="shrink-0 text-[12.5px] text-ink-3">{timeAgo(e.created_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>

          {d.byFacility.length > 0 && (
            <Panel title="Facilities, last 30 days" bodyClassName="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-mist text-left text-[12.5px] text-ink-3">
                  <tr><th className="px-5 py-2.5 font-semibold">Facility</th><th className="px-5 py-2.5 text-right font-semibold">Batches generated</th><th className="px-5 py-2.5 text-right font-semibold">kg</th><th className="px-5 py-2.5 text-right font-semibold">Awaiting collection</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.byFacility.map((f) => (
                    <tr key={f.name}>
                      <td className="px-5 py-3 font-medium">{f.name}</td>
                      <td className="tabular px-5 py-3 text-right">{f.generated}</td>
                      <td className="tabular px-5 py-3 text-right">{f.kg.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                      <td className="tabular px-5 py-3 text-right">{f.awaiting > 0 ? <Badge tone="warn">{f.awaiting}</Badge> : "0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
          {d.kpis.avgCycleHours !== null && (
            <p className="text-[13px] text-ink-3">Average time from generation to disposal over the last 30 days: <span className="tabular font-semibold text-ink-2">{d.kpis.avgCycleHours.toFixed(1)} h</span></p>
          )}
        </div>
      )}
    </>
  );
}

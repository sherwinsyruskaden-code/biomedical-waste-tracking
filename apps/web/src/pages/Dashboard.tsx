import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Circle, MapPinned, Plus, Radio, Truck } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { Badge, CategoryChip, EmptyState, ErrorState, LoadingBlock, PageHeader, Panel, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { assignmentMeta, eventLabel, fmtDateTime, humanize, timeAgo } from "../lib/format";
import { CountUp } from "../components/CountUp";
import { useActor, useWorkplace } from "../lib/session";
import type { AssignmentStatus, Facility, Member, Paged } from "../lib/types";

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
    openIncidents: number;
    openAlerts: number;
  };
  trend: { day: string; generated: number; generated_kg: number; disposed: number }[];
  byCategory: { code: string; name: string; color_hex: string; batches: number; kg: number }[];
  byFacility: { name: string; generated: number; awaiting: number; kg: number }[];
  alertsByType: { type: string; severity: string; n: number }[];
  recentEvents: { id: number; event_type: string; created_at: string; batch_id: string; tracking_code: string; actor_name: string | null; facility_name: string | null }[];
  openIncidents: { id: string; type: string; severity: string; description: string; createdAt: string; batchId: string | null }[];
}

function SetupChecklist() {
  const [params] = useSearchParams();
  const facilities = useQuery({ queryKey: ["facilities"], queryFn: () => api.get<Facility[]>("/api/facilities") });
  const members = useQuery({ queryKey: ["members"], queryFn: () => api.get<Member[]>("/api/members") });
  const batches = useQuery({ queryKey: ["batches", "any"], queryFn: () => api.get<Paged<unknown>>("/api/batches?pageSize=1") });
  if (!facilities.data || !members.data || !batches.data) return null;
  const steps = [
    { done: facilities.data.some((f) => f.type !== "treatment"), label: "Add a facility that generates waste", to: "/facilities" },
    { done: facilities.data.some((f) => f.canReceive), label: "Add a treatment facility that can receive waste", to: "/facilities" },
    { done: members.data.some((m) => m.role === "facility_staff"), label: "Invite facility staff", to: "/team" },
    { done: members.data.some((m) => m.role === "transporter"), label: "Invite a transporter", to: "/team" },
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
function Pipeline({ k }: { k: DashboardData["kpis"] }) {
  const stages = [
    { label: "Awaiting collection", value: k.awaitingCollection, to: "/batches?status=generated,segregated", hint: "generated or segregated" },
    { label: "On the road", value: k.inTransit, to: "/batches?status=collected,in_transit", hint: "collected or in transit", live: true },
    { label: "Awaiting receipt", value: k.awaitingReceipt, to: "/batches?status=delivered", hint: "handed over at the plant" },
    { label: "Awaiting disposal", value: k.awaitingDisposal, to: "/batches?status=received", hint: "received, not yet treated" },
    { label: "Disposed", value: k.disposedLast30Days, to: "/batches?status=disposed", hint: "last 30 days", done: true },
  ];
  return (
    <section aria-label="Waste pipeline" className="rounded-[20px] border border-line bg-paper p-2">
      <ol className="grid grid-cols-2 gap-2 md:grid-cols-5 md:gap-0">
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
            {atPlant && !isAdmin && <Link to="/receiving" className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">Incoming waste</Link>}
            {(isAdmin || atHospital) && <Link to="/batches/new" className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">
              <Plus className="size-4" /> Register batch
            </Link>}
          </>
        }
      />
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
          <Pipeline k={d.kpis} />

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

            <Panel title="Needs attention" actions={<Link to="/alerts" className="text-sm font-semibold text-emerald-700 hover:underline">All alerts</Link>}>
              {d.kpis.openAlerts === 0 && d.kpis.openIncidents === 0 && d.kpis.rejected === 0 ? (
                <EmptyState icon={<CheckCircle2 />} title="Nothing needs attention">No open alerts, incidents or rejected loads.</EmptyState>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {d.kpis.rejected > 0 && (
                    <li className="flex items-center justify-between py-2.5">
                      <Link to="/batches?status=rejected" className="font-medium hover:underline">Rejected deliveries to reroute</Link>
                      <Badge tone="danger">{d.kpis.rejected}</Badge>
                    </li>
                  )}
                  {d.alertsByType
                    .reduce<{ type: string; n: number; sev: string }[]>((acc, r) => {
                      const ex = acc.find((x) => x.type === r.type);
                      if (ex) ex.n += r.n;
                      else acc.push({ type: r.type, n: r.n, sev: r.severity });
                      return acc;
                    }, [])
                    .map((r) => (
                      <li key={r.type} className="flex items-center justify-between py-2.5">
                        <Link to="/alerts" className="flex items-center gap-2 font-medium hover:underline">
                          <AlertTriangle className={clsx("size-4", r.sev === "high" || r.sev === "critical" ? "text-danger" : "text-warn")} />
                          {humanize(r.type)}
                        </Link>
                        <Badge tone={r.sev === "high" || r.sev === "critical" ? "danger" : "warn"}>{r.n}</Badge>
                      </li>
                    ))}
                  {d.openIncidents.map((i) => (
                    <li key={i.id} className="py-2.5">
                      <Link to={i.batchId ? `/batches/${i.batchId}` : "/alerts?tab=incidents"} className="block hover:underline">
                        <span className="font-medium">{humanize(i.type)}</span> <span className="text-ink-3">· {timeAgo(i.createdAt)}</span>
                        <span className="block truncate text-sm text-ink-2">{i.description}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 grid grid-cols-3 gap-2 rounded-[12px] bg-mist p-3 text-center">
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

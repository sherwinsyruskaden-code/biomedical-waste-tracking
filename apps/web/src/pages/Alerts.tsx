import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bell, CheckCheck, ShieldAlert, Siren } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { IncidentDialog } from "../components/IncidentDialog";
import { Badge, Button, EmptyState, ErrorState, Field, FormError, LoadingBlock, Modal, PageHeader, Pagination, Textarea } from "../components/ui";
import { api, qs } from "../lib/api";
import { fmtDateTime, humanize, timeAgo } from "../lib/format";
import { useActor } from "../lib/session";
import type { Incident, Paged } from "../lib/types";

interface Alert {
  id: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  message: string;
  status: "open" | "resolved";
  batchId: string | null;
  assignmentId: string | null;
  trackingCode: string | null;
  reference: string | null;
  createdAt: string;
  resolvedAt: string | null;
  autoResolved: boolean;
}
interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const sevTone = (s: string) => (s === "critical" || s === "high" ? "danger" : s === "medium" ? "warn" : "neutral") as "danger" | "warn" | "neutral";

function AlertsTab() {
  const qc = useQueryClient();
  const { isTransporter } = useActor();
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["alerts", status, page], queryFn: () => api.get<Paged<Alert>>(`/api/alerts${qs({ status, page, pageSize: 25 })}`) });
  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/api/alerts/${id}/resolve`),
    onSuccess: () => { toast.success("Alert resolved"); qc.invalidateQueries({ queryKey: ["alerts"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); },
  });
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-[10px] bg-mist p-1">
          {(["open", "resolved"] as const).map((s) => (
            <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={clsx("rounded-[8px] px-3 py-1 text-sm font-semibold", status === s ? "bg-paper shadow-sm" : "text-ink-3")}>{humanize(s)}</button>
          ))}
        </div>
        <p className="hidden text-[12.5px] text-ink-3 md:block">Thresholds are set by your admin in Settings. Alerts are operational signals, not findings of a regulatory breach.</p>
      </div>
      <div className="overflow-hidden rounded-[16px] border border-line bg-paper">
        {q.isLoading ? <div className="p-5"><LoadingBlock /></div> : q.isError ? <div className="p-5"><ErrorState error={q.error} /></div> : q.data!.items.length === 0 ? (
          <EmptyState icon={<ShieldAlert />} title={status === "open" ? "No open alerts" : "No resolved alerts yet"}>{status === "open" ? "Overdue collections, delays, stale GPS and rejected deliveries will show up here." : undefined}</EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((a) => (
                <li key={a.id} className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-center">
                  <span className={clsx("hidden size-2.5 shrink-0 rounded-full md:block", sevTone(a.severity) === "danger" ? "bg-danger" : sevTone(a.severity) === "warn" ? "bg-warn" : "bg-ink-3")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{a.title}</p>
                      <Badge tone={sevTone(a.severity)}>{a.severity}</Badge>
                      {a.autoResolved && <Badge tone="emerald">Cleared automatically</Badge>}
                    </div>
                    <p className="text-sm text-ink-2">{a.message}</p>
                    <p className="mt-1 text-[12.5px] text-ink-3">
                      {fmtDateTime(a.createdAt)}
                      {a.batchId && <> · <Link to={`/batches/${a.batchId}`} className="font-mono font-semibold text-emerald-700">{a.trackingCode}</Link></>}
                      {a.assignmentId && <> · <Link to={`/assignments/${a.assignmentId}`} className="font-mono font-semibold text-emerald-700">{a.reference}</Link></>}
                    </p>
                  </div>
                  {a.status === "open" && !isTransporter && <Button variant="secondary" size="sm" onClick={() => resolve.mutate(a.id)} loading={resolve.isPending && resolve.variables === a.id}>Mark resolved</Button>}
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={25} total={q.data!.total} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}

function IncidentsTab() {
  const qc = useQueryClient();
  const { isTransporter } = useActor();
  const [status, setStatus] = useState<"open" | "resolved" | "">("open");
  const [page, setPage] = useState(1);
  const [reporting, setReporting] = useState(false);
  const [resolving, setResolving] = useState<Incident | null>(null);
  const [notes, setNotes] = useState("");
  const q = useQuery({ queryKey: ["incidents", status, page], queryFn: () => api.get<Paged<Incident>>(`/api/incidents${qs({ status, page, pageSize: 25 })}`) });
  const resolve = useMutation({
    mutationFn: () => api.post(`/api/incidents/${resolving!.id}/resolve`, { resolutionNotes: notes }),
    onSuccess: () => { toast.success("Incident resolved"); setResolving(null); setNotes(""); for (const k of ["incidents", "alerts", "dashboard", "batch"]) qc.invalidateQueries({ queryKey: [k] }); },
  });
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-[10px] bg-mist p-1">
          {([["open", "Open"], ["resolved", "Resolved"], ["", "All"]] as const).map(([s, l]) => (
            <button key={l} onClick={() => { setStatus(s); setPage(1); }} className={clsx("rounded-[8px] px-3 py-1 text-sm font-semibold", status === s ? "bg-paper shadow-sm" : "text-ink-3")}>{l}</button>
          ))}
        </div>
        <Button variant="secondary" onClick={() => setReporting(true)} icon={<Siren className="size-4" />}>Report incident</Button>
      </div>
      <div className="overflow-hidden rounded-[16px] border border-line bg-paper">
        {q.isLoading ? <div className="p-5"><LoadingBlock /></div> : q.isError ? <div className="p-5"><ErrorState error={q.error} /></div> : q.data!.items.length === 0 ? (
          <EmptyState icon={<Siren />} title="No incidents">Spills, leaks, damaged containers and weight mismatches are listed here.</EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((i) => (
                <li key={i.id} className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{humanize(i.type)}</p>
                      <Badge tone={sevTone(i.severity)}>{i.severity}</Badge>
                      <Badge tone={i.status === "open" ? "warn" : "emerald"}>{i.status}</Badge>
                    </div>
                    <p className="text-sm text-ink-2">{i.description}</p>
                    <p className="mt-1 text-[12.5px] text-ink-3">
                      {fmtDateTime(i.createdAt)}{i.reportedBy && ` · reported by ${i.reportedBy}`}
                      {i.batchId && <> · <Link to={`/batches/${i.batchId}`} className="font-mono font-semibold text-emerald-700">{i.trackingCode}</Link></>}
                    </p>
                    {i.resolutionNotes && <p className="mt-2 rounded-[10px] bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><strong>Resolution:</strong> {i.resolutionNotes}</p>}
                  </div>
                  {i.status === "open" && !isTransporter && <Button variant="secondary" size="sm" onClick={() => setResolving(i)}>Resolve</Button>}
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={25} total={q.data!.total} onPage={setPage} />
          </>
        )}
      </div>
      {reporting && <IncidentDialog open onOpenChange={setReporting} context="Not linked to a batch — open a batch to link one." />}
      <Modal open={!!resolving} onOpenChange={(o) => !o && setResolving(null)} title="Resolve incident" description={resolving ? humanize(resolving.type) : undefined}>
        <form onSubmit={(e) => { e.preventDefault(); resolve.mutate(); }} className="flex flex-col gap-4">
          <Field label="What was done" htmlFor="rn" required><Textarea id="rn" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <FormError error={resolve.error} />
          <div className="flex justify-end"><Button type="submit" loading={resolve.isPending} disabled={notes.trim().length < 3}>Resolve incident</Button></div>
        </form>
      </Modal>
    </>
  );
}

function NotificationsTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["notifications", "list", page], queryFn: () => api.get<Paged<Notification> & { unread: number }>(`/api/notifications${qs({ page, pageSize: 30 })}`) });
  const read = useMutation({ mutationFn: (ids?: string[]) => api.post("/api/notifications/read", { ids }), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="secondary" onClick={() => read.mutate(undefined)} disabled={!q.data?.unread} icon={<CheckCheck className="size-4" />}>Mark all read</Button>
      </div>
      <div className="overflow-hidden rounded-[16px] border border-line bg-paper">
        {q.isLoading ? <div className="p-5"><LoadingBlock /></div> : q.isError ? <div className="p-5"><ErrorState error={q.error} /></div> : q.data!.items.length === 0 ? (
          <EmptyState icon={<Bell />} title="No notifications">You'll be notified about jobs, handovers and alerts that concern you.</EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((n) => {
                const body = (
                  <>
                    <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-emerald-600")} aria-label={n.readAt ? undefined : "Unread"} />
                    <span className="min-w-0 flex-1">
                      <span className={clsx("block", !n.readAt && "font-semibold")}>{n.title}</span>
                      <span className="block text-sm text-ink-2">{n.body}</span>
                    </span>
                    <span className="shrink-0 text-[12.5px] text-ink-3">{timeAgo(n.createdAt)}</span>
                  </>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link to={n.link} onClick={() => !n.readAt && read.mutate([n.id])} className="flex gap-3 px-5 py-3.5 hover:bg-mist">{body}</Link>
                    ) : (
                      <button onClick={() => !n.readAt && read.mutate([n.id])} className="flex w-full gap-3 px-5 py-3.5 text-left hover:bg-mist">{body}</button>
                    )}
                  </li>
                );
              })}
            </ul>
            <Pagination page={page} pageSize={30} total={q.data!.total} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}

export default function Alerts() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "alerts";
  const tabs: [string, string][] = [["alerts", "Alerts"], ["incidents", "Incidents"], ["notifications", "Notifications"]];
  return (
    <>
      <PageHeader title="Alerts & incidents" description="What needs a person's attention, what went wrong, and what you've been told about." />
      <div className="mb-5 flex w-fit gap-1 rounded-[12px] bg-paper p-1 ring-1 ring-line" role="tablist">
        {tabs.map(([v, l]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setParams({ tab: v })} className={clsx("rounded-[9px] px-3.5 py-1.5 text-sm font-semibold", tab === v ? "bg-emerald-600 text-white" : "text-ink-2 hover:bg-mist")}>{l}</button>
        ))}
      </div>
      {tab === "alerts" && <AlertsTab />}
      {tab === "incidents" && <IncidentsTab />}
      {tab === "notifications" && <NotificationsTab />}
    </>
  );
}

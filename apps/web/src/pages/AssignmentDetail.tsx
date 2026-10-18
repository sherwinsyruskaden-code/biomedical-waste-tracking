import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertOctagon, ArrowLeft, CheckCircle2, FlaskConical, MapPin, Navigation, Phone, Radio, ScanLine, Truck } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { ActionDialog, type ActionTarget } from "../components/ActionDialog";
import { IncidentDialog } from "../components/IncidentDialog";
import { Badge, Button, CategoryChip, ErrorState, Field, FormError, LoadingBlock, Modal, Panel, Select, StatusBadge, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { assignmentMeta, fmtDateTime, fmtQty, fmtTime, timeAgo } from "../lib/format";
import { useMembers } from "../lib/queries";
import { onLiveLocation, useActor } from "../lib/session";
import { useGeoTracking } from "../lib/useGeoTracking";
import type { Assignment, BatchStatus, Facility, LocationPoint } from "../lib/types";

const TrackingMapLazy = lazy(() => import("../components/TrackingMap").then((m) => ({ default: m.TrackingMap })));

interface Detail extends Assignment {
  transporter: { id: string; fullName: string; phone: string | null };
  origin: Facility;
  destination: Facility;
  batches: { id: string; trackingCode: string; status: BatchStatus; quantity: number; unit: string; containerCount: number; category: { name: string; colorHex: string; code: string } }[];
  latestLocation: (LocationPoint & { recordedAt: string }) | null;
  locationPointCount: number;
  isMine: boolean;
}

function SharePanel({ a, onChange }: { a: Detail; onChange: () => void }) {
  const qc = useQueryClient();
  const [sharing, setSharing] = useState(a.trackingActive);
  useEffect(() => setSharing(a.trackingActive), [a.trackingActive]);
  const stop = useCallback(() => setSharing(false), []);
  const geo = useGeoTracking(a.id, sharing, stop);
  const toggle = useMutation({
    mutationFn: (active: boolean) => api.put(`/api/assignments/${a.id}/tracking`, { active }),
    onSuccess: (_d, active) => {
      toast.success(active ? "Location sharing on" : "Location sharing off");
      qc.invalidateQueries({ queryKey: ["assignment", a.id] });
      onChange();
    },
    onError: () => setSharing(a.trackingActive),
  });
  const canShare = a.status === "accepted" || a.status === "in_progress";
  const start = () => {
    setSharing(true);
    toggle.mutate(true);
  };
  const end = () => {
    setSharing(false); // flush queued fixes while the server still accepts them…
    window.setTimeout(() => toggle.mutate(false), 600); // …then switch sharing off
  };
  return (
    <section className={clsx("rounded-[18px] border-2 p-5", sharing ? "border-signal bg-signal-soft/40" : "border-line bg-paper")} aria-label="Location sharing">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[18px] font-bold">
            <Navigation className={clsx("size-5", sharing ? "text-signal" : "text-ink-3")} />
            {sharing ? "Sharing your location" : "Location sharing is off"}
          </h2>
          <p className="mt-1 max-w-[52ch] text-sm text-ink-2">
            {canShare
              ? "Only while this job is active. Your organization sees your phone's position on the live map; it stops automatically when the job ends. Keep this page open while driving."
              : "Available once you've accepted the job."}
          </p>
        </div>
        {canShare && (sharing ? <Button variant="secondary" onClick={end} loading={toggle.isPending}>Stop sharing</Button> : <Button variant="scan" onClick={start} loading={toggle.isPending} icon={<Radio className="size-4" />}>Start sharing</Button>)}
      </div>
      {sharing && (
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-[12px] bg-paper p-3 text-sm sm:grid-cols-4">
          <div><dt className="text-[12px] text-ink-3">GPS</dt><dd className="font-semibold">{{ off: "Off", starting: "Starting…", active: "Receiving fixes", denied: "Permission denied", unavailable: "Unavailable", error: "No signal" }[geo.state]}</dd></div>
          <div><dt className="text-[12px] text-ink-3">Last fix</dt><dd className="font-semibold">{geo.lastFix ? fmtTime(geo.lastFix.recordedAt) : "—"}</dd></div>
          <div><dt className="text-[12px] text-ink-3">Accuracy</dt><dd className={clsx("font-semibold", geo.lastFix?.accuracy != null && geo.lastFix.accuracy > 100 && "text-warn")}>{geo.lastFix?.accuracy != null ? `±${Math.round(geo.lastFix.accuracy)} m` : "—"}</dd></div>
          <div><dt className="text-[12px] text-ink-3">Sent</dt><dd className="font-semibold">{geo.lastSentAt ? timeAgo(geo.lastSentAt) : "not yet"}{geo.queued > 0 && <span className="text-warn"> · {geo.queued} queued</span>}</dd></div>
        </dl>
      )}
      {geo.message && <p className="mt-3 text-sm font-semibold text-[#92400e]" role="status">{geo.message}</p>}
    </section>
  );
}

export default function AssignmentDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { isAdmin, me } = useActor();
  const q = useQuery({ queryKey: ["assignment", id], queryFn: () => api.get<Detail>(`/api/assignments/${id}`) });
  const history = useQuery({ queryKey: ["tracking", "history", id], queryFn: () => api.get<LocationPoint[]>(`/api/assignments/${id}/locations?limit=2000`), enabled: !!q.data });
  const [livePoint, setLivePoint] = useState<LocationPoint | null>(null);
  const [tail, setTail] = useState<LocationPoint[]>([]);
  useEffect(() => onLiveLocation((e) => { if (e.assignmentId === id) { setLivePoint(e.point); setTail((t) => [...t, e.point]); } }), [id]);
  const [dialog, setDialog] = useState<{ action: "pickup" | "handover"; target: ActionTarget } | null>(null);
  const [reasonFor, setReasonFor] = useState<"decline" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [incident, setIncident] = useState(false);
  const [reassign, setReassign] = useState(false);
  const refresh = () => {
    for (const k of ["assignment", "assignments", "batches", "batch", "dashboard", "tracking"]) qc.invalidateQueries({ queryKey: [k] });
  };
  const act = useMutation({
    mutationFn: ({ action, reason }: { action: "accept" | "start" | "decline" | "cancel"; reason?: string }) => api.post(`/api/assignments/${id}/${action}`, { reason }),
    onSuccess: (_d, v) => {
      toast.success({ accept: "Job accepted", start: "Trip started — drive safely", decline: "Job declined", cancel: "Job cancelled" }[v.action]);
      setReasonFor(null);
      setReason("");
      refresh();
    },
  });
  const sim = useMutation({
    mutationFn: (run: boolean) => api.post<{ running: boolean }>(`/api/demo/assignments/${id}/simulate`, { run }),
    onSuccess: (r) => toast(r.running ? "Simulated trip running" : "Simulation stopped", { description: r.running ? "Positions are stored and shown as SIMULATED." : undefined }),
  });
  const transporters = useMembers("transporter");
  const [newTransporter, setNewTransporter] = useState("");
  const reassignM = useMutation({
    mutationFn: () => api.patch(`/api/assignments/${id}`, { transporterUserId: newTransporter }),
    onSuccess: () => { toast.success("Transporter changed"); setReassign(false); refresh(); },
  });
  const removeBatch = useMutation({
    mutationFn: (batchId: string) => api.patch(`/api/assignments/${id}`, { removeBatchIds: [batchId] }),
    onSuccess: () => { toast.success("Batch removed from job"); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (q.isLoading) return <LoadingBlock rows={8} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data!;
  const meta = assignmentMeta[a.status];
  const latest = livePoint ?? a.latestLocation;
  const pickedAll = a.batches.every((b) => b.status !== "segregated");
  const steps = [
    { label: "Accept the job", done: a.status !== "assigned" },
    { label: "Scan every container at pickup", done: pickedAll && a.status !== "assigned" },
    { label: "Share location and start the trip", done: a.status === "in_progress" || a.status === "completed" },
    { label: "Scan at the destination to hand over", done: a.status === "completed" },
  ];
  const open = a.status !== "completed" && a.status !== "cancelled";

  return (
    <>
      <Link to="/assignments" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-emerald-700"><ArrowLeft className="size-4" /> Jobs</Link>
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-[28px] font-bold">{a.reference}</h1>
            <Badge tone={meta.tone} dot>{meta.label}</Badge>
            {a.trackingActive && <Badge tone="lime"><Radio className="size-3" /> Location shared</Badge>}
          </div>
          <p className="mt-2 text-ink-2"><strong className="text-ink">{a.origin.name}</strong> to <strong className="text-ink">{a.destination.name}</strong> · due {fmtDateTime(a.dueBy)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {a.isMine && a.status === "assigned" && <Button onClick={() => act.mutate({ action: "accept" })} loading={act.isPending}>Accept job</Button>}
          {a.isMine && a.status === "accepted" && <Button onClick={() => act.mutate({ action: "start" })} loading={act.isPending} disabled={!pickedAll} title={pickedAll ? undefined : "Pick up every batch first"}>Start trip</Button>}
          {a.isMine && (a.status === "assigned" || a.status === "accepted") && <Button variant="secondary" onClick={() => setReasonFor("decline")}>Decline</Button>}
          {isAdmin && (a.status === "assigned" || a.status === "accepted") && <Button variant="secondary" onClick={() => setReassign(true)}>Change transporter</Button>}
          {isAdmin && open && <Button variant="danger" onClick={() => setReasonFor("cancel")}>Cancel job</Button>}
          {open && <Button variant="ghost" onClick={() => setIncident(true)} icon={<AlertOctagon className="size-4" />}>Report incident</Button>}
        </div>
      </header>
      {act.error && <div className="mb-4"><FormError error={act.error} /></div>}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-5">
          {a.isMine && open && (
            <ol className="grid gap-2 sm:grid-cols-4" aria-label="Job steps">
              {steps.map((s, i) => (
                <li key={s.label} className={clsx("flex items-start gap-2 rounded-[14px] border p-3 text-sm", s.done ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-line bg-paper")}>
                  {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <span className="tabular mt-px grid size-[18px] shrink-0 place-items-center rounded-full bg-mist text-[11px] font-bold">{i + 1}</span>}
                  <span className="font-medium">{s.label}</span>
                </li>
              ))}
            </ol>
          )}
          {a.isMine && <SharePanel a={a} onChange={refresh} />}

          <Panel title="Batches on this job" bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {a.batches.map((b) => {
                const target: ActionTarget = { id: b.id, trackingCode: b.trackingCode, quantity: b.quantity, unit: b.unit };
                const canPickup = a.isMine && a.status === "accepted" && b.status === "segregated";
                const canHandover = (a.isMine || isAdmin) && a.status === "in_progress" && b.status === "in_transit";
                return (
                  <li key={b.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/batches/${b.id}`} className="font-mono font-semibold hover:text-emerald-700">{b.trackingCode}</Link>
                        <StatusBadge status={b.status} />
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-ink-2">
                        <CategoryChip code={b.category.code} color={b.category.colorHex} compact />
                        <span className="tabular">{fmtQty(b.quantity, b.unit)}</span>
                        <span>{b.containerCount} container{b.containerCount > 1 ? "s" : ""}</span>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {canPickup && <Button onClick={() => setDialog({ action: "pickup", target })} icon={<ScanLine className="size-4" />}>Scan pickup</Button>}
                      {canHandover && <Button onClick={() => setDialog({ action: "handover", target })} icon={<ScanLine className="size-4" />}>Scan handover</Button>}
                      {isAdmin && b.status === "segregated" && (a.status === "assigned" || a.status === "accepted") && a.batches.length > 1 && (
                        <Button variant="ghost" size="sm" onClick={() => removeBatch.mutate(b.id)} loading={removeBatch.isPending}>Remove</Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Recorded positions" actions={<span className="text-[12.5px] text-ink-3">{(history.data?.length ?? 0) + tail.length} points</span>} bodyClassName="p-1.5">
            <Suspense fallback={<LoadingBlock rows={4} />}>
              <TrackingMapLazy
                facilities={[a.origin, a.destination]}
                vehicles={latest ? [{ assignmentId: a.id, label: `${a.reference} — ${a.transporter.fullName}`, point: latest as LocationPoint, stale: Date.now() - new Date(latest.recordedAt).getTime() > 5 * 60_000 || !open }] : []}
                history={[...(history.data ?? []), ...tail]}
                className="h-[380px] w-full rounded-[14px]"
                fitKey={`${a.id}|${history.data?.length ?? 0}`}
              />
            </Suspense>
            {!latest && <p className="px-3 py-2 text-sm text-ink-3">No positions recorded for this job yet.</p>}
          </Panel>
        </div>

        <aside className="flex flex-col gap-5">
          <Panel title="Job details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
              <dt className="text-ink-3">Transporter</dt>
              <dd className="font-semibold">{a.transporter.fullName}{a.transporter.id === me.user.id && " (you)"}</dd>
              {a.transporter.phone && <><dt className="text-ink-3">Phone</dt><dd><a href={`tel:${a.transporter.phone}`} className="inline-flex items-center gap-1 text-emerald-700"><Phone className="size-3.5" />{a.transporter.phone}</a></dd></>}
              {a.vehicleReg && <><dt className="text-ink-3">Vehicle</dt><dd className="font-mono">{a.vehicleReg}</dd></>}
              <dt className="text-ink-3">Pickup</dt><dd>{fmtDateTime(a.scheduledPickupAt)}</dd>
              <dt className="text-ink-3">Due</dt><dd className={clsx(open && new Date(a.dueBy) < new Date() && "font-semibold text-danger")}>{fmtDateTime(a.dueBy)}</dd>
              {a.acceptedAt && <><dt className="text-ink-3">Accepted</dt><dd>{fmtDateTime(a.acceptedAt)}</dd></>}
              {a.startedAt && <><dt className="text-ink-3">Started</dt><dd>{fmtDateTime(a.startedAt)}</dd></>}
              {a.completedAt && <><dt className="text-ink-3">Completed</dt><dd>{fmtDateTime(a.completedAt)}</dd></>}
              {a.cancelReason && <><dt className="text-ink-3">Cancelled</dt><dd>{a.cancelReason}</dd></>}
              <dt className="text-ink-3">Last position</dt><dd>{latest ? `${timeAgo(latest.recordedAt)}${latest.source === "simulated" ? " (simulated)" : ""}` : "None"}</dd>
            </dl>
            {a.notes && <p className="mt-4 rounded-[10px] bg-mist px-3 py-2 text-sm text-ink-2">{a.notes}</p>}
          </Panel>
          <Panel title="Destination">
            <p className="font-semibold">{a.destination.name}</p>
            <p className="text-sm text-ink-2">{a.destination.address}{a.destination.city ? `, ${a.destination.city}` : ""}</p>
            {a.destination.contactPhone && <a href={`tel:${a.destination.contactPhone}`} className="mt-1 inline-flex items-center gap-1 text-sm text-emerald-700"><Phone className="size-3.5" /> {a.destination.contactName ?? "Contact"} {a.destination.contactPhone}</a>}
            {a.destination.latitude != null && (
              <a className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-emerald-700" href={`https://www.google.com/maps/dir/?api=1&destination=${a.destination.latitude},${a.destination.longitude}`} target="_blank" rel="noreferrer">
                <MapPin className="size-4" /> Directions in maps app
              </a>
            )}
          </Panel>
          {isAdmin && me.features.demoMode && open && (
            <Panel title="Demo mode">
              <p className="text-sm text-ink-2">Generate positions moving toward the destination, stored and displayed as <strong>simulated</strong>. Use only for demonstrations without a phone on the road.</p>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={() => sim.mutate(true)} loading={sim.isPending} icon={<FlaskConical className="size-4" />}>Run simulated trip</Button>
                <Button variant="ghost" onClick={() => sim.mutate(false)}>Stop</Button>
              </div>
              <FormError error={sim.error} />
            </Panel>
          )}
        </aside>
      </div>

      {dialog && <ActionDialog open action={dialog.action} target={dialog.target} onOpenChange={(o) => !o && setDialog(null)} onDone={refresh} />}
      {incident && <IncidentDialog open onOpenChange={setIncident} assignmentId={a.id} context={`Job ${a.reference}`} />}
      <Modal open={!!reasonFor} onOpenChange={(o) => !o && setReasonFor(null)} title={reasonFor === "decline" ? "Decline this job" : "Cancel this job"} description="The batches go back to the facility's queue.">
        <form onSubmit={(e) => { e.preventDefault(); act.mutate({ action: reasonFor!, reason }); }} className="flex flex-col gap-4">
          <Field label="Reason" htmlFor="rr" required><Textarea id="rr" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <FormError error={act.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setReasonFor(null)}>Keep job</Button>
            <Button type="submit" variant="danger" loading={act.isPending} disabled={reason.trim().length < 3}>{reasonFor === "decline" ? "Decline job" : "Cancel job"}</Button>
          </div>
        </form>
      </Modal>
      <Modal open={reassign} onOpenChange={setReassign} title="Change transporter" description="Only possible before anything is picked up. The new transporter must accept.">
        <form onSubmit={(e) => { e.preventDefault(); reassignM.mutate(); }} className="flex flex-col gap-4">
          <Field label="Transporter" htmlFor="nt">
            <Select id="nt" value={newTransporter} onChange={(e) => setNewTransporter(e.target.value)}>
              <option value="">Choose…</option>
              {transporters.data?.filter((t) => t.status === "active" && t.userId !== a.transporterUserId).map((t) => <option key={t.userId} value={t.userId}>{t.fullName}</option>)}
            </Select>
          </Field>
          <FormError error={reassignM.error} />
          <div className="flex justify-end"><Button type="submit" loading={reassignM.isPending} disabled={!newTransporter} icon={<Truck className="size-4" />}>Reassign</Button></div>
        </form>
      </Modal>
    </>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertOctagon, ArrowLeft, Ban, FlaskConical, MapPin, Pencil, Printer, Radio, ScanLine, Send, Truck } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { ActionDialog } from "../components/ActionDialog";
import { IncidentDialog } from "../components/IncidentDialog";
import { toast } from "sonner";
import { Badge, Button, CategoryChip, ErrorState, Field, FormError, LoadingBlock, Modal, Panel, StatusBadge, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { assignmentMeta, eventLabel, fmtDateTime, fmtQty, humanize, lifecycle, roleLabel, statusMeta } from "../lib/format";
import { useActor } from "../lib/session";
import type { ActionInfo, BatchDetail as Detail, CustodyEvent } from "../lib/types";

function CustodyRail({ b }: { b: Detail }) {
  const off = b.status === "rejected" || b.status === "cancelled";
  const idx = lifecycle.indexOf(b.status);
  const reached = off ? Math.max(...b.events.map((e) => (e.fromStatus ? lifecycle.indexOf(e.fromStatus) : 0))) : idx;
  return (
    <div className="overflow-x-auto">
      <ol className="flex min-w-[640px] items-start" aria-label="Lifecycle progress">
        {lifecycle.map((s, i) => {
          const done = i < reached || (!off && i === reached && s === "disposed");
          const current = !off && i === reached && s !== "disposed";
          return (
            <li key={s} className="relative flex flex-1 flex-col items-center gap-2 text-center">
              {i > 0 && <span className={clsx("absolute right-1/2 top-[11px] h-[3px] w-full", i <= reached ? "bg-emerald-600" : "bg-line")} aria-hidden />}
              <span
                className={clsx(
                  "relative z-10 grid size-6 place-items-center rounded-full border-[3px]",
                  done && "border-emerald-600 bg-emerald-600",
                  current && "border-emerald-600 bg-lime",
                  !done && !current && "border-line-2 bg-paper",
                  off && i === reached && "border-danger bg-danger",
                )}
                aria-current={current ? "step" : undefined}
              >
                {current && <span className="absolute inset-0 rounded-full bg-lime animate-pulse-ring" aria-hidden />}
              </span>
              <span className={clsx("text-[12.5px] font-semibold", current ? "text-ink" : done ? "text-ink-2" : "text-ink-3")}>{statusMeta[s].label}</span>
            </li>
          );
        })}
      </ol>
      {off && (
        <p className={clsx("mt-3 rounded-[10px] px-3 py-2 text-sm font-semibold", b.status === "rejected" ? "bg-danger-soft text-[#9f1239]" : "bg-mist text-ink-2")}>
          {b.status === "rejected" ? "Delivery was rejected by the receiving facility. The load is with the transporter until an admin reroutes it." : "This batch was cancelled before collection."}
        </p>
      )}
    </div>
  );
}

function Custodian({ b }: { b: Detail }) {
  if (b.status === "disposed") return <span>None — disposed</span>;
  if (b.status === "cancelled") return <span>None — cancelled</span>;
  if (b.currentCustodianUserId) return <span className="inline-flex items-center gap-1.5"><Truck className="size-4 text-signal" /> {b.currentAssignment?.transporterName ?? "Transporter"}</span>;
  const fac = [b.origin, b.destination].find((f) => f?.id === b.currentCustodianFacilityId);
  return <span>{fac?.name ?? "—"}</span>;
}

function TimelineItem({ e, last }: { e: CustodyEvent; last: boolean }) {
  const transfer = e.toCustodianUser || e.toCustodianFacility;
  const tone = e.eventType === "rejected" || e.eventType === "incident" || e.eventType === "cancelled" ? "danger" : e.eventType === "disposed" ? "ink" : transfer ? "signal" : "emerald";
  return (
    <li className="relative flex gap-4 pb-6">
      {!last && <span className="absolute left-[9px] top-6 h-[calc(100%-12px)] w-[2px] bg-line" aria-hidden />}
      <span className={clsx("relative mt-1 size-5 shrink-0 rounded-full border-[3px] bg-paper", tone === "danger" ? "border-danger" : tone === "ink" ? "border-ink" : tone === "signal" ? "border-signal" : "border-emerald-600")} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="font-semibold">{eventLabel[e.eventType] ?? humanize(e.eventType)}</p>
          <time className="tabular text-[13px] text-ink-3" dateTime={e.createdAt}>{fmtDateTime(e.createdAt)}</time>
        </div>
        <p className="text-sm text-ink-2">
          {e.actorName ?? "System"}
          {e.actorRole && <span className="text-ink-3"> ({roleLabel[e.actorRole]})</span>}
          {e.facilityName && <> at {e.facilityName}</>}
        </p>
        {transfer && (
          <p className="mt-1 text-sm">
            Custody: <span className="text-ink-2">{e.fromCustodianUser ?? e.fromCustodianFacility ?? "—"}</span> to <strong>{e.toCustodianUser ?? e.toCustodianFacility}</strong>
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {e.scanMethod && (e.details?.simulatedScan ? (
            <Badge tone="warn"><FlaskConical className="size-3" /> Simulated QR scan (demo)</Badge>
          ) : (
            <Badge tone={e.scanMethod === "manual" ? "warn" : "neutral"}>{e.scanMethod === "manual" ? "Recorded without scan" : `${e.scanMethod.toUpperCase()} scan`}</Badge>
          ))}
          {e.latitude !== null && (
            <a href={`https://www.openstreetmap.org/?mlat=${e.latitude}&mlon=${e.longitude}#map=17/${e.latitude}/${e.longitude}`} target="_blank" rel="noreferrer">
              <Badge tone="signal"><MapPin className="size-3" /> Location attached</Badge>
            </a>
          )}
          {e.assignmentId && <Link to={`/assignments/${e.assignmentId}`}><Badge tone="neutral"><Truck className="size-3" /> Job</Badge></Link>}
        </div>
        {e.notes && <p className="mt-1.5 rounded-[10px] bg-mist px-3 py-2 text-sm text-ink-2">{e.notes}</p>}
        {e.eventType === "updated" && e.details && (
          <ul className="mt-1.5 text-[13px] text-ink-2">
            {Object.entries(e.details).map(([k, v]) => (
              <li key={k}>{humanize(k)}: {String((v as { from: unknown }).from ?? "—")} to {String((v as { to: unknown }).to ?? "—")}</li>
            ))}
          </ul>
        )}
        {e.eventType === "received" && e.details && <p className="mt-1 text-[13px] text-ink-2">Weighed {String(e.details.receivedQuantity)} {String(e.details.unit)}, {String(e.details.condition)}</p>}
      </div>
    </li>
  );
}

/** Hospital staff ask for collection; the destination is the organization's configured treatment plant. */
function RequestCollection({ b }: { b: Detail }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const m = useMutation({
    mutationFn: () => api.post<{ reference: string }>(`/api/batches/${b.id}/request-collection`, { notes: notes || null }),
    onSuccess: (a) => {
      toast.success(`Collection requested (${a.reference})`, { description: "A transporter has been assigned and notified." });
      setOpen(false);
      for (const k of ["batch", "batches", "assignments", "dashboard"]) qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const r = b.collectionRequest!;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-emerald-200 bg-emerald-50/60 p-4" data-testid="request-collection">
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-ink">Ready to send for treatment?</p>
          <p className="text-ink-2">Destination: <strong>{r.destination?.name ?? "not configured"}</strong>{r.reason ? <span className="block text-ink-3">{r.reason}</span> : null}</p>
        </div>
        <Button onClick={() => setOpen(true)} disabled={!r.enabled} icon={<Send className="size-4" />}>Request collection</Button>
      </div>
      <Modal open={open} onOpenChange={setOpen} title="Request collection" description={`${b.trackingCode} will be collected by a transporter and taken to ${r.destination?.name}.`}>
        <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-[12px] bg-mist p-3 text-sm">
            <dt className="text-ink-3">Origin</dt><dd className="font-semibold">{b.origin.name}</dd>
            <dt className="text-ink-3">Destination</dt><dd className="font-semibold">{r.destination?.name}</dd>
            <dt className="text-ink-3">Transporter</dt><dd>Assigned automatically — they must accept</dd>
          </dl>
          <Field label="Note for the transporter (optional)" htmlFor="rcn"><Textarea id="rcn" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Collect from the loading bay behind Block C" /></Field>
          <FormError error={m.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={m.isPending} icon={<Send className="size-4" />}>Send request</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export default function BatchDetail() {
  const { id = "" } = useParams();
  const { isTransporter } = useActor();
  const q = useQuery({ queryKey: ["batch", id], queryFn: () => api.get<Detail>(`/api/batches/${id}`) });
  const [dialog, setDialog] = useState<ActionInfo["action"] | null>(null);
  const [incident, setIncident] = useState(false);

  if (q.isLoading) return <LoadingBlock rows={8} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data!;
  const enabled = b.availableActions.filter((a) => a.enabled);
  const blocked = b.availableActions.filter((a) => !a.enabled);
  const primary = enabled.find((a) => a.action !== "cancel");

  return (
    <>
      <Link to="/batches" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-emerald-700">
        <ArrowLeft className="size-4" /> Waste batches
      </Link>
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-[26px] font-bold tracking-tight md:text-[30px]">{b.trackingCode}</h1>
            <StatusBadge status={b.status} />
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-2">
            <CategoryChip code={b.category.code} name={b.category.name} color={b.category.colorHex} />
            <span className="tabular font-semibold text-ink">{fmtQty(b.quantity, b.unit)}</span>
            <span>{b.containerCount} container{b.containerCount > 1 ? "s" : ""}</span>
            {b.sourceArea && <span>{b.sourceArea}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isTransporter && <Link to={`/batches/${b.id}/labels`} className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line-2 bg-paper px-4 text-sm font-semibold hover:border-emerald-600"><Printer className="size-4" /> Labels</Link>}
          {b.status === "generated" && !isTransporter && !b.currentAssignmentId && <Link to={`/batches/${b.id}/edit`} className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line-2 bg-paper px-4 text-sm font-semibold hover:border-emerald-600"><Pencil className="size-4" /> Edit</Link>}
          {b.status !== "disposed" && b.status !== "cancelled" && <Button variant="secondary" onClick={() => setIncident(true)} icon={<AlertOctagon className="size-4" />}>Report incident</Button>}
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-5">
          <Panel>
            <CustodyRail b={b} />
            {b.collectionRequest && <div className="mt-5"><RequestCollection b={b} /></div>}
            {(enabled.length > 0 || blocked.length > 0) && (
              <div className="mt-5 flex flex-col gap-3 border-t border-line pt-5">
                {enabled.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-sm font-semibold text-ink-2">Next step</span>
                    {enabled.map((a) => (
                      <Button key={a.action} variant={a.action === "cancel" ? "danger" : a === primary ? "primary" : "secondary"} onClick={() => setDialog(a.action)} icon={a.action === "pickup" || a.action === "handover" ? <ScanLine className="size-4" /> : a.action === "cancel" ? <Ban className="size-4" /> : undefined}>
                        {a.label}
                      </Button>
                    ))}
                  </div>
                )}
                {blocked.map((a) => (
                  <p key={a.action} className="flex items-start gap-2 text-sm text-ink-3">
                    <Ban className="mt-0.5 size-4 shrink-0" />
                    <span><strong className="text-ink-2">{a.label}:</strong> {a.reason}</span>
                  </p>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Chain of custody" actions={<span className="text-[12.5px] text-ink-3">{b.events.length} events · can't be edited</span>}>
            <ol>
              {b.events.map((e, i) => <TimelineItem key={e.id} e={e} last={i === b.events.length - 1} />)}
            </ol>
          </Panel>
        </div>

        <aside className="flex flex-col gap-5">
          <Panel title="Details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
              <dt className="text-ink-3">Status</dt><dd><StatusBadge status={b.status} /></dd>
              <dt className="text-ink-3">Origin</dt><dd>{b.origin.name}</dd>
              <dt className="text-ink-3">Destination</dt><dd>{b.destination?.name ?? <span className="text-ink-3">Set when collection is requested</span>}</dd>
              <dt className="text-ink-3">Transporter</dt><dd>{b.currentAssignment?.transporterName ?? b.assignmentHistory.at(-1)?.transporterName ?? <span className="text-ink-3">Not yet assigned</span>}</dd>
              <dt className="text-ink-3">Held by</dt><dd className="font-semibold"><Custodian b={b} /></dd>
              <dt className="text-ink-3">Registered</dt><dd>{fmtDateTime(b.generatedAt)}</dd>
              <dt className="text-ink-3">By</dt><dd>{b.responsible.fullName}</dd>
              {b.collectionDueAt && !["disposed", "cancelled", "received", "delivered"].includes(b.status) && <><dt className="text-ink-3">Collect by</dt><dd className={clsx(new Date(b.collectionDueAt) < new Date() && ["generated", "segregated"].includes(b.status) && "font-semibold text-danger")}>{fmtDateTime(b.collectionDueAt)}</dd></>}
              {b.containerType && <><dt className="text-ink-3">Container</dt><dd>{b.containerType}</dd></>}
              <dt className="text-ink-3">Segregation</dt><dd>{b.segregationVerified ? "Verified" : "Not yet verified"}</dd>
            </dl>
            {(b.segregationNotes || b.handlingNotes) && (
              <div className="mt-4 space-y-2 text-sm">
                {b.handlingNotes && <p className="rounded-[10px] bg-warn-soft/60 px-3 py-2"><strong>Handling:</strong> {b.handlingNotes}</p>}
                {b.segregationNotes && <p className="rounded-[10px] bg-mist px-3 py-2"><strong>Segregation:</strong> {b.segregationNotes}</p>}
              </div>
            )}
          </Panel>

          {b.currentAssignment && (
            <Panel title="Transport" actions={<Link to={`/assignments/${b.currentAssignment.id}`} className="text-sm font-semibold text-emerald-700 hover:underline">Open job</Link>}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold">{b.currentAssignment.reference}</span>
                <Badge tone={assignmentMeta[b.currentAssignment.status].tone}>{assignmentMeta[b.currentAssignment.status].label}</Badge>
              </div>
              <p className="mt-2 text-sm text-ink-2">{b.currentAssignment.transporterName}{b.currentAssignment.vehicleReg ? ` · ${b.currentAssignment.vehicleReg}` : ""}</p>
              <p className="text-sm text-ink-2">Due {fmtDateTime(b.currentAssignment.dueBy)}</p>
              {b.currentAssignment.trackingActive && <p className="mt-2"><Badge tone="lime"><Radio className="size-3" /> Location shared {b.currentAssignment.lastLocationAt ? `· last ${fmtDateTime(b.currentAssignment.lastLocationAt)}` : ""}</Badge></p>}
            </Panel>
          )}

          <Panel title="Containers" bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {b.containers.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-5 py-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[13.5px] font-semibold">{c.label}</p>
                    <p className="flex flex-wrap gap-1 pt-1">
                      {c.identifiers.map((t) => (
                        <Badge key={t.id} tone={t.method === "qr" ? "emerald" : "signal"}>{t.method.toUpperCase()}{t.value ? ` ${t.value.slice(-6)}` : ""}</Badge>
                      ))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          {b.receipts.length > 0 && (
            <Panel title="Receipt">
              {b.receipts.map((r) => (
                <div key={r.id} className="text-sm">
                  <Badge tone={r.accepted ? "emerald" : "danger"}>{r.accepted ? "Accepted" : "Rejected"}</Badge>
                  <p className="mt-2">{fmtQty(r.receivedQuantity, r.unit)}, {humanize(r.condition).toLowerCase()} — {r.receivedBy}</p>
                  <p className="text-ink-3">{fmtDateTime(r.receivedAt)}</p>
                  {r.notes && <p className="mt-1 text-ink-2">{r.notes}</p>}
                </div>
              ))}
            </Panel>
          )}

          {b.disposal && (
            <Panel title="Disposal">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-3">Method</dt><dd className="font-semibold">{humanize(b.disposal.method)}</dd>
                <dt className="text-ink-3">At</dt><dd>{b.disposal.facilityName}</dd>
                <dt className="text-ink-3">When</dt><dd>{fmtDateTime(b.disposal.disposedAt)}</dd>
                <dt className="text-ink-3">Quantity</dt><dd>{fmtQty(b.disposal.treatedQuantity, b.disposal.unit)}</dd>
                <dt className="text-ink-3">Recorded by</dt><dd>{b.disposal.performedBy}</dd>
                {b.disposal.documentRef && <><dt className="text-ink-3">Plant ref.</dt><dd className="font-mono">{b.disposal.documentRef}</dd></>}
              </dl>
            </Panel>
          )}

          {b.incidents.length > 0 && (
            <Panel title="Incidents">
              <ul className="flex flex-col gap-3 text-sm">
                {b.incidents.map((i) => (
                  <li key={i.id}>
                    <div className="flex items-center gap-2"><span className="font-semibold">{humanize(i.type)}</span><Badge tone={i.status === "open" ? (i.severity === "high" || i.severity === "critical" ? "danger" : "warn") : "neutral"}>{i.status === "open" ? i.severity : "resolved"}</Badge></div>
                    <p className="text-ink-2">{i.description}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>

      {dialog && <ActionDialog open action={dialog} target={b} onOpenChange={(o) => !o && setDialog(null)} />}
      {incident && <IncidentDialog open onOpenChange={setIncident} batchId={b.id} context={`Batch ${b.trackingCode}`} />}
    </>
  );
}

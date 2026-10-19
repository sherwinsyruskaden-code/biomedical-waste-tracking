import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Radio, Truck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Badge, Button, CategoryChip, EmptyState, ErrorState, Field, FormError, Input, LoadingBlock, Modal, PageHeader, Pagination, Select, Textarea, fieldError } from "../components/ui";
import { api, qs } from "../lib/api";
import { assignmentMeta, fmtDateTime, fmtQty } from "../lib/format";
import { useFacilities, useMembers } from "../lib/queries";
import { dueWindow, isoToWall, pickupWindow, wallIssue, wallToIso, wallToMs } from "../lib/dates";
import { useActor, useOrgTimezone, useWorkplace } from "../lib/session";
import type { AssignmentStatus, BatchListItem, Paged } from "../lib/types";

interface Row {
  id: string;
  reference: string;
  status: AssignmentStatus;
  transporterName: string;
  originName: string;
  destinationName: string;
  vehicleReg: string | null;
  scheduledPickupAt: string;
  dueBy: string;
  trackingActive: boolean;
  batchCount: number;
}


export function CreateAssignment({ open, onOpenChange, presetOrigin }: { open: boolean; onOpenChange: (o: boolean) => void; presetOrigin?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const facilities = useFacilities();
  const transporters = useMembers("transporter");
  const [origin, setOrigin] = useState(presetOrigin ?? "");
  const [dest, setDest] = useState("");
  const [transporter, setTransporter] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const tz = useOrgTimezone();
  const [pickup, setPickup] = useState(() => isoToWall(Date.now() + 30 * 60_000, tz));
  const [due, setDue] = useState(() => isoToWall(Date.now() + 4 * 3600_000, tz));
  const [vehicle, setVehicle] = useState("");
  const [notes, setNotes] = useState("");
  const batches = useQuery({
    queryKey: ["batches", "assignable", origin],
    queryFn: () => api.get<Paged<BatchListItem>>(`/api/batches${qs({ assignable: "true", facilityId: origin, pageSize: 100, sort: "oldest" })}`),
    enabled: !!origin,
  });
  const candidates = (batches.data?.items ?? []).filter((b) => b.originFacilityId === origin);
  const m = useMutation({
    mutationFn: () => api.post<{ id: string; reference: string }>("/api/assignments", { transporterUserId: transporter, originFacilityId: origin, destinationFacilityId: dest, batchIds: picked, scheduledPickupAt: wallToIso(pickup, tz), dueBy: wallToIso(due, tz), vehicleReg: vehicle || null, notes: notes || null }),
    onSuccess: (a) => {
      toast.success(`Job ${a.reference} created`, { description: "The transporter has been notified." });
      for (const k of ["assignments", "batches", "dashboard", "tracking"]) qc.invalidateQueries({ queryKey: [k] });
      onOpenChange(false);
      navigate(`/assignments/${a.id}`);
    },
  });
  const pw = pickupWindow();
  const pickupError = wallIssue(pickup, tz, pw.min, pw.max);
  const pickupMs = wallToMs(pickup, tz);
  const dw = pickupMs === null ? null : dueWindow(pickupMs);
  const dueError = !dw ? "Set a valid pickup time first." : wallIssue(due, tz, dw.min, dw.max);
  const activeTransporters = (transporters.data ?? []).filter((t) => t.status === "active");
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New transport job" description="Pick segregated batches waiting at one facility and send them to a receiving facility." wide>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Collect from" htmlFor="ao" required>
            <Select id="ao" value={origin} onChange={(e) => { setOrigin(e.target.value); setPicked([]); }}>
              <option value="">Choose facility…</option>
              {facilities.data?.filter((f) => f.type !== "treatment").map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
          <Field label="Deliver to" htmlFor="ad" required error={fieldError(m.error, "destinationFacilityId")}>
            <Select id="ad" value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="">Choose receiving facility…</option>
              {facilities.data?.filter((f) => f.canReceive && f.id !== origin).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
        </div>
        {origin && (
          <fieldset className="rounded-[14px] border border-line">
            <legend className="ml-3 px-1 text-[13px] font-semibold text-ink-2">Batches ready for collection</legend>
            {batches.isLoading ? (
              <div className="p-3"><LoadingBlock rows={2} /></div>
            ) : candidates.length === 0 ? (
              <p className="p-4 text-sm text-ink-3">No segregated, unassigned batches at this facility. Batches must have segregation verified first.</p>
            ) : (
              <ul className="max-h-56 divide-y divide-line overflow-y-auto">
                <li className="flex items-center justify-between px-4 py-2 text-[13px]">
                  <button type="button" className="font-semibold text-emerald-700" onClick={() => setPicked(picked.length === candidates.length ? [] : candidates.map((c) => c.id))}>{picked.length === candidates.length ? "Clear all" : "Select all"}</button>
                  <span className="text-ink-3">{picked.length} selected</span>
                </li>
                {candidates.map((b) => (
                  <li key={b.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-mist">
                      <input type="checkbox" className="size-4 accent-emerald-600" checked={picked.includes(b.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, b.id] : picked.filter((x) => x !== b.id))} />
                      <span className="font-mono text-sm font-semibold">{b.trackingCode}</span>
                      <CategoryChip code={b.category.code} color={b.category.colorHex} compact />
                      <span className="tabular ml-auto text-sm text-ink-2">{fmtQty(b.quantity, b.unit)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Transporter" htmlFor="at" required hint={activeTransporters.length === 0 ? <>No transporters yet. <Link to="/team" className="font-semibold text-emerald-700">Invite one</Link></> : undefined}>
            <Select id="at" value={transporter} onChange={(e) => { setTransporter(e.target.value); const t = activeTransporters.find((x) => x.userId === e.target.value); if (t?.vehicleReg && !vehicle) setVehicle(t.vehicleReg); }}>
              <option value="">Choose…</option>
              {activeTransporters.map((t) => <option key={t.userId} value={t.userId}>{t.fullName}{t.vehicleReg ? ` (${t.vehicleReg})` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Vehicle registration" htmlFor="av">
            <Input id="av" value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="e.g. TN 09 AB 1234" />
          </Field>
          <Field label="Pickup time" htmlFor="ap" hint={`Organization time (${tz})`} error={pickupError ?? fieldError(m.error, "scheduledPickupAt")}>
            <Input id="ap" type="datetime-local" min={isoToWall(pw.min, tz)} max={isoToWall(pw.max, tz)} aria-invalid={!!pickupError || undefined} value={pickup} onChange={(e) => setPickup(e.target.value)} />
          </Field>
          <Field label="Deliver by" htmlFor="adue" error={pickupError ? undefined : dueError ?? fieldError(m.error, "dueBy")}>
            <Input id="adue" type="datetime-local" min={dw ? isoToWall(dw.min, tz) : undefined} max={dw ? isoToWall(dw.max, tz) : undefined} aria-invalid={!!dueError || undefined} value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes for the transporter" htmlFor="an">
          <Textarea id="an" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Gate number, contact on arrival…" />
        </Field>
        <FormError error={m.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="submit" loading={m.isPending} disabled={!origin || !dest || !transporter || picked.length === 0 || !!pickupError || !!dueError}>Create job</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Assignments() {
  const { isAdmin, isTransporter } = useActor();
  const { atPlant, atHospital } = useWorkplace();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get("new") === "1");
  const status = params.get("status") ?? (isTransporter ? "assigned,accepted,in_progress" : "");
  const page = Number(params.get("page") ?? 1);
  const q = useQuery({ queryKey: ["assignments", status, page], queryFn: () => api.get<Paged<Row>>(`/api/assignments${qs({ status, page, pageSize: 20 })}`), placeholderData: (p) => p });
  const tabs: [string, string][] = [["assigned,accepted,in_progress", "Active"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["", "All"]];
  return (
    <>
      <PageHeader
        title={isTransporter ? "My collections" : isAdmin ? "Transport jobs" : atPlant && !atHospital ? "Incoming transfers" : "Collection requests"}
        description={isTransporter ? "Accept a collection request, scan each batch at pickup and at the treatment plant, and share your location while you drive." : isAdmin ? "Every collection in your organization, from request to handover. Hospital staff request collections from a batch page." : atPlant && !atHospital ? "Waste on its way to your plant." : "Collections you requested from your hospital. Request one from a segregated batch's page."}
        actions={isAdmin && <Button onClick={() => setCreating(true)} icon={<Plus className="size-4" />}>New job</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-1 rounded-[12px] bg-paper p-1 ring-1 ring-line w-fit" role="tablist">
        {tabs.map(([v, l]) => (
          <button key={l} role="tab" aria-selected={status === v} onClick={() => setParams(v ? { status: v } : { status: "" })} className={`rounded-[9px] px-3.5 py-1.5 text-sm font-semibold ${status === v ? "bg-emerald-600 text-white" : "text-ink-2 hover:bg-mist"}`}>{l}</button>
        ))}
      </div>
      <div className="overflow-hidden rounded-[16px] border border-line bg-paper">
        {q.isLoading ? (
          <div className="p-5"><LoadingBlock /></div>
        ) : q.isError ? (
          <div className="p-5"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>
        ) : q.data!.items.length === 0 ? (
          <EmptyState icon={<Truck />} title="No jobs here" action={isAdmin && <Button variant="secondary" onClick={() => setCreating(true)}>Create a job</Button>}>
            {isTransporter ? "You'll be notified when a hospital requests a collection from you." : isAdmin ? "Hospital staff request collections from segregated batches; you can also dispatch a job here." : "Request collection from a segregated batch's page."}
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((a) => (
                <li key={a.id}>
                  <Link to={`/assignments/${a.id}`} className="grid gap-2 px-5 py-4 hover:bg-mist/70 md:grid-cols-[1.1fr_1.6fr_1fr_auto] md:items-center">
                    <span>
                      <span className="block font-mono font-semibold">{a.reference}</span>
                      <span className="text-[13px] text-ink-3">{a.batchCount} batch{a.batchCount === 1 ? "" : "es"}</span>
                    </span>
                    <span className="text-sm text-ink-2">
                      <span className="block">Origin: <strong className="text-ink">{a.originName}</strong></span>
                      <span className="block">Destination: <strong className="text-ink">{a.destinationName}</strong></span>
                      <span className="block text-[13px] text-ink-3">Transporter: {a.transporterName}{a.vehicleReg ? ` · ${a.vehicleReg}` : ""}</span>
                    </span>
                    <span className="text-sm text-ink-2">Due {fmtDateTime(a.dueBy)}</span>
                    <span className="flex flex-wrap gap-1.5 md:justify-end">
                      {a.trackingActive && <Badge tone="lime"><Radio className="size-3" /> GPS</Badge>}
                      <Badge tone={assignmentMeta[a.status].tone}>{assignmentMeta[a.status].label}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={20} total={q.data!.total} onPage={(p) => setParams({ status, page: String(p) })} />
          </>
        )}
      </div>
      {creating && <CreateAssignment open onOpenChange={setCreating} />}
    </>
  );
}

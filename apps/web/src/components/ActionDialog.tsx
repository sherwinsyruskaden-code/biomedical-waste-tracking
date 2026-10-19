import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ScanLine } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api, newIdempotencyKey } from "../lib/api";
import { disposalMethods, humanize } from "../lib/format";
import { isoToWall, rerouteWindow, wallIssue, wallToIso } from "../lib/dates";
import { useFacilities } from "../lib/queries";
import { useOrgTimezone } from "../lib/session";
import type { ActionInfo, BatchStatus } from "../lib/types";
import { Scanner, type ScanResult } from "./Scanner";
import { Button, Checkbox, Field, FormError, Input, Modal, Select, Textarea, fieldError } from "./ui";

export interface ActionTarget {
  id: string;
  trackingCode: string;
  quantity: number;
  unit: string;
  destinationFacilityId?: string | null;
  category?: { allowedDisposalMethods?: string[] } | null;
}

const titles: Record<ActionInfo["action"], string> = {
  segregate: "Verify segregation",
  cancel: "Cancel batch",
  pickup: "Confirm pickup",
  handover: "Mark arrived at treatment plant",
  receive: "Confirm receipt",
  dispose: "Record disposal",
  reroute: "Reroute rejected load",
};

const successText: Record<ActionInfo["action"], string> = {
  segregate: "Segregation verified",
  cancel: "Batch cancelled",
  pickup: "Pickup confirmed — custody is now with the transporter",
  handover: "Arrived — waiting for the treatment plant to confirm receipt",
  receive: "Receipt recorded",
  dispose: "Disposal recorded",
  reroute: "Load rerouted",
};

function getPosition(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  });
}

/** Scan-or-manual block used by pickup and arrival (the transporter). Receipt needs no scan. */
function ScanStep({ scan, setScan, required }: { scan: ScanResult | null; setScan: (s: ScanResult | null) => void; required: boolean }) {
  if (scan)
    return (
      <div className="flex items-center justify-between gap-3 rounded-[12px] bg-emerald-50 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="size-4" /> {scan.method.toUpperCase()} label captured
        </span>
        <Button size="sm" variant="ghost" onClick={() => setScan(null)}>Scan again</Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <Scanner onResult={setScan} />
    </div>
  );
}

export function ActionDialog({ action, target, open, onOpenChange, onDone, initialScan, simulated }: { action: ActionInfo["action"]; target: ActionTarget; open: boolean; onOpenChange: (o: boolean) => void; onDone?: (status: BatchStatus) => void; /** A label already scanned on the Scan page, so the transporter isn't asked to scan twice. */ initialScan?: ScanResult | null; /** The scan was simulated (sample organization): the server uses the batch's own QR and records it as simulated. */ simulated?: boolean }) {
  const qc = useQueryClient();
  const facilities = useFacilities();
  const key = useMemo(() => newIdempotencyKey(), [open, action]); // eslint-disable-line
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [scan, setScan] = useState<ScanResult | null>(initialScan ?? null);
  const [noScan, setNoScan] = useState(false);
  const [shareLoc, setShareLoc] = useState(true);
  const [accepted, setAccepted] = useState(true);
  const [qty, setQty] = useState(String(target.quantity));
  const [unit, setUnit] = useState(target.unit);
  const [condition, setCondition] = useState("intact");
  const allowed = target.category?.allowedDisposalMethods?.length ? target.category.allowedDisposalMethods : [...disposalMethods];
  const [method, setMethod] = useState(allowed[0]);
  const [docRef, setDocRef] = useState("");
  const [dest, setDest] = useState("");
  const tz = useOrgTimezone();
  const [dueBy, setDueBy] = useState(() => isoToWall(Date.now() + 3 * 3600_000, tz));
  const rw = rerouteWindow();
  const dueError = action === "reroute" ? wallIssue(dueBy, tz, rw.min, rw.max) : null;

  const m = useMutation({
    mutationFn: async () => {
      let body: Record<string, unknown> = {};
      const scanFields = scan ? { scanMethod: scan.method, identifier: scan.value } : { scanMethod: "manual" };
      if (action === "segregate") body = { confirmSegregation: confirm, notes: notes || undefined };
      if (action === "cancel") body = { reason: notes };
      if (action === "pickup" || action === "handover") {
        // Pickup is scanned by the transporter; arrival is only recorded (the plant scans or selects the batch to confirm receipt).
        body = action === "pickup" ? { ...scanFields, notes: notes || undefined } : { notes: notes || undefined };
        if (shareLoc) {
          const p = await getPosition();
          if (p) body = { ...body, ...p };
        }
      }
      if (action === "receive") body = { accepted, receivedQuantity: Number(qty), unit, condition, notes: notes || undefined, ...(simulated ? {} : scanFields), ...(simulated ? { simulatedScan: true } : {}) };
      if (action === "dispose") body = { method, treatedQuantity: qty ? Number(qty) : undefined, unit, documentRef: docRef || undefined, notes: notes || undefined };
      if (action === "reroute") body = { destinationFacilityId: dest, dueBy: wallToIso(dueBy, tz), notes: notes || undefined };
      return api.post<{ status: BatchStatus; replayed: boolean }>(`/api/batches/${target.id}/actions/${action}`, body, { "Idempotency-Key": key });
    },
    onSuccess: (r) => {
      toast.success(successText[action], { description: target.trackingCode });
      for (const k of ["batch", "batches", "dashboard", "assignment", "assignments", "tracking", "receiving"]) qc.invalidateQueries({ queryKey: [k] });
      onOpenChange(false);
      onDone?.(r.status);
    },
  });

  const needsScan = action === "pickup";
  const canSubmit =
    (action !== "segregate" || confirm) &&
    (action !== "cancel" || notes.trim().length >= 3) &&
    (!needsScan || !!scan || (noScan && notes.trim().length > 0)) &&
    (action !== "receive" || (accepted || notes.trim().length > 0)) &&
    (action !== "reroute" || (!!dest && !dueError));

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={titles[action]} description={`Batch ${target.trackingCode}`} wide={needsScan || action === "receive"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
        className="flex flex-col gap-4"
      >
        {action === "segregate" && (
          <Checkbox checked={confirm} onChange={setConfirm} label="I checked that every container holds only waste of this category, in the correct colour-coded container, and is not overfilled." />
        )}

        {needsScan && (
          <>
            {!noScan && <ScanStep scan={scan} setScan={setScan} required />}
            <Checkbox checked={noScan} onChange={(v) => { setNoScan(v); if (v) setScan(null); }} label="I can't scan (label damaged or missing) — record manually with a note" />
            <Checkbox checked={shareLoc} onChange={setShareLoc} label="Attach my current location to this record" />
          </>
        )}

        {action === "handover" && <Checkbox checked={shareLoc} onChange={setShareLoc} label="Attach my current location to this record" />}

        {action === "receive" && (
          <>
            <div className="grid grid-cols-2 gap-2 rounded-[12px] bg-mist p-1" role="radiogroup" aria-label="Decision">
              {[true, false].map((v) => (
                <button key={String(v)} type="button" role="radio" aria-checked={accepted === v} onClick={() => setAccepted(v)} className={`rounded-[9px] px-3 py-2 text-sm font-semibold ${accepted === v ? (v ? "bg-emerald-600 text-white" : "bg-danger text-white") : "text-ink-2"}`}>
                  {v ? "Accept delivery" : "Reject delivery"}
                </button>
              ))}
            </div>
            <p className="text-[13px] font-medium" data-testid="receipt-source">
              {simulated ? <span className="text-amber-900">Simulated scan of this batch's QR (sample organization): recorded as simulated.</span> : scan ? <span className="text-emerald-800">QR label scanned: recorded with this receipt.</span> : <span className="text-ink-3">Selected from the arrivals list: recorded without a scan.</span>}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Weighed quantity" htmlFor="rq" error={fieldError(m.error, "receivedQuantity")}>
                <Input id="rq" type="number" min="0" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} />
              </Field>
              <Field label="Unit" htmlFor="ru">
                <Select id="ru" value={unit} onChange={(e) => setUnit(e.target.value)}>
                  <option value="kg">kg</option><option value="litre">litres</option><option value="bag">bags</option><option value="container">containers</option>
                </Select>
              </Field>
              <Field label="Condition" htmlFor="rc">
                <Select id="rc" value={condition} onChange={(e) => setCondition(e.target.value)}>
                  <option value="intact">Intact</option><option value="damaged">Damaged</option><option value="leaking">Leaking</option><option value="mislabelled">Mislabelled / wrong bag</option>
                </Select>
              </Field>
            </div>
          </>
        )}

        {action === "dispose" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Treatment method" htmlFor="dm" hint="Only methods configured for this category are listed.">
              <Select id="dm" value={method} onChange={(e) => setMethod(e.target.value)}>
                {allowed.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}
              </Select>
            </Field>
            <Field label="Plant log / document reference" htmlFor="dr" hint="From your own treatment records.">
              <Input id="dr" value={docRef} onChange={(e) => setDocRef(e.target.value)} placeholder="e.g. INC-2026-1042" />
            </Field>
            <Field label="Treated quantity" htmlFor="dq">
              <Input id="dq" type="number" min="0" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Unit" htmlFor="du">
              <Select id="du" value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="kg">kg</option><option value="litre">litres</option><option value="bag">bags</option><option value="container">containers</option>
              </Select>
            </Field>
          </div>
        )}

        {action === "reroute" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="New receiving facility" htmlFor="rd" required>
              <Select id="rd" value={dest} onChange={(e) => setDest(e.target.value)}>
                <option value="">Choose…</option>
                {facilities.data?.filter((f) => f.canReceive && f.id !== target.destinationFacilityId).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            </Field>
            <Field label="Deliver by" htmlFor="rdue" hint={`Organization time (${tz})`} error={dueError ?? fieldError(m.error, "dueBy")}>
              <Input id="rdue" type="datetime-local" min={isoToWall(rw.min, tz)} max={isoToWall(rw.max, tz)} aria-invalid={!!dueError || undefined} value={dueBy} onChange={(e) => setDueBy(e.target.value)} />
            </Field>
          </div>
        )}

        <Field
          label={action === "cancel" ? "Reason for cancelling" : action === "receive" && !accepted ? "Why is it rejected?" : noScan ? "Why wasn't it scanned?" : "Notes"}
          htmlFor="an"
          required={action === "cancel" || (action === "receive" && !accepted) || noScan}
        >
          <Textarea id="an" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <FormError error={m.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="submit" variant={action === "cancel" || (action === "receive" && !accepted) ? "danger" : "primary"} loading={m.isPending} disabled={!canSubmit}>
            {action === "receive" ? (accepted ? "Confirm receipt" : "Reject delivery") : titles[action]}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

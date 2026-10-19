import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, ScanLine } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ActionDialog } from "../components/ActionDialog";
import { Scanner, type ScanResult } from "../components/Scanner";
import { Button, FormError, LoadingBlock, PageHeader, Panel, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { useActor } from "../lib/session";
import { fmtQty } from "../lib/format";
import type { ActionInfo, BatchStatus } from "../lib/types";

interface Resolved {
  container: { id: string; label: string };
  batch: { id: string; trackingCode: string; status: BatchStatus; quantity: number; unit: string; containerCount: number; sourceArea: string | null; category: { name: string; code: string; colorHex: string }; originName: string | null };
  availableActions: ActionInfo[];
}

function ResultCard({ r, onAction, simulated, onSimulate, busy }: { r: Resolved; onAction: (a: ActionInfo["action"]) => void; simulated?: boolean; onSimulate?: (a: "pickup") => void; busy?: boolean }) {
  const enabled = r.availableActions.filter((a) => a.enabled);
  return (
    <div className="rounded-[18px] border-2 border-emerald-600 bg-paper p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 className="size-4" /> Label recognised — {r.container.label}</p>
      {simulated && <p className="mt-1 rounded-[8px] bg-amber-50 px-2.5 py-1 text-[13px] font-semibold text-amber-900" data-testid="simulated-banner">Simulated scan: no physical QR was read, and this is recorded as simulated.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Link to={`/batches/${r.batch.id}`} className="font-mono text-2xl font-bold hover:text-emerald-700">{r.batch.trackingCode}</Link>
        <StatusBadge status={r.batch.status} />
        <span className="tabular font-semibold">{fmtQty(r.batch.quantity, r.batch.unit)}</span>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-full ring-1 ring-black/10" style={{ background: r.batch.category.colorHex }} />{r.batch.category.name}</span>
        {r.batch.originName && <span>{r.batch.originName}{r.batch.sourceArea ? ` · ${r.batch.sourceArea}` : ""}</span>}
        <span>{r.batch.containerCount} container{r.batch.containerCount === 1 ? "" : "s"}</span>
      </p>
      <p className="mt-4 text-[12.5px] font-semibold uppercase tracking-wide text-ink-3">{enabled.length ? "Next step for your role" : "Nothing for your role to do right now"}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {enabled.map((a) => {
          const viaSimulation = simulated && onSimulate && a.action === "pickup";
          return <Button key={a.action} variant={a.action === "cancel" ? "danger" : "primary"} loading={viaSimulation ? busy : undefined} onClick={() => (viaSimulation ? onSimulate!("pickup") : onAction(a.action))}>{a.label}{viaSimulation ? " (simulated)" : ""}</Button>;
        })}
        <Link to={`/batches/${r.batch.id}`} className="inline-flex h-10 items-center rounded-[10px] border border-line-2 px-4 text-sm font-semibold hover:border-emerald-600">Open full record</Link>
      </div>
      {enabled.length === 0 && r.availableActions.length > 0 && <p className="mt-3 text-sm text-ink-3">{r.availableActions[0].reason}</p>}
    </div>
  );
}

export function Scan() {
  const [result, setResult] = useState<Resolved | null>(null);
  const [dialog, setDialog] = useState<ActionInfo["action"] | null>(null);
  const [last, setLast] = useState<ScanResult | null>(null);
  const { isTransporter, isAdmin } = useActor();
  const plantView = !isTransporter && !isAdmin;
  const qc = useQueryClient();
  const identify = useMutation({
    mutationFn: (s: ScanResult) => { setLast(s); return api.post<Resolved>("/api/identify", { method: s.method, value: s.value, source: s.source }); },
    onSuccess: setResult,
    onError: () => setResult(null),
  });
  // Simulated scans run the real lifecycle action server-side (same checks), recorded as simulated.
  const simulate = useMutation({
    mutationFn: (action: "pickup") => api.post<{ batch: { status: BatchStatus; trackingCode: string }; container: string }>(`/api/demo/batches/${result!.batch.id}/simulate-scan`, { action }),
    onSuccess: (r) => {
      toast.success(`Simulated QR scan of ${r.container}`, { description: `${r.batch.trackingCode} is now ${r.batch.status.replace("_", " ")}.` });
      setResult(result ? { ...result, batch: { ...result.batch, status: r.batch.status }, availableActions: [] } : null);
      for (const k of ["batch", "batches", "dashboard", "assignment", "assignments", "tracking"]) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const onScan = useCallback((s: ScanResult) => identify.mutate(s), [identify.mutate]); // eslint-disable-line
  return (
    <>
      <PageHeader title={plantView ? "Scan incoming batch" : "Scan a container's QR code"} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,560px)_1fr]">
        <Panel>
          <Scanner onResult={onScan} paused={!!dialog} />
        </Panel>
        <div className="flex flex-col gap-4">
          {identify.isPending && <LoadingBlock rows={2} />}
          <FormError error={identify.error} />
          {result ? (
            <ResultCard r={result} onAction={setDialog} simulated={last?.source === "simulated"} onSimulate={(a) => simulate.mutate(a)} busy={simulate.isPending} />
          ) : (
            !identify.isPending && !identify.error && (
              <div className="grid place-items-center rounded-[18px] border-2 border-dashed border-line-2 p-10 text-center text-ink-3">
                <ScanLine className="mb-2 size-8" />
                <p>Waiting for a scan</p>
              </div>
            )
          )}
        </div>
      </div>
      {dialog && result && (
        <ActionDialog
          open
          action={dialog}
          target={{ id: result.batch.id, trackingCode: result.batch.trackingCode, quantity: result.batch.quantity, unit: result.batch.unit }}
          initialScan={last && last.source !== "simulated" ? last : null}
          simulated={last?.source === "simulated"}
          onOpenChange={(o) => !o && setDialog(null)}
          onDone={(status) => setResult({ ...result, batch: { ...result.batch, status }, availableActions: [] })}
        />
      )}
    </>
  );
}

/** Landing point for phone cameras that open the QR URL directly: /s/:token */
export function ScanResolver() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const identify = useMutation({
    mutationFn: () => api.post<Resolved>("/api/identify", { method: "qr", value: token, source: "camera" }),
    onSuccess: (r) => navigate(`/batches/${r.batch.id}`, { replace: true }),
  });
  useEffect(() => identify.mutate(), []); // eslint-disable-line
  return (
    <div className="mx-auto max-w-md p-8">
      {identify.isError ? (
        <>
          <FormError error={identify.error} />
          <Link to="/scan" className="mt-4 inline-block font-semibold text-emerald-700">Open the scanner</Link>
        </>
      ) : (
        <LoadingBlock rows={3} />
      )}
    </div>
  );
}

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, ScanLine } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ActionDialog } from "../components/ActionDialog";
import { Scanner, type ScanResult } from "../components/Scanner";
import { Button, FormError, LoadingBlock, PageHeader, Panel, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { fmtQty } from "../lib/format";
import type { ActionInfo, BatchStatus } from "../lib/types";

interface Resolved {
  container: { id: string; label: string };
  batch: { id: string; trackingCode: string; status: BatchStatus; quantity: number; unit: string };
  availableActions: ActionInfo[];
}

function ResultCard({ r, onAction }: { r: Resolved; onAction: (a: ActionInfo["action"]) => void }) {
  const enabled = r.availableActions.filter((a) => a.enabled);
  return (
    <div className="rounded-[18px] border-2 border-emerald-600 bg-paper p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 className="size-4" /> Label recognised — {r.container.label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Link to={`/batches/${r.batch.id}`} className="font-mono text-2xl font-bold hover:text-emerald-700">{r.batch.trackingCode}</Link>
        <StatusBadge status={r.batch.status} />
        <span className="tabular font-semibold">{fmtQty(r.batch.quantity, r.batch.unit)}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {enabled.map((a) => <Button key={a.action} variant={a.action === "cancel" ? "danger" : "primary"} onClick={() => onAction(a.action)}>{a.label}</Button>)}
        <Link to={`/batches/${r.batch.id}`} className="inline-flex h-10 items-center rounded-[10px] border border-line-2 px-4 text-sm font-semibold hover:border-emerald-600">Open full record</Link>
      </div>
      {enabled.length === 0 && r.availableActions.length > 0 && <p className="mt-3 text-sm text-ink-3">{r.availableActions[0].reason}</p>}
    </div>
  );
}

export function Scan() {
  const [result, setResult] = useState<Resolved | null>(null);
  const [dialog, setDialog] = useState<ActionInfo["action"] | null>(null);
  const identify = useMutation({
    mutationFn: (s: ScanResult) => api.post<Resolved>("/api/identify", { method: s.method, value: s.value, source: s.source }),
    onSuccess: setResult,
    onError: () => setResult(null),
  });
  const onScan = useCallback((s: ScanResult) => identify.mutate(s), [identify.mutate]); // eslint-disable-line
  return (
    <>
      <PageHeader title="Scan a container" description="Point the camera at a BWTS label, use an RFID reader, or type the code. You'll see the batch and what you can do next." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,560px)_1fr]">
        <Panel>
          <Scanner onResult={onScan} paused={!!dialog} />
        </Panel>
        <div className="flex flex-col gap-4">
          {identify.isPending && <LoadingBlock rows={2} />}
          <FormError error={identify.error} />
          {result ? (
            <ResultCard r={result} onAction={setDialog} />
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

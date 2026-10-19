import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Maximize2, Printer, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Link, useParams, useSearchParams } from "react-router";
import { Button, ErrorState, LoadingBlock, PageHeader, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { fmtDate, fmtQty } from "../lib/format";
import type { BatchStatus } from "../lib/types";

interface LabelData {
  batchId: string;
  status: BatchStatus;
  trackingCode: string;
  category: { name: string; code: string; colorHex: string };
  originName: string;
  quantity: number;
  unit: string;
  createdAt: string;
  containerCount: number;
  labels: { containerId: string; label: string; sequence: number; payload: string; svg: string }[];
}

/** The batch's own QR label. The same code is returned every time, from registration to disposal. */
function QrCard({ d, index, large }: { d: LabelData; index: number; large?: boolean }) {
  const l = d.labels[index];
  return (
    <article className="label-card overflow-hidden rounded-[18px] border-2 border-ink bg-white" data-testid="batch-qr">
      <div className="flex items-center justify-between px-4 py-2 text-white" style={{ background: d.category.colorHex }}>
        <span className="font-display text-lg font-extrabold drop-shadow-[0_1px_0_rgb(0_0_0/0.35)]">{d.category.code}</span>
        <span className="text-[12px] font-bold drop-shadow-[0_1px_0_rgb(0_0_0/0.35)]">BIOMEDICAL WASTE · BIOHAZARD</span>
      </div>
      <div className={clsx("flex flex-col items-center gap-4 p-5 sm:flex-row", large && "justify-center gap-10 p-8")}>
        <div className={clsx("shrink-0 [&_svg]:h-auto [&_svg]:w-full", large ? "w-[min(60vh,440px)]" : "w-[240px]")} dangerouslySetInnerHTML={{ __html: l.svg }} role="img" aria-label={`QR code for ${l.label}`} />
        <div className="min-w-0 text-center sm:text-left">
          <p className={clsx("font-mono font-bold", large ? "text-4xl" : "text-xl")} data-testid="qr-tracking-code">{d.trackingCode}</p>
          <p className={clsx("font-semibold", large ? "text-xl" : "text-sm")}>Container {l.sequence} of {d.containerCount}</p>
          <p className="mt-1 text-sm text-ink-2">{d.category.name}</p>
          <p className="text-sm text-ink-2">{d.originName}</p>
          <p className="text-sm text-ink-2">{fmtDate(d.createdAt)} · {fmtQty(d.quantity, d.unit)}</p>
        </div>
      </div>
    </article>
  );
}

export default function BatchQr() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const [idx, setIdx] = useState(0);
  const [full, setFull] = useState(false);
  const q = useQuery({ queryKey: ["labels", id], queryFn: () => api.get<LabelData>(`/api/batches/${id}/labels`) });
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const i = Math.min(idx, d.labels.length - 1);
  return (
    <>
      <div className="no-print">
        <PageHeader
          back={<Link to={`/batches/${id}`} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-emerald-700"><ArrowLeft className="size-4" /> {d.trackingCode}</Link>}
          title={params.get("new") ? "Batch registered" : "Batch QR code"}
          description={<span className="inline-flex items-center gap-2"><span className="font-mono font-semibold text-ink">{d.trackingCode}</span><StatusBadge status={d.status} /></span>}
          actions={
            <>
              <Button variant="secondary" onClick={() => setFull(true)} icon={<Maximize2 className="size-4" />}>Present full screen</Button>
              <Button onClick={() => window.print()} icon={<Printer className="size-4" />}>Print QR Label</Button>
            </>
          }
        />
      </div>
      {d.labels.length > 1 && (
        <div className="no-print mb-4 flex flex-wrap gap-1 rounded-[12px] bg-paper p-1 ring-1 ring-line w-fit" role="tablist" aria-label="Container">
          {d.labels.map((l, n) => (
            <button key={l.containerId} role="tab" aria-selected={n === i} onClick={() => setIdx(n)} className={clsx("rounded-[9px] px-3.5 py-1.5 text-sm font-semibold", n === i ? "bg-emerald-600 text-white" : "text-ink-2 hover:bg-mist")}>Container {l.sequence}</button>
          ))}
        </div>
      )}
      <div className="max-w-[760px]"><QrCard d={d} index={i} /></div>
      <div className="no-print mt-5 flex flex-wrap gap-2">
        <Link to={`/batches/${id}`} className="inline-flex h-10 items-center rounded-[10px] border border-line-2 bg-paper px-4 text-sm font-semibold hover:border-emerald-600">Go to batch</Link>
        {d.labels.length > 1 && <Link to={`/batches/${id}/labels`} className="inline-flex h-10 items-center rounded-[10px] border border-line-2 bg-paper px-4 text-sm font-semibold hover:border-emerald-600">All container labels</Link>}
      </div>
      {full && createPortal(
        <div className="fixed inset-0 z-[200] grid place-items-center overflow-auto bg-white p-4" role="dialog" aria-label="Full-screen QR code">
          <button type="button" onClick={() => setFull(false)} className="no-print absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-[10px] border border-line-2 bg-paper px-3 py-2 text-sm font-semibold hover:border-emerald-600">
            <X className="size-4" /> Close
          </button>
          <div className="w-full max-w-[980px]"><QrCard d={d} index={i} large /></div>
        </div>,
        document.body,
      )}
    </>
  );
}

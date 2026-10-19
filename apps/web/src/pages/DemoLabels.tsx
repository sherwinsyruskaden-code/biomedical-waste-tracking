import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Maximize2, Printer, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { Button, EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import type { BatchStatus } from "../lib/types";

interface DemoBatch {
  batchId: string;
  trackingCode: string;
  status: BatchStatus;
  category: { name: string; code: string; colorHex: string };
  originName: string | null;
  quantity: number;
  unit: string;
  containerCount: number;
  nextActions: string[];
  labels: { label: string; sequence: number; payload: string; svg: string }[];
}

/** A demo label, big enough to be read from across a room. Clearly marked as synthetic. */
function DemoLabel({ b, index, large }: { b: DemoBatch; index: number; large?: boolean }) {
  const l = b.labels[index];
  return (
    <article className="label-card overflow-hidden rounded-[18px] border-2 border-ink bg-white" data-testid="demo-label">
      <div className="bg-amber-400 px-4 py-1.5 text-center text-[12.5px] font-extrabold uppercase tracking-wider text-ink">Sample label · synthetic data · not real waste</div>
      <div className="flex items-center justify-between px-4 py-2 text-white" style={{ background: b.category.colorHex }}>
        <span className="font-display text-lg font-extrabold drop-shadow-[0_1px_0_rgb(0_0_0/0.35)]">{b.category.code}</span>
        <span className="text-[12px] font-bold drop-shadow-[0_1px_0_rgb(0_0_0/0.35)]">BIOMEDICAL WASTE · BIOHAZARD</span>
      </div>
      <div className={clsx("flex flex-col items-center gap-3 p-5 sm:flex-row", large && "justify-center gap-8 p-8")}>
        <div className={clsx("shrink-0 [&_svg]:h-auto [&_svg]:w-full", large ? "w-[min(60vh,420px)]" : "w-[220px]")} dangerouslySetInnerHTML={{ __html: l.svg }} role="img" aria-label={`QR code for ${l.label}`} />
        <div className="min-w-0 text-center sm:text-left">
          <p className={clsx("font-mono font-bold", large ? "text-4xl" : "text-xl")}>{b.trackingCode}</p>
          <p className={clsx("font-semibold", large ? "text-xl" : "text-sm")}>Container {l.sequence} of {b.containerCount}</p>
          <p className="mt-1 text-sm text-ink-2">{b.category.name}</p>
          {b.originName && <p className="text-sm text-ink-2">{b.originName}</p>}
        </div>
      </div>
    </article>
  );
}

export default function DemoLabels() {
  const q = useQuery({ queryKey: ["demo-labels"], queryFn: () => api.get<{ batches: DemoBatch[] }>("/api/demo/labels"), retry: false });
  const [sel, setSel] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [full, setFull] = useState(false);
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const batches = (q.data?.batches ?? []).filter((b) => b.labels.length > 0);
  if (!batches.length)
    return <EmptyState title="No sample labels for this account">Sign in as a hospital, transporter or plant role to see the labels it can scan.</EmptyState>;
  const b = batches.find((x) => x.batchId === sel) ?? batches[0];
  const i = Math.min(idx, b.labels.length - 1);
  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Sample QR labels"
          description="Show one of these on a screen, or print it, and scan it with the Scan page. Each label opens its own synthetic batch and only works in the sample organization."
          actions={<Link to="/scan" className="inline-flex h-10 items-center rounded-[10px] bg-lime px-4 text-sm font-semibold text-ink hover:bg-[#b8e81f]">Go to scanner</Link>}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_1fr]">
        <ul className="no-print flex max-h-[70vh] flex-col gap-2 overflow-y-auto pr-1" aria-label="Sample batches">
          {batches.map((x) => (
            <li key={x.batchId}>
              <button
                type="button"
                onClick={() => { setSel(x.batchId); setIdx(0); }}
                aria-pressed={x.batchId === b.batchId}
                className={clsx("w-full rounded-[14px] border bg-paper p-3 text-left transition-colors", x.batchId === b.batchId ? "border-emerald-600 ring-1 ring-emerald-600" : "border-line hover:border-emerald-500")}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[15px] font-bold">{x.trackingCode}</span>
                  <StatusBadge status={x.status} />
                </span>
                <span className="mt-1 block text-[12.5px] text-ink-3">{x.category.name} · {x.originName}</span>
                <span className="mt-1 block text-[12.5px] text-ink-2">{x.nextActions.length ? `You can: ${x.nextActions.join(", ")}` : "No action for your role right now"}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-4">
          <div className="no-print flex flex-wrap items-center gap-2">
            {b.labels.length > 1 &&
              b.labels.map((l, k) => (
                <Button key={l.label} size="sm" variant={k === i ? "primary" : "secondary"} onClick={() => setIdx(k)}>Container {l.sequence}</Button>
              ))}
            <span className="flex-1" />
            <Button variant="secondary" icon={<Maximize2 className="size-4" />} onClick={() => setFull(true)}>Show full screen</Button>
            <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>Print this label</Button>
          </div>
          <DemoLabel b={b} index={i} />
        </div>
      </div>
      {full && createPortal(
        <div className="fixed inset-0 z-[200] grid place-items-center overflow-auto bg-white p-4" role="dialog" aria-label="Full-screen sample label">
          <button type="button" onClick={() => setFull(false)} className="no-print absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-[10px] border border-line-2 bg-paper px-3 py-2 text-sm font-semibold hover:border-emerald-600">
            <X className="size-4" /> Close
          </button>
          <div className="w-full max-w-[980px]"><DemoLabel b={b} index={i} large /></div>
        </div>,
        document.body,
      )}
    </>
  );
}

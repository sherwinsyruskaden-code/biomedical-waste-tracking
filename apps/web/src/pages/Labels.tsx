import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router";
import { Button, ErrorState, LoadingBlock } from "../components/ui";
import { api } from "../lib/api";
import { fmtDate, fmtQty } from "../lib/format";

interface LabelData {
  trackingCode: string;
  category: { name: string; code: string; colorHex: string; handlingInstructions: string | null };
  originName: string;
  quantity: number;
  unit: string;
  createdAt: string;
  containerCount: number;
  labels: { containerId: string; label: string; sequence: number; payload: string; svg: string }[];
}

export default function Labels() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ["labels", id], queryFn: () => api.get<LabelData>(`/api/batches/${id}/labels`) });
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <>
      <div className="no-print mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <Link to={`/batches/${id}`} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-emerald-700"><ArrowLeft className="size-4" /> {d.trackingCode}</Link>
          <h1 className="text-[30px] font-bold">{params.get("new") ? "Batch registered — print its labels" : "Container labels"}</h1>
          <p className="mt-1 max-w-[70ch] text-ink-2">Attach one label to each container. The QR code holds only a random reference: scanning it shows details to signed-in members of your organization and nobody else.</p>
        </div>
        <div className="flex gap-2">
          <Link to={`/batches/${id}`} className="inline-flex h-10 items-center rounded-[10px] border border-line-2 bg-paper px-4 text-sm font-semibold hover:border-emerald-600">Go to batch</Link>
          <Button onClick={() => window.print()} icon={<Printer className="size-4" />}>Print {d.labels.length} label{d.labels.length > 1 ? "s" : ""}</Button>
        </div>
      </div>
      <div className="label-sheet grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {d.labels.map((l) => (
          <article key={l.containerId} className="label-card overflow-hidden rounded-[14px] border-2 border-ink bg-white">
            <div className="flex items-center justify-between px-4 py-2 text-white" style={{ background: d.category.colorHex }}>
              <span className="font-display text-lg font-extrabold drop-shadow-[0_1px_0_rgb(0_0_0/0.35)]">{d.category.code}</span>
              <span className="text-[12px] font-bold drop-shadow-[0_1px_0_rgb(0_0_0/0.35)]">BIOMEDICAL WASTE · BIOHAZARD</span>
            </div>
            <div className="flex gap-3 p-3">
              <div className="w-[132px] shrink-0 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: l.svg }} role="img" aria-label={`QR code for ${l.label}`} />
              <div className="min-w-0 text-[12.5px] leading-snug">
                <p className="font-mono text-[14px] font-bold">{d.trackingCode}</p>
                <p className="font-semibold">Container {l.sequence} of {d.containerCount}</p>
                <p className="mt-1.5 text-ink-2">{d.originName}</p>
                <p className="text-ink-2">{fmtDate(d.createdAt)} · {fmtQty(d.quantity, d.unit)} total</p>
                {d.category.handlingInstructions && <p className="mt-1.5 line-clamp-3 text-[11.5px] text-ink-3">{d.category.handlingInstructions}</p>}
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

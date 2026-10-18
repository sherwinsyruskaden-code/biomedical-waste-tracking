import { useQuery } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ActionDialog } from "../components/ActionDialog";
import { Button, CategoryChip, EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from "../components/ui";
import { api, qs } from "../lib/api";
import { fmtQty, timeAgo } from "../lib/format";
import { useCategories } from "../lib/queries";
import { useActor } from "../lib/session";
import type { BatchListItem, Paged } from "../lib/types";

const tabs = [
  { id: "delivered", label: "Awaiting receipt", action: "receive" as const, actionLabel: "Confirm receipt", empty: "Nothing waiting at the gate. Delivered batches appear here after the transporter scans the handover." },
  { id: "received", label: "Awaiting disposal", action: "dispose" as const, actionLabel: "Record disposal", empty: "No received waste is waiting for treatment." },
  { id: "rejected", label: "Rejected loads", action: "reroute" as const, actionLabel: "Reroute", empty: "No rejected deliveries." },
];

export default function Receiving() {
  const [params, setParams] = useSearchParams();
  const { isAdmin, facilityIds } = useActor();
  const tab = tabs.find((t) => t.id === params.get("tab")) ?? tabs[0];
  const categories = useCategories();
  const [dialog, setDialog] = useState<BatchListItem | null>(null);
  const q = useQuery({ queryKey: ["batches", "receiving", tab.id], queryFn: () => api.get<Paged<BatchListItem>>(`/api/batches${qs({ status: tab.id, pageSize: 100, sort: "oldest" })}`) });
  // The API already scopes staff to batches at their own facilities.
  // The API scopes staff to batches touching their facilities; only the receiving side acts here.
  const items = (q.data?.items ?? []).filter((b) => isAdmin || (!!b.destinationFacilityId && facilityIds.includes(b.destinationFacilityId)));
  return (
    <>
      <PageHeader title="Receipt & disposal" description="Confirm what arrives at the treatment facility, weigh it, and record how it was treated. Oldest first." />
      <div className="mb-4 flex w-fit flex-wrap gap-1 rounded-[12px] bg-paper p-1 ring-1 ring-line" role="tablist">
        {tabs.filter((t) => t.id !== "rejected" || isAdmin).map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === tab.id} onClick={() => setParams({ tab: t.id })} className={`rounded-[9px] px-3.5 py-1.5 text-sm font-semibold ${t.id === tab.id ? "bg-emerald-600 text-white" : "text-ink-2 hover:bg-mist"}`}>{t.label}</button>
        ))}
      </div>
      <div className="overflow-hidden rounded-[16px] border border-line bg-paper">
        {q.isLoading ? (
          <div className="p-5"><LoadingBlock /></div>
        ) : q.isError ? (
          <div className="p-5"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>
        ) : items.length === 0 ? (
          <EmptyState icon={<PackageCheck />} title="All clear">{tab.empty}</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((b) => (
              <li key={b.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/batches/${b.id}`} className="font-mono font-semibold hover:text-emerald-700">{b.trackingCode}</Link>
                    <StatusBadge status={b.status} />
                    <span className="text-[12.5px] text-ink-3">{timeAgo(b.statusChangedAt)}</span>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-ink-2">
                    <CategoryChip code={b.category.code} color={b.category.colorHex} compact />
                    <span className="tabular font-semibold text-ink">{fmtQty(b.quantity, b.unit)}</span>
                    <span>from {b.originName}</span>
                    {b.destinationName && <span>at {b.destinationName}</span>}
                  </p>
                </div>
                <Button onClick={() => setDialog(b)}>{tab.actionLabel}</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!isAdmin && facilityIds.length === 0 && <p className="mt-3 text-sm text-ink-3">You aren't assigned to any facility, so nothing is listed. Ask your admin.</p>}
      {dialog && (
        <ActionDialog
          open
          action={tab.action}
          target={{ id: dialog.id, trackingCode: dialog.trackingCode, quantity: dialog.quantity, unit: dialog.unit, category: categories.data?.find((c) => c.id === dialog.category.id) }}
          onOpenChange={(o) => !o && setDialog(null)}
        />
      )}
    </>
  );
}

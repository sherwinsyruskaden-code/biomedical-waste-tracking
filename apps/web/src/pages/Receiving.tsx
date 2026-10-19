import { useQuery } from "@tanstack/react-query";
import { PackageCheck, ScanLine } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ActionDialog } from "../components/ActionDialog";
import { Button, CategoryChip, EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from "../components/ui";
import { api, qs } from "../lib/api";
import { fmtDateTime, fmtQty } from "../lib/format";
import { useCategories } from "../lib/queries";
import { useActor } from "../lib/session";
import type { BatchListItem, Paged } from "../lib/types";

/** The plant's active queue, one tab per stage: on the way, arrived, received (awaiting treatment). */
const tabs = [
  { id: "in_transit", label: "In transit", status: "collected,in_transit", action: null, since: "set off", empty: "Nothing is on its way to your plant right now." },
  { id: "delivered", label: "Arrived — awaiting receipt", status: "delivered", action: "receive" as const, actionLabel: "Confirm Receipt", since: "arrived", empty: "Nothing is waiting at the gate. Batches appear here when the transporter records arrival." },
  { id: "received", label: "Received", status: "received", action: "dispose" as const, actionLabel: "Record disposal", since: "received", empty: "No received waste is waiting for treatment." },
  { id: "rejected", label: "Rejected loads", status: "rejected", action: "reroute" as const, actionLabel: "Reroute", since: "rejected", empty: "No rejected deliveries." },
];

export default function Receiving() {
  const [params, setParams] = useSearchParams();
  const { isAdmin, facilityIds } = useActor();
  const tab = tabs.find((t) => t.id === params.get("tab")) ?? tabs[1];
  const categories = useCategories();
  const [dialog, setDialog] = useState<BatchListItem | null>(null);
  const q = useQuery({ queryKey: ["batches", "receiving", tab.id], queryFn: () => api.get<Paged<BatchListItem>>(`/api/batches${qs({ status: tab.status, pageSize: 100, sort: "oldest" })}`) });
  // The API already limits plant staff to batches addressed to their plant that are on their way or later.
  const items = (q.data?.items ?? []).filter((b) => isAdmin || (!!b.destinationFacilityId && facilityIds.includes(b.destinationFacilityId)));
  return (
    <>
      <PageHeader
        title={isAdmin ? "Receipt & disposal" : "Arrivals & disposal"}
        description="Scan an arriving batch or pick it from the list, confirm receipt, then record the treatment. Oldest first."
        actions={!isAdmin && <Link to="/scan" className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-lime px-4 text-sm font-semibold text-ink hover:bg-[#b8e81f]"><ScanLine className="size-4" /> Scan Incoming Batch</Link>}
      />
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
              <li key={b.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center" data-testid="arrival-row">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/batches/${b.id}`} className="font-mono font-semibold hover:text-emerald-700">{b.trackingCode}</Link>
                    <StatusBadge status={b.status} />
                    <span className="text-[12.5px] text-ink-3">{tab.since} {fmtDateTime(b.statusChangedAt)}</span>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
                    <CategoryChip code={b.category.code} color={b.category.colorHex} compact />
                    <span className="tabular font-semibold text-ink">{fmtQty(b.quantity, b.unit)}</span>
                    <span>from {b.originName}</span>
                    {b.transporterName && <span>by {b.transporterName}</span>}
                  </p>
                </div>
                {tab.action && <Button onClick={() => setDialog(b)} disabled={isAdmin && tab.action !== "reroute"} title={isAdmin && tab.action !== "reroute" ? "Only treatment-plant staff can do this" : undefined}>{tab.actionLabel}</Button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {!isAdmin && facilityIds.length === 0 && <p className="mt-3 text-sm text-ink-3">You aren't assigned to any facility, so nothing is listed. Ask your admin.</p>}
      {dialog && tab.action && (
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

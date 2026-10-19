import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Plus, Search } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CategoryChip, EmptyState, ErrorState, Input, LoadingBlock, PageHeader, Pagination, Select, StatusBadge } from "../components/ui";
import { api, qs } from "../lib/api";
import { fmtDateTime, fmtQty, timeAgo } from "../lib/format";
import { useCategories, useFacilities } from "../lib/queries";
import { MIN_DAY, dayIssue, todayIn } from "../lib/dates";
import { useActor, useOrgTimezone } from "../lib/session";
import type { BatchListItem, Paged } from "../lib/types";

const statusPresets: [string, string][] = [
  ["", "All statuses"],
  ["generated,segregated", "Awaiting collection"],
  ["generated", "— Generated"],
  ["segregated", "— Segregated"],
  ["collected,in_transit", "On the road"],
  ["delivered", "Awaiting receipt"],
  ["received", "Awaiting disposal"],
  ["disposed", "Disposed"],
  ["rejected", "Rejected"],
  ["cancelled", "Cancelled"],
];

export default function Batches() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { isTransporter } = useActor();
  const facilities = useFacilities();
  const categories = useCategories();
  const f = {
    q: params.get("q") ?? "",
    status: params.get("status") ?? "",
    categoryId: params.get("categoryId") ?? "",
    facilityId: params.get("facilityId") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    page: Number(params.get("page") ?? 1),
  };
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "page") next.delete("page");
    setParams(next, { replace: true });
  };
  const tz = useOrgTimezone();
  const today = todayIn(tz);
  const dateError =
    (f.from && dayIssue(f.from, tz) && `From: ${dayIssue(f.from, tz)}`) ||
    (f.to && dayIssue(f.to, tz) && `To: ${dayIssue(f.to, tz)}`) ||
    (f.from && f.to && f.from > f.to ? "The From date must be on or before the To date." : null);
  const query = useQuery({
    enabled: !dateError,
    queryKey: ["batches", f],
    queryFn: () =>
      api.get<Paged<BatchListItem>>(
        `/api/batches${qs({ q: f.q, status: f.status, categoryId: f.categoryId, facilityId: f.facilityId, from: f.from, to: f.to, page: f.page, pageSize: 20 })}`,
      ),
    placeholderData: (prev) => prev,
  });
  const filtered = f.q || f.status || f.categoryId || f.facilityId || f.from || f.to;

  return (
    <>
      <PageHeader
        title="Waste batches"
        description="Every batch from registration to disposal. Click a row for its full chain of custody."
        actions={
          !isTransporter && (
            <Link to="/batches/new" className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">
              <Plus className="size-4" /> Register batch
            </Link>
          )
        }
      />
      <div className="mb-4 grid gap-2 rounded-[16px] border border-line bg-paper p-3 md:grid-cols-[1.4fr_1fr_1fr_1fr] lg:grid-cols-[1.6fr_1fr_1fr_1fr_0.8fr_0.8fr]">
        <label className="relative">
          <span className="sr-only">Search by tracking code or ward</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <Input className="pl-9" placeholder="Tracking code or ward" defaultValue={f.q} onChange={(e) => set("q", e.target.value.trim())} />
        </label>
        <Select aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value)}>
          {statusPresets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select aria-label="Category" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
          <option value="">All categories</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name.split("—")[0].trim()}</option>)}
        </Select>
        <Select aria-label="Facility" value={f.facilityId} onChange={(e) => set("facilityId", e.target.value)}>
          <option value="">All facilities</option>
          {facilities.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
        <Input type="date" aria-label="Registered from" min={MIN_DAY} max={today} aria-invalid={!!dateError || undefined} value={f.from} onChange={(e) => set("from", e.target.value)} />
        <Input type="date" aria-label="Registered to" min={MIN_DAY} max={today} aria-invalid={!!dateError || undefined} value={f.to} onChange={(e) => set("to", e.target.value)} />
      </div>
      {dateError && <p className="-mt-2 mb-3 text-[13px] text-danger" role="alert">{dateError}</p>}

      <div className="overflow-hidden rounded-[16px] border border-line bg-paper">
        {query.isLoading ? (
          <div className="p-5"><LoadingBlock rows={6} /></div>
        ) : query.isError ? (
          <div className="p-5"><ErrorState error={query.error} onRetry={() => query.refetch()} /></div>
        ) : query.data!.items.length === 0 ? (
          <EmptyState
            icon={<ClipboardList />}
            title={filtered ? "No batches match these filters" : "No waste batches yet"}
            action={filtered ? <button className="text-sm font-semibold text-emerald-700" onClick={() => setParams({})}>Clear filters</button> : !isTransporter && <Link to="/batches/new" className="text-sm font-semibold text-emerald-700">Register the first batch</Link>}
          >
            {filtered ? "Try widening the date range or status." : "Register waste at a facility to create its QR labels and start the custody record."}
          </EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-mist text-left text-[12.5px] text-ink-3">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Tracking code</th>
                    <th className="px-3 py-3 font-semibold">Category</th>
                    <th className="px-3 py-3 text-right font-semibold">Quantity</th>
                    <th className="px-3 py-3 font-semibold">Origin → Destination</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 text-right font-semibold">Registered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {query.data!.items.map((b) => (
                    <tr key={b.id} className="cursor-pointer hover:bg-mist/70" onClick={() => navigate(`/batches/${b.id}`)}>
                      <td className="px-5 py-3">
                        <Link to={`/batches/${b.id}`} className="font-mono font-semibold text-ink hover:text-emerald-700" onClick={(e) => e.stopPropagation()}>{b.trackingCode}</Link>
                        <span className="block text-[12.5px] text-ink-3">{b.containerCount} container{b.containerCount > 1 ? "s" : ""}{b.sourceArea ? ` · ${b.sourceArea}` : ""}</span>
                      </td>
                      <td className="px-3 py-3"><CategoryChip code={b.category.code} color={b.category.colorHex} compact /></td>
                      <td className="tabular px-3 py-3 text-right font-semibold">{fmtQty(b.quantity, b.unit)}</td>
                      <td className="px-3 py-3 text-ink-2">{b.originName}<span className="block text-[12.5px] text-ink-3">{b.destinationName ? `→ ${b.destinationName}` : "Destination set on collection request"}</span></td>
                      <td className="px-3 py-3"><StatusBadge status={b.status} /><span className="block pt-1 text-[12px] text-ink-3">{timeAgo(b.statusChangedAt)}</span></td>
                      <td className="px-5 py-3 text-right text-ink-2">{fmtDateTime(b.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={f.page} pageSize={20} total={query.data!.total} onPage={(p) => set("page", String(p))} />
          </>
        )}
      </div>
    </>
  );
}

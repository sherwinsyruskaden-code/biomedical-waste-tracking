import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { MapPinOff, Radio, Truck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { MapLegend, TrackingMap, type MapVehicle } from "../components/TrackingMap";
import { Badge, EmptyState, ErrorState, LoadingBlock, PageHeader, Panel } from "../components/ui";
import { api } from "../lib/api";
import { assignmentMeta, fmtDateTime, fmtTime, timeAgo } from "../lib/format";
import { onLiveLocation } from "../lib/session";
import type { AssignmentStatus, LocationPoint } from "../lib/types";

interface LiveRow {
  id: string;
  reference: string;
  status: AssignmentStatus;
  transporterName: string;
  originName: string;
  destinationName: string;
  originFacilityId: string;
  destinationFacilityId: string;
  vehicleReg: string | null;
  dueBy: string;
  trackingActive: boolean;
  batchCount: number;
  latestPoint: LocationPoint | null;
}
interface LiveData {
  staleAfterMinutes: number;
  serverTime: string;
  assignments: LiveRow[];
  facilities: { id: string; name: string; latitude: number | null; longitude: number | null; type: string }[];
}

export default function Tracking() {
  const live = useQuery({ queryKey: ["tracking", "live"], queryFn: () => api.get<LiveData>("/api/tracking/live"), refetchInterval: 30_000 });
  const [latest, setLatest] = useState<Record<string, LocationPoint>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => onLiveLocation((e) => setLatest((m) => ({ ...m, [e.assignmentId]: e.point }))), []);

  const history = useQuery({
    queryKey: ["tracking", "history", selected],
    queryFn: () => api.get<LocationPoint[]>(`/api/assignments/${selected}/locations?limit=2000`),
    enabled: !!selected,
  });
  const route = useQuery({
    queryKey: ["tracking", "route", selected],
    queryFn: () => api.get<{ available: boolean; reason?: string; coordinates?: [number, number][]; durationSeconds?: number; distanceMeters?: number; from?: string }>(`/api/assignments/${selected}/route`),
    enabled: !!selected,
    staleTime: 120_000,
  });
  // Append live points for the selected job to its drawn history.
  const [liveTail, setLiveTail] = useState<LocationPoint[]>([]);
  useEffect(() => {
    setLiveTail([]);
    if (!selected) return;
    return onLiveLocation((e) => e.assignmentId === selected && setLiveTail((t) => [...t, e.point]));
  }, [selected]);

  const rows = useMemo(() => (live.data?.assignments ?? []).map((a) => ({ ...a, latestPoint: latest[a.id] && (!a.latestPoint || latest[a.id].recordedAt > a.latestPoint.recordedAt) ? latest[a.id] : a.latestPoint })), [live.data, latest]);
  const staleMs = (live.data?.staleAfterMinutes ?? 5) * 60_000;
  const isStale = (p: LocationPoint | null) => !p || now - new Date(p.recordedAt).getTime() > staleMs;

  if (live.isLoading) return <LoadingBlock rows={6} />;
  if (live.isError) return <ErrorState error={live.error} onRetry={() => live.refetch()} />;
  const data = live.data!;
  const sel = rows.find((r) => r.id === selected) ?? null;
  const vehicles: MapVehicle[] = rows
    .filter((r) => r.latestPoint)
    .map((r) => ({ assignmentId: r.id, label: `${r.reference} — ${r.transporterName}`, sublabel: `${r.originName} to ${r.destinationName}`, point: r.latestPoint!, stale: isStale(r.latestPoint), selected: r.id === selected }));
  const facilities = sel ? data.facilities.filter((f) => f.id === sel.originFacilityId || f.id === sel.destinationFacilityId) : data.facilities;

  return (
    <>
      <PageHeader title="Live transport map" description={`Positions come from transporters' phones while they share location for a job. A position older than ${data.staleAfterMinutes} minutes is marked stale.`} />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-[18px] border border-line bg-paper p-1.5">
            <TrackingMap
              facilities={facilities}
              vehicles={sel ? vehicles.filter((v) => v.assignmentId === sel.id) : vehicles}
              history={sel ? [...(history.data ?? []), ...liveTail] : undefined}
              plannedRoute={route.data?.available ? route.data.coordinates : null}
              onSelect={setSelected}
              className="h-[60vh] min-h-[420px] w-full rounded-[14px]"
              fitKey={`${selected ?? "all"}|${history.data?.length ?? 0}|${vehicles.length}`}
            />
          </div>
          <MapLegend showRoute={!!route.data?.available} />
        </div>

        <div className="flex flex-col gap-4">
          {sel && (
            <Panel title={sel.reference} actions={<button className="text-sm font-semibold text-emerald-700 hover:underline" onClick={() => setSelected(null)}>Show all</button>}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-3">Transporter</dt><dd className="font-semibold">{sel.transporterName}{sel.vehicleReg ? ` · ${sel.vehicleReg}` : ""}</dd>
                <dt className="text-ink-3">Route</dt><dd>{sel.originName} to {sel.destinationName}</dd>
                <dt className="text-ink-3">Due</dt><dd>{fmtDateTime(sel.dueBy)}</dd>
                <dt className="text-ink-3">Last fix</dt><dd className={clsx(isStale(sel.latestPoint) && "font-semibold text-danger")}>{sel.latestPoint ? `${fmtTime(sel.latestPoint.recordedAt)} (${timeAgo(sel.latestPoint.recordedAt, now)})` : "No position yet"}</dd>
                {sel.latestPoint?.accuracyM != null && <><dt className="text-ink-3">Accuracy</dt><dd>±{Math.round(sel.latestPoint.accuracyM)} m{sel.latestPoint.accuracyM > 100 && <span className="text-warn"> (poor)</span>}</dd></>}
                {sel.latestPoint?.speedMps != null && <><dt className="text-ink-3">Speed</dt><dd>{Math.round(sel.latestPoint.speedMps * 3.6)} km/h</dd></>}
                <dt className="text-ink-3">Recorded points</dt><dd>{(history.data?.length ?? 0) + liveTail.length}</dd>
              </dl>
              <div className="mt-3 rounded-[10px] bg-mist px-3 py-2 text-[13px] text-ink-2">
                {route.data?.available
                  ? <>Planned route{route.data.from === "current_position" ? " from the last position" : ""}: about {Math.round((route.data.durationSeconds ?? 0) / 60)} min, {((route.data.distanceMeters ?? 0) / 1000).toFixed(1)} km. This is an estimate, not the path driven.</>
                  : <>No planned route: {route.data?.reason ?? "loading…"} The map shows only recorded positions.</>}
              </div>
              <Link to={`/assignments/${sel.id}`} className="mt-3 inline-block text-sm font-semibold text-emerald-700 hover:underline">Open job details</Link>
            </Panel>
          )}

          <Panel title="Active jobs" bodyClassName="p-0">
            {rows.length === 0 ? (
              <EmptyState icon={<Truck />} title="No active transport jobs">Jobs appear here once an admin assigns waste to a transporter.</EmptyState>
            ) : (
              <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
                {rows.map((r) => {
                  const stale = isStale(r.latestPoint);
                  return (
                    <li key={r.id}>
                      <button onClick={() => setSelected(r.id)} className={clsx("flex w-full flex-col gap-1.5 px-5 py-3.5 text-left hover:bg-mist", r.id === selected && "bg-emerald-50")}>
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold">{r.reference}</span>
                          <Badge tone={assignmentMeta[r.status].tone}>{assignmentMeta[r.status].label}</Badge>
                        </span>
                        <span className="text-sm text-ink-2">{r.transporterName} · {r.batchCount} batch{r.batchCount === 1 ? "" : "es"}</span>
                        <span className="flex items-center gap-1.5 text-[12.5px]">
                          {!r.latestPoint ? (
                            <span className="flex items-center gap-1 text-ink-3"><MapPinOff className="size-3.5" /> No position reported{r.trackingActive ? " yet" : " — sharing off"}</span>
                          ) : stale ? (
                            <span className="font-semibold text-danger">Stale · last {timeAgo(r.latestPoint.recordedAt, now)}</span>
                          ) : (
                            <span className="flex items-center gap-1 font-semibold text-signal-deep"><Radio className="size-3.5" /> {timeAgo(r.latestPoint.recordedAt, now)}{r.latestPoint.source === "simulated" && " · simulated"}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

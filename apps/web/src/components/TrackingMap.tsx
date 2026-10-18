import L from "leaflet";
import { Fragment, useEffect, useMemo } from "react";
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { fmtDateTime, timeAgo } from "../lib/format";
import type { LocationPoint } from "../lib/types";

export interface MapFacility {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  type: string;
}
export interface MapVehicle {
  assignmentId: string;
  label: string;
  sublabel?: string;
  point: LocationPoint;
  stale: boolean;
  selected?: boolean;
}

const tileUrl = import.meta.env.VITE_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const attribution = import.meta.env.VITE_MAP_ATTRIBUTION || "&copy; OpenStreetMap contributors";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function facilityIcon(type: string) {
  const treat = type === "treatment";
  return L.divIcon({
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div style="width:30px;height:30px;border-radius:9px;background:${treat ? "#0e1b15" : "#059669"};border:3px solid white;box-shadow:0 2px 8px rgb(0 0 0/.3);display:grid;place-items:center;color:${treat ? "#C6F432" : "white"};font:800 12px/1 var(--font-sans)">${treat ? "T" : "H"}</div>`,
  });
}

function vehicleIcon(v: MapVehicle) {
  const color = v.stale ? "#6b7a72" : v.point.source === "simulated" ? "#d97706" : "#0891b2";
  const heading = v.point.headingDeg;
  const arrow = heading != null ? `<div style="position:absolute;inset:-9px;transform:rotate(${heading}deg)"><div style="margin:0 auto;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:9px solid ${color}"></div></div>` : "";
  const ring = !v.stale ? `<div style="position:absolute;inset:0;border-radius:999px;background:${color};animation:pulse-ring 1.8s infinite"></div>` : "";
  const tag = v.point.source === "simulated" ? `<div style="position:absolute;top:28px;left:50%;transform:translateX(-50%);background:#d97706;color:white;font:800 9px/1 var(--font-sans);padding:3px 5px;border-radius:5px;white-space:nowrap">SIMULATED</div>` : "";
  return L.divIcon({
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<div style="position:relative;width:26px;height:26px">${ring}${arrow}<div style="position:relative;width:26px;height:26px;border-radius:999px;background:${color};border:${v.selected ? 4 : 3}px solid ${v.selected ? "#C6F432" : "white"};box-shadow:0 2px 10px rgb(0 0 0/.35);display:grid;place-items:center"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg></div>${tag}</div>`,
  });
}

function FitBounds({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], 14);
    else map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 15 });
    // only refit when the set of things to show changes, not on every position update
  }, [fitKey]); // eslint-disable-line
  return null;
}

export function TrackingMap({
  facilities,
  vehicles,
  history,
  plannedRoute,
  onSelect,
  className,
  fitKey,
}: {
  facilities: MapFacility[];
  vehicles: MapVehicle[];
  history?: LocationPoint[];
  plannedRoute?: [number, number][] | null;
  onSelect?: (assignmentId: string) => void;
  className?: string;
  fitKey?: string;
}) {
  const facs = facilities.filter((f) => f.latitude != null && f.longitude != null);
  const allPoints = useMemo<[number, number][]>(
    () => [...facs.map((f) => [f.latitude!, f.longitude!] as [number, number]), ...vehicles.map((v) => [v.point.latitude, v.point.longitude] as [number, number]), ...(history ?? []).map((p) => [p.latitude, p.longitude] as [number, number])],
    [facs, vehicles, history],
  );
  const center: [number, number] = allPoints[0] ?? [12.9716, 80.0];
  const key = fitKey ?? `${facs.map((f) => f.id).join()}|${vehicles.map((v) => v.assignmentId).join()}`;
  const deviceHistory = (history ?? []).filter((p) => p.source === "device");
  const simHistory = (history ?? []).filter((p) => p.source === "simulated");
  return (
    <MapContainer center={center} zoom={12} scrollWheelZoom className={className ?? "h-[520px] w-full rounded-[16px]"} attributionControl>
      <TileLayer url={tileUrl} attribution={attribution} maxZoom={19} />
      <FitBounds points={allPoints} fitKey={key} />
      {plannedRoute && plannedRoute.length > 1 && <Polyline positions={plannedRoute} pathOptions={{ color: "#6b7a72", weight: 4, opacity: 0.7, dashArray: "8 10" }} />}
      {deviceHistory.length > 1 && <Polyline positions={deviceHistory.map((p) => [p.latitude, p.longitude] as [number, number])} pathOptions={{ color: "#0891b2", weight: 5, opacity: 0.85 }} />}
      {simHistory.length > 1 && <Polyline positions={simHistory.map((p) => [p.latitude, p.longitude] as [number, number])} pathOptions={{ color: "#d97706", weight: 4, opacity: 0.85, dashArray: "2 8" }} />}
      {facs.map((f) => (
        <Marker key={f.id} position={[f.latitude!, f.longitude!]} icon={facilityIcon(f.type)} title={f.name}>
          <Popup><strong>{f.name}</strong><br />{f.type === "treatment" ? "Treatment facility" : "Facility"}</Popup>
        </Marker>
      ))}
      {vehicles.map((v) => (
        <Fragment key={v.assignmentId}>
          {v.point.accuracyM != null && v.point.accuracyM > 0 && (
            <Circle center={[v.point.latitude, v.point.longitude]} radius={v.point.accuracyM} pathOptions={{ color: v.stale ? "#6b7a72" : "#0891b2", weight: 1, fillOpacity: 0.08 }} />
          )}
          <Marker position={[v.point.latitude, v.point.longitude]} icon={vehicleIcon(v)} eventHandlers={{ click: () => onSelect?.(v.assignmentId) }} title={v.label} zIndexOffset={1000}>
            <Popup>
              <div dangerouslySetInnerHTML={{ __html: `<strong>${esc(v.label)}</strong>${v.sublabel ? `<br/>${esc(v.sublabel)}` : ""}<br/>Last fix ${esc(timeAgo(v.point.recordedAt))} (${esc(fmtDateTime(v.point.recordedAt))})${v.point.accuracyM != null ? `<br/>Accuracy ±${Math.round(v.point.accuracyM)} m` : ""}${v.point.source === "simulated" ? "<br/><b style='color:#d97706'>Simulated position (demo mode)</b>" : ""}${v.stale ? "<br/><b style='color:#e11d48'>Stale — no recent update</b>" : ""}` }} />
            </Popup>
          </Marker>
        </Fragment>
      ))}
    </MapContainer>
  );
}

export function MapLegend({ showRoute }: { showRoute?: boolean }) {
  const item = (swatch: React.ReactNode, label: string) => (
    <li className="flex items-center gap-2">{swatch}<span>{label}</span></li>
  );
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] text-ink-2">
      {item(<span className="size-3 rounded-full bg-signal ring-2 ring-white" />, "Last reported position (device GPS)")}
      {item(<span className="size-3 rounded-full bg-ink-3 ring-2 ring-white" />, "Stale position")}
      {item(<span className="size-3 rounded-full bg-warn ring-2 ring-white" />, "Simulated (demo mode)")}
      {item(<span className="h-1 w-5 rounded bg-signal" />, "Recorded path")}
      {showRoute && item(<span className="h-0 w-5 border-t-2 border-dashed border-ink-3" />, "Planned route (not the actual path)")}
      {item(<span className="size-3 rounded-[4px] bg-emerald-600" />, "Facility")}
      {item(<span className="size-3 rounded-[4px] bg-ink" />, "Treatment facility")}
    </ul>
  );
}

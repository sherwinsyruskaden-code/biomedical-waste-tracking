import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

export interface GeoFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  recordedAt: string;
}

export type GeoState = "off" | "starting" | "active" | "denied" | "unavailable" | "error";

const MIN_INTERVAL_MS = 15_000; // at most one stored fix per 15 s while stationary…
const MIN_DISTANCE_M = 30; // …or sooner if the vehicle moved this far
const FLUSH_EVERY_MS = 10_000;
/** A fix coarser than this is a network/IP guess, not GPS (laptops often report a city or even another country). */
const MAX_ACCURACY_M = 1000;
/** A fix farther than this from both ends of the route is treated as a wrong device location. */
const MAX_FROM_ROUTE_KM = 300;

export interface RoutePoint {
  latitude: number;
  longitude: number;
}

function distanceM(a: GeoFix, b: GeoFix) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Collects real device GPS fixes while `enabled` and uploads them in small batches.
 * - Uses the browser Geolocation API (asks for permission; never runs in the background covertly).
 * - Throttles by time/distance to save battery and data.
 * - Queues fixes during network loss and retries.
 */
export function useGeoTracking(assignmentId: string, enabled: boolean, onServerStop?: () => void, route: RoutePoint[] = []) {
  const [state, setState] = useState<GeoState>("off");
  const [lastFix, setLastFix] = useState<GeoFix | null>(null);
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  const [queued, setQueued] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const queue = useRef<GeoFix[]>([]);
  const lastStored = useRef<GeoFix | null>(null);
  const flushing = useRef(false);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  const flush = useCallback(async () => {
    if (flushing.current || queue.current.length === 0) return;
    flushing.current = true;
    const batch = queue.current.slice(0, 50);
    try {
      await api.post(`/api/assignments/${assignmentId}/locations`, { points: batch });
      queue.current = queue.current.slice(batch.length);
      setLastSentAt(new Date());
      setMessage(null);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 422 || e.status === 404 || e.status === 403)) {
        // Server says sharing is no longer allowed (job finished / tracking off): stop.
        queue.current = [];
        setMessage(e.message);
        onServerStop?.();
      } else if (e instanceof ApiError && e.status === 400) {
        queue.current = queue.current.slice(batch.length); // drop invalid fixes (e.g. bad device clock)
        setMessage(e.message);
      } else {
        setMessage("Offline — positions are queued and will be sent when the connection returns.");
      }
    } finally {
      setQueued(queue.current.length);
      flushing.current = false;
    }
  }, [assignmentId, onServerStop]);

  useEffect(() => {
    if (!enabled) {
      setState("off");
      return;
    }
    if (!("geolocation" in navigator)) {
      setState("unavailable");
      setMessage("This device or browser can't provide GPS.");
      return;
    }
    if (!window.isSecureContext) {
      setState("unavailable");
      setMessage("Location needs https:// (or localhost). Open the app over HTTPS on this phone.");
      return;
    }
    setState("starting");
    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        const fix: GeoFix = {
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy ?? null,
          heading: p.coords.heading != null && !Number.isNaN(p.coords.heading) ? p.coords.heading : null,
          speed: p.coords.speed != null && !Number.isNaN(p.coords.speed) ? p.coords.speed : null,
          recordedAt: new Date(p.timestamp).toISOString(),
        };
        // Do not use a coarse (IP/Wi-Fi guess) fix, or one that is nowhere near the route: it would put the truck on the wrong continent.
        if (fix.accuracy != null && fix.accuracy > MAX_ACCURACY_M) {
          setState("starting");
          setMessage(`Waiting for a precise GPS fix: this device only reports its position to about ${Math.round(fix.accuracy)} m. Turn on precise location, or use a phone.`);
          return;
        }
        if (route.length > 0) {
          const km = Math.min(...route.map((r) => distanceM(fix, { ...fix, latitude: r.latitude, longitude: r.longitude }) / 1000));
          if (km > MAX_FROM_ROUTE_KM) {
            setState("error");
            setMessage(`This device reports a location about ${Math.round(km)} km from the route, which looks wrong (a VPN or a computer's approximate location). It was not shared. Check your location settings, or use a phone near the route.`);
            return;
          }
        }
        setMessage(null);
        setState("active");
        setLastFix(fix);
        const prev = lastStored.current;
        const due = !prev || Date.parse(fix.recordedAt) - Date.parse(prev.recordedAt) >= MIN_INTERVAL_MS || distanceM(prev, fix) >= MIN_DISTANCE_M;
        if (due) {
          lastStored.current = fix;
          queue.current.push(fix);
          if (queue.current.length > 500) queue.current.shift();
          setQueued(queue.current.length);
          if (!prev) void flush(); // send the first fix immediately
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setState("denied");
          setMessage("Location permission was denied. Allow it in your browser's site settings, then turn sharing on again.");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setState("error");
          setMessage("GPS signal unavailable. Move to open sky; we'll keep trying.");
        } else {
          setMessage("Waiting for a GPS fix…");
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30_000 },
    );
    const timer = window.setInterval(() => void flush(), FLUSH_EVERY_MS);
    const online = () => void flush();
    window.addEventListener("online", online);
    // Keep the screen awake while sharing so the browser doesn't suspend GPS (supported browsers only).
    (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock
      ?.request("screen")
      .then((l) => (wakeLock.current = l))
      .catch(() => undefined);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(timer);
      window.removeEventListener("online", online);
      void flush();
      wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
      lastStored.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, flush, route.map((r) => `${r.latitude},${r.longitude}`).join("|")]);

  return { state, lastFix, lastSentAt, queued, message };
}

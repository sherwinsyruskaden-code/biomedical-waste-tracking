import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { api, ApiError } from "./api";
import type { LocationPoint, Me, Role } from "./types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const me = await api.get<Me>("/api/auth/me");
        return me;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

/** The signed-in member. Only use inside the protected app shell. */
export function useActor() {
  const { data } = useMe();
  const role = data?.membership?.role as Role;
  return {
    me: data!,
    role,
    isAdmin: role === "admin",
    isStaff: role === "facility_staff",
    isTransporter: role === "transporter",
    userId: data?.user.id ?? "",
    facilityIds: data?.membership?.facilityIds ?? [],
  };
}

export interface LiveLocationEvent {
  assignmentId: string;
  transporterUserId: string;
  point: LocationPoint;
}

type Listener = (e: LiveLocationEvent) => void;
const locationListeners = new Set<Listener>();
export const onLiveLocation = (fn: Listener) => {
  locationListeners.add(fn);
  return () => void locationListeners.delete(fn);
};

/** Server-sent events: live GPS, notifications and "something changed" hints. */
export function useLiveEvents(enabled: boolean) {
  const qc = useQueryClient();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource("/api/events/stream");
    const refresh = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        for (const k of ["batches", "batch", "dashboard", "assignments", "assignment", "alerts", "incidents", "tracking"]) qc.invalidateQueries({ queryKey: [k] });
      }, 400);
    };
    es.addEventListener("invalidate", refresh);
    es.addEventListener("notification", (ev) => {
      const n = JSON.parse((ev as MessageEvent).data) as { title: string; body: string };
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast(n.title, { description: n.body });
      refresh();
    });
    es.addEventListener("location", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as LiveLocationEvent;
      locationListeners.forEach((fn) => fn(data));
    });
    return () => {
      es.close();
      window.clearTimeout(timer.current);
    };
  }, [enabled, qc]);
}

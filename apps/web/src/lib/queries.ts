import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { Category, Facility, Member } from "./types";

export const useFacilities = (includeInactive = false) =>
  useQuery({ queryKey: ["facilities", includeInactive], queryFn: () => api.get<Facility[]>(`/api/facilities${includeInactive ? "?includeInactive=true" : ""}`), staleTime: 60_000 });
export interface AvailableTransporter {
  userId: string;
  fullName: string;
  phone: string | null;
  vehicleReg: string | null;
}
/** Transporters free for a new order right now (admin dispatch). Always fresh: availability changes with every assignment. */
export const useAvailableTransporters = (enabled = true) =>
  useQuery({ queryKey: ["transporters", "available"], queryFn: () => api.get<{ items: AvailableTransporter[]; total: number; busy: number }>("/api/transporters/available"), enabled, staleTime: 0, refetchOnMount: "always" });
export const useCategories = () => useQuery({ queryKey: ["categories"], queryFn: () => api.get<Category[]>("/api/categories"), staleTime: 60_000 });
export const useMembers = (role?: string) => useQuery({ queryKey: ["members", role ?? "all"], queryFn: () => api.get<Member[]>(`/api/members${role ? `?role=${role}` : ""}`), staleTime: 30_000 });

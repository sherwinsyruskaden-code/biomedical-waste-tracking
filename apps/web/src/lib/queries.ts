import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { Category, Facility, Member } from "./types";

export const useFacilities = (includeInactive = false) =>
  useQuery({ queryKey: ["facilities", includeInactive], queryFn: () => api.get<Facility[]>(`/api/facilities${includeInactive ? "?includeInactive=true" : ""}`), staleTime: 60_000 });
export const useCategories = () => useQuery({ queryKey: ["categories"], queryFn: () => api.get<Category[]>("/api/categories"), staleTime: 60_000 });
export const useMembers = (role?: string) => useQuery({ queryKey: ["members", role ?? "all"], queryFn: () => api.get<Member[]>(`/api/members${role ? `?role=${role}` : ""}`), staleTime: 30_000 });

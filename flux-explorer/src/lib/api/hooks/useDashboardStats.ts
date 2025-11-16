import { useQuery } from "@tanstack/react-query";
import { FluxAPI } from "../client";
import type { DashboardStats } from "@/types/flux-api";

export function useDashboardStats() {
  return useQuery<DashboardStats, Error>({
    queryKey: ["dashboard-stats"],
    queryFn: () => FluxAPI.getDashboardStats(),
    staleTime: 2 * 1000,
    refetchInterval: 2 * 1000,
    refetchIntervalInBackground: true,
    placeholderData: (previousData) => previousData,
  });
}

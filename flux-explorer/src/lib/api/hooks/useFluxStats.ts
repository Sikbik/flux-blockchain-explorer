/**
 * React Query Hooks for Flux Stats
 *
 * Hooks for fetching Flux network statistics and application data
 */

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { FluxStatsAPI, FluxNodeCount, FluxAppSpecification } from "../flux-stats-client";

/**
 * Query keys for Flux stats operations
 */
export const fluxStatsKeys = {
  all: ["flux-stats"] as const,
  nodeCount: () => [...fluxStatsKeys.all, "node-count"] as const,
  apps: () => [...fluxStatsKeys.all, "apps"] as const,
  appsCount: () => [...fluxStatsKeys.all, "apps-count"] as const,
};

/**
 * Hook to fetch FluxNode count
 */
export function useFluxNodeCount(): UseQueryResult<FluxNodeCount, Error> {
  return useQuery<FluxNodeCount, Error>({
    queryKey: fluxStatsKeys.nodeCount(),
    queryFn: () => FluxStatsAPI.getNodeCount(),
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}

/**
 * Hook to fetch all running applications
 */
export function useFluxApps(): UseQueryResult<FluxAppSpecification[], Error> {
  return useQuery<FluxAppSpecification[], Error>({
    queryKey: fluxStatsKeys.apps(),
    queryFn: () => FluxStatsAPI.getGlobalAppsSpecifications(),
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });
}

/**
 * Hook to fetch count of running applications (unique apps)
 */
export function useFluxAppsCount(): UseQueryResult<number, Error> {
  return useQuery<number, Error>({
    queryKey: fluxStatsKeys.appsCount(),
    queryFn: () => FluxStatsAPI.getRunningAppsCount(),
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });
}

/**
 * Hook to fetch count of running application instances (total instances)
 */
export function useFluxInstancesCount(): UseQueryResult<number, Error> {
  return useQuery<number, Error>({
    queryKey: [...fluxStatsKeys.all, "instances-count"],
    queryFn: () => FluxStatsAPI.getRunningInstancesCount(),
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });
}

/**
 * Hook to fetch Arcane OS adoption statistics
 */
export function useArcaneAdoption(): UseQueryResult<{ arcane: number; legacy: number; total: number; percentage: number }, Error> {
  return useQuery<{ arcane: number; legacy: number; total: number; percentage: number }, Error>({
    queryKey: [...fluxStatsKeys.all, "arcane-adoption"],
    queryFn: () => FluxStatsAPI.getArcaneAdoption(),
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });
}

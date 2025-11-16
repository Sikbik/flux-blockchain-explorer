/**
 * React Query Hooks for Network and Statistics Operations
 *
 * Provides hooks for fetching network status, sync status,
 * blockchain statistics, and supply information.
 */

import { useQuery, UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import { FluxAPI } from "../client";
import type { NetworkStatus, SyncStatus, BlockchainStats } from "@/types/flux-api";

/**
 * Query keys for network operations
 */
export const networkKeys = {
  all: ["network"] as const,
  status: () => [...networkKeys.all, "status"] as const,
  sync: () => [...networkKeys.all, "sync"] as const,
  stats: () => [...networkKeys.all, "stats"] as const,
  statsWithDays: (days: number) => [...networkKeys.stats(), days] as const,
  supply: () => [...networkKeys.all, "supply"] as const,
  estimateFee: (nbBlocks: number) => [...networkKeys.all, "estimateFee", nbBlocks] as const,
};

/**
 * Hook to fetch network status
 *
 * @param options - React Query options
 * @returns Query result with network status and info
 *
 * @example
 * ```tsx
 * const { data: status } = useNetworkStatus();
 *
 * if (status) {
 *   console.log('Block height:', status.info.blocks);
 *   console.log('Connections:', status.info.connections);
 *   console.log('Difficulty:', status.info.difficulty);
 * }
 * ```
 */
export function useNetworkStatus(
  options?: Omit<UseQueryOptions<NetworkStatus, Error>, "queryKey" | "queryFn">
): UseQueryResult<NetworkStatus, Error> {
  return useQuery<NetworkStatus, Error>({
    queryKey: networkKeys.status(),
    queryFn: () => FluxAPI.getStatus(),
    staleTime: 2 * 1000, // 2 seconds
    refetchInterval: 2 * 1000, // Refetch every 2 seconds for near-instant updates
    ...options,
  });
}

/**
 * Hook to fetch sync status
 *
 * Useful for determining if the node is fully synced
 *
 * @param options - React Query options
 * @returns Query result with sync status
 *
 * @example
 * ```tsx
 * const { data: syncStatus } = useSyncStatus();
 *
 * if (syncStatus) {
 *   if (syncStatus.status === 'syncing') {
 *     console.log('Sync progress:', syncStatus.syncPercentage + '%');
 *   } else if (syncStatus.status === 'synced') {
 *     console.log('Fully synced at height:', syncStatus.height);
 *   }
 * }
 * ```
 */
export function useSyncStatus(
  options?: Omit<UseQueryOptions<SyncStatus, Error>, "queryKey" | "queryFn">
): UseQueryResult<SyncStatus, Error> {
  return useQuery<SyncStatus, Error>({
    queryKey: networkKeys.sync(),
    queryFn: () => FluxAPI.getSyncStatus(),
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000, // Refetch every 30 seconds while syncing
    ...options,
  });
}

/**
 * Hook to fetch blockchain statistics
 *
 * @param days - Number of days to get stats for (optional)
 * @param options - React Query options
 * @returns Query result with blockchain statistics
 *
 * @example
 * ```tsx
 * // Get current stats
 * const { data: stats } = useBlockchainStats();
 *
 * // Get stats for last 7 days
 * const { data: weekStats } = useBlockchainStats(7);
 *
 * if (stats) {
 *   console.log('Total transactions:', stats.totalTransactions);
 *   console.log('Average block size:', stats.avgBlockSize);
 * }
 * ```
 */
export function useBlockchainStats(
  days?: number,
  options?: Omit<UseQueryOptions<BlockchainStats, Error>, "queryKey" | "queryFn">
): UseQueryResult<BlockchainStats, Error> {
  return useQuery<BlockchainStats, Error>({
    queryKey: days ? networkKeys.statsWithDays(days) : networkKeys.stats(),
    queryFn: () => FluxAPI.getStats(days),
    staleTime: 5 * 60 * 1000, // 5 minutes - stats don't change frequently
    ...options,
  });
}

/**
 * Hook to fetch current FLUX supply
 *
 * @param options - React Query options
 * @returns Query result with current supply
 *
 * @example
 * ```tsx
 * const { data: supply } = useSupply();
 * console.log('Current FLUX supply:', supply);
 * ```
 */
export function useSupply(
  options?: Omit<UseQueryOptions<number, Error>, "queryKey" | "queryFn">
): UseQueryResult<number, Error> {
  return useQuery<number, Error>({
    queryKey: networkKeys.supply(),
    queryFn: () => FluxAPI.getSupply(),
    staleTime: 10 * 60 * 1000, // 10 minutes - supply changes slowly
    ...options,
  });
}

/**
 * Hook to estimate transaction fee
 *
 * @param nbBlocks - Number of blocks for confirmation target (default: 2)
 * @param options - React Query options
 * @returns Query result with estimated fee per KB
 *
 * @example
 * ```tsx
 * const { data: fee } = useEstimateFee(2); // Estimate for 2 blocks
 * console.log('Estimated fee per KB:', fee);
 * ```
 */
export function useEstimateFee(
  nbBlocks: number = 2,
  options?: Omit<UseQueryOptions<number, Error>, "queryKey" | "queryFn">
): UseQueryResult<number, Error> {
  return useQuery<number, Error>({
    queryKey: networkKeys.estimateFee(nbBlocks),
    queryFn: () => FluxAPI.estimateFee(nbBlocks),
    staleTime: 60 * 1000, // 1 minute
    ...options,
  });
}

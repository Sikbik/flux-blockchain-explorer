/**
 * React Query Hooks for Block Operations
 *
 * Provides hooks for fetching and managing block data with
 * automatic caching, refetching, and error handling.
 * Now with adaptive polling based on API configuration.
 */

import { useQuery, UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import type { Block, BlockSummary } from "@/types/flux-api";
import { getApiConfig } from "../config";
import ky from "ky";

/**
 * Query keys for block operations
 */
export const blockKeys = {
  all: ["blocks"] as const,
  lists: () => [...blockKeys.all, "list"] as const,
  list: (limit: number) => [...blockKeys.lists(), { limit }] as const,
  details: () => [...blockKeys.all, "detail"] as const,
  detail: (hashOrHeight: string | number) => [...blockKeys.details(), hashOrHeight] as const,
  index: (height: number) => [...blockKeys.all, "index", height] as const,
  raw: (hashOrHeight: string | number) => [...blockKeys.all, "raw", hashOrHeight] as const,
};

/**
 * Hook to fetch a block by hash or height
 *
 * @param hashOrHeight - Block hash (string) or height (number)
 * @param options - React Query options
 * @returns Query result with block data
 *
 * @example
 * ```tsx
 * const { data: block, isLoading, error } = useBlock("00000000000000001234");
 * ```
 */
export function useBlock(
  hashOrHeight: string | number,
  options?: Omit<UseQueryOptions<Block, Error>, "queryKey" | "queryFn">
): UseQueryResult<Block, Error> {
  const config = getApiConfig();
  const identifier = encodeURIComponent(String(hashOrHeight));

  return useQuery<Block, Error>({
    queryKey: blockKeys.detail(hashOrHeight),
    queryFn: () => ky.get(`/api/blocks/${identifier}`).json<Block>(),
    enabled: !!hashOrHeight,
    staleTime: config.staleTime, // Use dynamic stale time
    ...options,
  });
}

/**
 * Hook to fetch raw block data
 *
 * @param hashOrHeight - Block hash (string) or height (number)
 * @param options - React Query options
 * @returns Query result with raw block hex
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useRawBlock(12345);
 * if (data) {
 *   console.log(data.rawblock);
 * }
 * ```
 */
export function useRawBlock(
  hashOrHeight: string | number,
  options?: Omit<UseQueryOptions<{ rawblock: string }, Error>, "queryKey" | "queryFn">
): UseQueryResult<{ rawblock: string }, Error> {
  const config = getApiConfig();
  const identifier = encodeURIComponent(String(hashOrHeight));

  return useQuery<{ rawblock: string }, Error>({
    queryKey: blockKeys.raw(hashOrHeight),
    queryFn: () =>
      ky
        .get(`/api/blocks/${identifier}`, {
          searchParams: { raw: "true" },
        })
        .json<{ rawblock: string }>(),
    enabled: !!hashOrHeight,
    staleTime: config.staleTime, // Use dynamic stale time
    ...options,
  });
}

/**
 * Hook to fetch block index/summary by height
 *
 * @param height - Block height
 * @param options - React Query options
 * @returns Query result with block summary
 *
 * @example
 * ```tsx
 * const { data: blockSummary } = useBlockIndex(100000);
 * ```
 */
export function useBlockIndex(
  height: number,
  options?: Omit<UseQueryOptions<BlockSummary, Error>, "queryKey" | "queryFn">
): UseQueryResult<BlockSummary, Error> {
  const config = getApiConfig();
  const identifier = encodeURIComponent(String(height));

  return useQuery<BlockSummary, Error>({
    queryKey: blockKeys.index(height),
    queryFn: () =>
      ky
        .get(`/api/blocks/${identifier}`, {
          searchParams: { summary: "true" },
        })
        .json<BlockSummary>(),
    enabled: height > 0,
    staleTime: config.staleTime, // Use dynamic stale time
    ...options,
  });
}

/**
 * Hook to fetch latest blocks
 * Uses adaptive polling interval based on API configuration
 *
 * @param limit - Number of blocks to fetch (default: 10)
 * @param options - React Query options
 * @returns Query result with array of block summaries
 *
 * @example
 * ```tsx
 * const { data: blocks, isLoading } = useLatestBlocks(20);
 * ```
 */
export function useLatestBlocks(
  limit: number = 10,
  options?: Omit<UseQueryOptions<BlockSummary[], Error>, "queryKey" | "queryFn">
): UseQueryResult<BlockSummary[], Error> {
  const config = getApiConfig();
  const effectiveLimit = Math.max(1, Math.floor(limit));
  const pollInterval = Math.max(1000, Math.min(config.refetchInterval, 2000));
  const staleWindow = Math.min(config.staleTime, pollInterval);

  return useQuery<BlockSummary[], Error>({
    queryKey: blockKeys.list(effectiveLimit),
    queryFn: () =>
      ky
        .get("/api/blocks/latest", {
          searchParams: { limit: effectiveLimit.toString() },
        })
        .json<BlockSummary[]>(),
    staleTime: staleWindow,
    refetchInterval: pollInterval,
    refetchIntervalInBackground: true,
    placeholderData: (previousData) => previousData,
    ...options,
  });
}

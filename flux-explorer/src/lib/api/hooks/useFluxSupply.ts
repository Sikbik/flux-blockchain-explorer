/**
 * React Query hooks for Flux supply statistics
 */

import { useQuery } from "@tanstack/react-query";
import { CoinMarketCapAPI } from "../coinmarketcap-client";

/**
 * Hook to fetch Flux supply statistics from CoinMarketCap
 */
export function useFluxSupply() {
  return useQuery({
    queryKey: ["flux-supply"],
    queryFn: () => CoinMarketCapAPI.getFluxSupplyStats(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });
}

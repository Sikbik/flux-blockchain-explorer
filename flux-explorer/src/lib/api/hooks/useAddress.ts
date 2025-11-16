/**
 * React Query Hooks for Address Operations
 *
 * Provides hooks for fetching and managing address data including
 * balances, transactions, and UTXOs with automatic caching.
 */

import { useQuery, UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import { FluxAPI } from "../client";
import type {
  AddressInfo,
  QueryParams,
  AddressTransactionsPage,
} from "@/types/flux-api";

/**
 * Query keys for address operations
 */
export const addressKeys = {
  all: ["addresses"] as const,
  details: () => [...addressKeys.all, "detail"] as const,
  detail: (address: string) => [...addressKeys.details(), address] as const,
  balance: (address: string) => [...addressKeys.all, "balance", address] as const,
  totalReceived: (address: string) => [...addressKeys.all, "totalReceived", address] as const,
  totalSent: (address: string) => [...addressKeys.all, "totalSent", address] as const,
  unconfirmedBalance: (address: string) => [...addressKeys.all, "unconfirmedBalance", address] as const,
  utxos: (address: string) => [...addressKeys.all, "utxos", address] as const,
  transactions: (addresses: string[], params?: QueryParams) =>
    [...addressKeys.all, "transactions", addresses, params] as const,
};

/**
 * Hook to fetch address information
 *
 * @param address - Flux address
 * @param options - React Query options
 * @returns Query result with address info including balance and transactions
 *
 * @example
 * ```tsx
 * const { data: addressInfo, isLoading, error } = useAddress('t1abc...');
 *
 * if (addressInfo) {
 *   console.log('Balance:', addressInfo.balance);
 *   console.log('Transactions:', addressInfo.txApperances);
 * }
 * ```
 */
export function useAddress(
  address: string,
  options?: Omit<UseQueryOptions<AddressInfo, Error>, "queryKey" | "queryFn">
): UseQueryResult<AddressInfo, Error> {
  return useQuery<AddressInfo, Error>({
    queryKey: addressKeys.detail(address),
    queryFn: () => FluxAPI.getAddress(address),
    enabled: !!address && address.length > 0,
    staleTime: 30 * 1000, // 30 seconds - balances can change
    ...options,
  });
}

/**
 * Hook to fetch address balance
 *
 * @param address - Flux address
 * @param options - React Query options
 * @returns Query result with balance in FLUX
 *
 * @example
 * ```tsx
 * const { data: balance } = useAddressBalance('t1abc...');
 * ```
 */
export function useAddressBalance(
  address: string,
  options?: Omit<UseQueryOptions<number, Error>, "queryKey" | "queryFn">
): UseQueryResult<number, Error> {
  return useQuery<number, Error>({
    queryKey: addressKeys.balance(address),
    queryFn: () => FluxAPI.getAddressBalance(address),
    enabled: !!address,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000, // Refetch every minute
    ...options,
  });
}

/**
 * Hook to fetch address total received
 *
 * @param address - Flux address
 * @param options - React Query options
 * @returns Query result with total received in FLUX
 *
 * @example
 * ```tsx
 * const { data: totalReceived } = useAddressTotalReceived('t1abc...');
 * ```
 */
export function useAddressTotalReceived(
  address: string,
  options?: Omit<UseQueryOptions<number, Error>, "queryKey" | "queryFn">
): UseQueryResult<number, Error> {
  return useQuery<number, Error>({
    queryKey: addressKeys.totalReceived(address),
    queryFn: () => FluxAPI.getAddressTotalReceived(address),
    enabled: !!address,
    staleTime: 60 * 1000, // 1 minute
    ...options,
  });
}

/**
 * Hook to fetch address total sent
 *
 * @param address - Flux address
 * @param options - React Query options
 * @returns Query result with total sent in FLUX
 *
 * @example
 * ```tsx
 * const { data: totalSent } = useAddressTotalSent('t1abc...');
 * ```
 */
export function useAddressTotalSent(
  address: string,
  options?: Omit<UseQueryOptions<number, Error>, "queryKey" | "queryFn">
): UseQueryResult<number, Error> {
  return useQuery<number, Error>({
    queryKey: addressKeys.totalSent(address),
    queryFn: () => FluxAPI.getAddressTotalSent(address),
    enabled: !!address,
    staleTime: 60 * 1000,
    ...options,
  });
}

/**
 * Hook to fetch address unconfirmed balance
 *
 * @param address - Flux address
 * @param options - React Query options
 * @returns Query result with unconfirmed balance in FLUX
 *
 * @example
 * ```tsx
 * const { data: unconfirmedBalance } = useAddressUnconfirmedBalance('t1abc...');
 * ```
 */
export function useAddressUnconfirmedBalance(
  address: string,
  options?: Omit<UseQueryOptions<number, Error>, "queryKey" | "queryFn">
): UseQueryResult<number, Error> {
  return useQuery<number, Error>({
    queryKey: addressKeys.unconfirmedBalance(address),
    queryFn: () => FluxAPI.getAddressUnconfirmedBalance(address),
    enabled: !!address,
    staleTime: 15 * 1000, // 15 seconds - unconfirmed can change quickly
    refetchInterval: 30 * 1000, // Refetch every 30 seconds
    ...options,
  });
}

/**
 * Hook to fetch address UTXOs (Unspent Transaction Outputs)
 *
 * @param address - Flux address
 * @param options - React Query options
 * @returns Query result with array of UTXOs
 *
 * @example
 * ```tsx
 * const { data: utxos } = useAddressUtxos('t1abc...');
 * const totalUnspent = utxos?.reduce((sum, utxo) => sum + utxo.amount, 0);
 * ```
 */
export function useAddressUtxos(
  address: string,
  options?: Omit<UseQueryOptions<Array<{txid: string; vout: number; value: string; height?: number; confirmations?: number}>, Error>, "queryKey" | "queryFn">
): UseQueryResult<Array<{txid: string; vout: number; value: string; height?: number; confirmations?: number}>, Error> {
  return useQuery({
    queryKey: addressKeys.utxos(address),
    queryFn: () => FluxAPI.getAddressUtxos(address),
    enabled: !!address,
    staleTime: 30 * 1000,
    ...options,
  });
}

/**
 * Hook to fetch transactions for one or more addresses
 *
 * @param addresses - Array of Flux addresses
 * @param params - Query parameters (from, to)
 * @param options - React Query options
 * @returns Query result with paginated transaction list
 *
 * @example
 * ```tsx
 * const { data } = useAddressTransactions(['t1abc...', 't1def...'], {
 *   from: 0,
 *   to: 50
 * });
 *
 * if (data) {
 *   console.log('Total pages:', data.pagesTotal);
 *   console.log('Transactions:', data.items);
 * }
 * ```
 */
export function useAddressTransactions(
  addresses: string[],
  params?: QueryParams,
  options?: Omit<UseQueryOptions<AddressTransactionsPage, Error>, "queryKey" | "queryFn">
): UseQueryResult<AddressTransactionsPage, Error> {
  return useQuery({
    queryKey: addressKeys.transactions(addresses, params),
    queryFn: () => FluxAPI.getAddressTransactions(addresses, params),
    enabled: addresses.length > 0,
    staleTime: 30 * 1000,
    ...options,
  });
}

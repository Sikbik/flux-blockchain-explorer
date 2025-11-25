"use client";

/**
 * Rich List Table Component
 *
 * Displays the top Flux addresses alongside distribution charts.
 */

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Loader2, AlertCircle, TrendingUp, Lock, Server } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as PieTooltip,
  Legend,
} from "recharts";
import type { RichListAddress } from "@/types/rich-list";
import {
  richListLabelMap,
  richListCategoryColors,
  type RichListCategory,
} from "@/data/rich-list-labels";

interface RichListResponse {
  lastUpdate: string;
  lastBlockHeight: number;
  totalSupply: number;
  transparentSupply?: number;
  shieldedPool?: number;
  circulatingSupply?: number;
  totalAddresses: number;
  addresses: RichListAddress[];
}

interface RichListApiResponse extends RichListResponse {
  page: number;
  pageSize: number;
  totalPages: number;
}

const TOP_ADDRESS_COUNT = 1000;
const ROWS_PER_PAGE = 100;

export function RichListTable() {
  const [metadata, setMetadata] = useState<RichListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [addresses, setAddresses] = useState<RichListAddress[]>([]);
  const [excludeSwapPools, setExcludeSwapPools] = useState(true);

  useEffect(() => {
    fetchRichList();
  }, []);

  const fetchRichList = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch both rich list and supply data
      const [richListResponse, supplyResponse] = await Promise.all([
        fetch(`/api/rich-list?page=1&pageSize=${TOP_ADDRESS_COUNT}`),
        fetch('/api/supply')
      ]);

      if (!richListResponse.ok) {
        const errorData = await richListResponse.json();
        throw new Error(errorData.message || "Failed to fetch rich list");
      }

      const richListData: RichListApiResponse = await richListResponse.json();
      const annotated = annotateAddresses(richListData);

      // Parse supply data if available
      let circulatingSupply: number | undefined;
      if (supplyResponse.ok) {
        const supplyData = await supplyResponse.json();
        circulatingSupply = parseFloat(supplyData.circulatingSupply);
      }

      setMetadata({
        lastUpdate: richListData.lastUpdate,
        lastBlockHeight: richListData.lastBlockHeight,
        totalSupply: richListData.totalSupply,
        transparentSupply: richListData.transparentSupply,
        shieldedPool: richListData.shieldedPool,
        circulatingSupply,
        totalAddresses: richListData.totalAddresses,
        addresses: annotated,
      });
      setAddresses(annotated);
      setCurrentPage(1);
    } catch (err) {
      console.error("Error fetching rich list:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load rich list"
      );
    } finally {
      setLoading(false);
    }
  };

  const formatBalance = (balance: number): string => {
    return balance.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    });
  };

  const formatPercentage = (percentage: number): string => {
    return percentage.toFixed(4) + "%";
  };

  const formatAddress = (address: string): string => {
    if (address.length <= 16) return address;
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
  };

  const formatDate = (isoDate: string): string => {
    const date = new Date(isoDate);
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  };

  // Compute derived values with useMemo (must be before any early returns)
  // Filter and recalculate percentages based on swap pool exclusion
  const displayAddresses = useMemo(() => {
    if (!excludeSwapPools) {
      // Include all addresses with original percentages
      return addresses;
    }

    // Filter out swap pools and recalculate percentages
    const filtered = addresses.filter(addr => addr.category !== 'Swap Pool');

    // Calculate total balance of non-swap-pool addresses
    const totalNonSwapBalance = filtered.reduce((sum, addr) => sum + addr.balance, 0);

    // Recalculate percentages based on non-swap-pool total
    return filtered.map((addr, index) => ({
      ...addr,
      rank: index + 1, // Renumber ranks after filtering
      percentage: totalNonSwapBalance > 0 ? (addr.balance / totalNonSwapBalance) * 100 : 0,
    }));
  }, [addresses, excludeSwapPools]);

  const totalPages = Math.max(1, Math.ceil(displayAddresses.length / ROWS_PER_PAGE));
  const paginatedAddresses = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE;
    return displayAddresses.slice(start, start + ROWS_PER_PAGE);
  }, [displayAddresses, currentPage]);

  // Reset to page 1 when filter changes if current page is out of bounds
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [excludeSwapPools, currentPage, totalPages]);

  const breakdown = useMemo(
    () => metadata ? buildCategoryBreakdown(addresses, metadata.totalSupply, metadata.shieldedPool, excludeSwapPools) : [],
    [addresses, metadata, excludeSwapPools]
  );
  const top10Share = useMemo(() => {
    if (!metadata) return 0;
    const top10 = addresses.slice(0, 10);
    const filtered = excludeSwapPools ? top10.filter(addr => addr.category !== 'Swap Pool') : top10;

    // Calculate denominator based on exclusion setting
    let denominator: number;
    if (excludeSwapPools) {
      // Use sum of all non-swap-pool balances (relative distribution)
      denominator = addresses
        .filter(addr => addr.category !== 'Swap Pool')
        .reduce((sum, addr) => sum + addr.balance, 0);
    } else {
      denominator = metadata.totalSupply;
    }

    return computeShare(filtered, denominator);
  }, [addresses, metadata, excludeSwapPools]);

  const top100Share = useMemo(() => {
    if (!metadata) return 0;
    const top100 = addresses.slice(0, 100);
    const filtered = excludeSwapPools ? top100.filter(addr => addr.category !== 'Swap Pool') : top100;

    // Calculate denominator based on exclusion setting
    let denominator: number;
    if (excludeSwapPools) {
      // Use sum of all non-swap-pool balances (relative distribution)
      denominator = addresses
        .filter(addr => addr.category !== 'Swap Pool')
        .reduce((sum, addr) => sum + addr.balance, 0);
    } else {
      denominator = metadata.totalSupply;
    }

    return computeShare(filtered, denominator);
  }, [addresses, metadata, excludeSwapPools]);

  // Loading state
  if (loading && !metadata) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading rich list...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !metadata) {
    return (
      <Alert variant="destructive" className="max-w-2xl mx-auto">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!metadata || addresses.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      <RichListDistribution
        lastUpdate={metadata.lastUpdate}
        lastBlock={metadata.lastBlockHeight}
        totalSupply={metadata.totalSupply}
        transparentSupply={metadata.transparentSupply}
        shieldedPool={metadata.shieldedPool}
        circulatingSupply={metadata.circulatingSupply}
        top10Share={top10Share}
        top100Share={top100Share}
        breakdown={breakdown}
        excludeSwapPools={excludeSwapPools}
        setExcludeSwapPools={setExcludeSwapPools}
      />

      {/* Metadata Info */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <TrendingUp className="h-4 w-4" />
            <span>Total Addresses</span>
          </div>
          <p className="text-2xl font-bold">
            {metadata.totalAddresses.toLocaleString()}
          </p>
        </div>

        <div className="border rounded-lg p-4 bg-card">
          <div className="text-sm text-muted-foreground mb-1">
            Circulating Supply
          </div>
          <p className="text-2xl font-bold">
            {metadata.circulatingSupply
              ? formatBalance(metadata.circulatingSupply)
              : formatBalance(metadata.totalSupply)}{" "}
            FLUX
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Excludes unmined parallel assets
          </p>
        </div>

        <div className="border rounded-lg p-4 bg-card">
          <div className="text-sm text-muted-foreground mb-1">
            Last Updated
          </div>
          <p className="text-sm font-medium">
            Block #{metadata.lastBlockHeight.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatDate(metadata.lastUpdate)}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto overflow-y-visible">
          <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[80px] text-center">Rank</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">Balance (FLUX)</TableHead>
                  <TableHead className="text-right">% of Supply</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">
                    Transactions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedAddresses.map((address) => {
                  const totalNodes = (address.cumulusCount || 0) + (address.nimbusCount || 0) + (address.stratusCount || 0);
                  const hasFluxNodes = totalNodes > 0;

                  return (
                    <TableRow key={address.address} className="hover:bg-muted/30">
                      <TableCell className="text-center font-medium">
                        #{address.rank}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/address/${address.address}`}
                            className="font-mono text-sm hover:text-primary transition-colors"
                          >
                            <span className="hidden lg:inline">{address.address}</span>
                            <span className="lg:hidden">
                              {formatAddress(address.address)}
                            </span>
                          </Link>
                          {hasFluxNodes && (
                            <div className="relative group">
                              <Badge
                                variant="outline"
                                className="cursor-help bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 flex items-center gap-1 px-2 py-0.5"
                              >
                                <Server className="h-3 w-3" />
                                <span className="text-xs font-semibold">{totalNodes}</span>
                              </Badge>
                              {/* Hover tooltip */}
                              <div className="absolute left-0 bottom-full mb-2 p-3 bg-card border rounded-md shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 min-w-[160px]">
                                <div className="space-y-1.5">
                                  <div className="font-semibold text-xs text-muted-foreground mb-1.5 border-b border-border pb-1">
                                    FluxNodes
                                  </div>
                                  {(address.cumulusCount ?? 0) > 0 && (
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-pink-500 font-medium flex items-center gap-1.5 text-xs">
                                        <span className="w-2 h-2 rounded-full bg-pink-500"></span>
                                        Cumulus
                                      </span>
                                      <span className="font-mono font-bold text-xs text-pink-500">{address.cumulusCount}</span>
                                    </div>
                                  )}
                                  {(address.nimbusCount ?? 0) > 0 && (
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-purple-500 font-medium flex items-center gap-1.5 text-xs">
                                        <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                                        Nimbus
                                      </span>
                                      <span className="font-mono font-bold text-xs text-purple-500">{address.nimbusCount}</span>
                                    </div>
                                  )}
                                  {(address.stratusCount ?? 0) > 0 && (
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-blue-500 font-medium flex items-center gap-1.5 text-xs">
                                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                        Stratus
                                      </span>
                                      <span className="font-mono font-bold text-xs text-blue-500">{address.stratusCount}</span>
                                    </div>
                                  )}
                                </div>
                                {/* Arrow pointing down */}
                                <div className="absolute left-4 bottom-[-6px] w-3 h-3 bg-card border-r border-b rotate-45"></div>
                              </div>
                            </div>
                          )}
                        </div>
                        {address.label && (
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
                            <Badge variant="outline" className="border-transparent" style={{ backgroundColor: `${richListCategoryColors[address.category ?? "Unknown"]}1A`, color: richListCategoryColors[address.category ?? "Unknown"] }}>
                              {address.category ?? "Unknown"}
                            </Badge>
                            <span className="font-medium text-foreground">{address.label}</span>
                            {address.locked && (
                              <span className="inline-flex items-center gap-1 text-xs text-amber-500">
                                <Lock className="h-3 w-3" />
                                Locked
                              </span>
                            )}
                            {address.note && (
                              <span className="text-muted-foreground">{address.note}</span>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatBalance(address.balance)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {formatPercentage(address.percentage)}
                      </TableCell>
                      <TableCell className="text-right hidden sm:table-cell">
                        {address.txCount.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Showing {((currentPage - 1) * ROWS_PER_PAGE + 1).toLocaleString()} -{" "}
          {Math.min(currentPage * ROWS_PER_PAGE, displayAddresses.length).toLocaleString()}{" "}
          of {displayAddresses.length.toLocaleString()} addresses
        </p>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1 || loading}
          >
            Previous
          </Button>

          <div className="flex items-center gap-1 px-3 py-1 text-sm">
            Page {currentPage} of {totalPages}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages || loading}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Loading overlay for page changes */}
      {loading && metadata && (
        <div className="fixed inset-0 bg-background/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-4 bg-card p-6 rounded-lg border shadow-lg">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Refreshing rich list...</p>
          </div>
        </div>
      )}
    </div>
  );
}

function annotateAddresses(response: RichListApiResponse): RichListAddress[] {
  const totalSupplyFlux = response.totalSupply;
  const addresses = response.addresses.map((entry) => {
    const mapping = richListLabelMap.get(entry.address);
    const balanceFlux = entry.balance;
    const percentage =
      totalSupplyFlux > 0 ? (balanceFlux / totalSupplyFlux) * 100 : 0;

    return {
      rank: entry.rank,
      address: entry.address,
      balance: balanceFlux,
      percentage,
      txCount: entry.txCount,
      cumulusCount: entry.cumulusCount,
      nimbusCount: entry.nimbusCount,
      stratusCount: entry.stratusCount,
      label: mapping?.label,
      category: mapping?.category,
      note: mapping?.note,
      locked: mapping?.locked,
    };
  });

  return addresses;
}

function buildCategoryBreakdown(
  addresses: RichListAddress[],
  totalSupply: number,
  shieldedPool?: number,
  excludeSwapPools?: boolean
) {
  const buckets = new Map<RichListCategory, number>();
  let unknownBalance = 0;

  // FluxNode collateral constants
  const CUMULUS_COLLATERAL = 1000;
  const NIMBUS_COLLATERAL = 12500;
  const STRATUS_COLLATERAL = 40000;

  // Track FluxNode collateral for unknown/retail holders only
  let cumulusCollateral = 0;
  let nimbusCollateral = 0;
  let stratusCollateral = 0;

  addresses.forEach((addr) => {
    if (addr.category) {
      // Exclude swap pool category if requested
      if (excludeSwapPools && addr.category === 'Swap Pool') {
        // Skip swap pool addresses when excluding
        return;
      }
      buckets.set(
        addr.category,
        (buckets.get(addr.category) || 0) + addr.balance
      );
    } else {
      // For unknown/retail holders, calculate FluxNode collateral
      if (addr.cumulusCount) {
        cumulusCollateral += addr.cumulusCount * CUMULUS_COLLATERAL;
      }
      if (addr.nimbusCount) {
        nimbusCollateral += addr.nimbusCount * NIMBUS_COLLATERAL;
      }
      if (addr.stratusCount) {
        stratusCollateral += addr.stratusCount * STRATUS_COLLATERAL;
      }

      unknownBalance += addr.balance;
    }
  });

  // Subtract FluxNode collateral from unknown balance to avoid double counting
  const unknownNonNodeBalance = unknownBalance - cumulusCollateral - nimbusCollateral - stratusCollateral;

  if (unknownNonNodeBalance > 0) {
    buckets.set("Unknown", unknownNonNodeBalance);
  }

  // Add FluxNode collateral as separate categories
  if (cumulusCollateral > 0) {
    buckets.set("Cumulus Nodes" as RichListCategory, cumulusCollateral);
  }
  if (nimbusCollateral > 0) {
    buckets.set("Nimbus Nodes" as RichListCategory, nimbusCollateral);
  }
  if (stratusCollateral > 0) {
    buckets.set("Stratus Nodes" as RichListCategory, stratusCollateral);
  }

  // Calculate the denominator for percentages
  // When excluding swap pools: use sum of all non-swap-pool balances (relative distribution)
  // When including swap pools: use total supply (absolute percentages)
  let denominator: number;
  if (excludeSwapPools) {
    // Sum of all non-swap-pool category balances
    denominator = Array.from(buckets.values()).reduce((sum, val) => sum + val, 0);
    // Add shielded pool to denominator if available
    if (shieldedPool && shieldedPool > 0) {
      denominator += shieldedPool;
    }
  } else {
    denominator = totalSupply;
  }

  const items: Array<{
    name: string;
    value: number;
    percentage: number;
    color: string;
  }> = Array.from(buckets.entries())
    .map(([category, value]) => ({
      name: category,
      value,
      percentage: denominator > 0 ? (value / denominator) * 100 : 0,
      color: richListCategoryColors[category],
    }))
    .sort((a, b) => b.value - a.value);

  // Add shielded pool as a separate category if available
  if (shieldedPool && shieldedPool > 0) {
    items.unshift({
      name: "Shielded Pool",
      value: shieldedPool,
      percentage: denominator > 0 ? (shieldedPool / denominator) * 100 : 0,
      color: "#8b5cf6", // purple-500 for shielded pool
    });
  }

  // Separate FluxNode categories from other categories to ensure they're always shown
  const fluxNodeCategories = items.filter(item =>
    item.name === "Cumulus Nodes" ||
    item.name === "Nimbus Nodes" ||
    item.name === "Stratus Nodes"
  );
  const otherCategories = items.filter(item =>
    item.name !== "Cumulus Nodes" &&
    item.name !== "Nimbus Nodes" &&
    item.name !== "Stratus Nodes"
  );

  // Take top 6 non-FluxNode categories
  const primaryOther = otherCategories.slice(0, 6);
  const remainder = otherCategories.slice(6);

  // Combine primary categories with FluxNode categories
  const primary = [...primaryOther, ...fluxNodeCategories];

  // Group remaining into "Other" if any
  if (remainder.length > 0) {
    const otherTotal = remainder.reduce((acc, item) => acc + item.value, 0);
    const otherPercentage =
      denominator > 0 ? (otherTotal / denominator) * 100 : 0;
    primary.push({
      name: "Other",
      value: otherTotal,
      percentage: otherPercentage,
      color: "#6b7280", // gray-500
    });
  }

  return primary;
}

function computeShare(addresses: RichListAddress[], totalSupply: number) {
  const total = addresses.reduce((sum, addr) => sum + addr.balance, 0);
  return totalSupply > 0 ? (total / totalSupply) * 100 : 0;
}

interface DistributionProps {
  lastUpdate: string;
  lastBlock: number;
  totalSupply: number;
  transparentSupply?: number;
  shieldedPool?: number;
  circulatingSupply?: number;
  top10Share: number;
  top100Share: number;
  breakdown: Array<{
    name: string;
    value: number;
    percentage: number;
    color: string;
  }>;
  excludeSwapPools: boolean;
  setExcludeSwapPools: (value: boolean) => void;
}

function RichListDistribution({
  lastUpdate,
  lastBlock,
  totalSupply,
  transparentSupply,
  shieldedPool,
  circulatingSupply,
  top10Share,
  top100Share,
  breakdown,
  excludeSwapPools,
  setExcludeSwapPools,
}: DistributionProps) {
  const formattedDate = new Date(lastUpdate);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="border rounded-lg p-6 bg-card space-y-4 lg:col-span-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Rich List Supply Breakdown</h2>
            <p className="text-xs text-muted-foreground">
              Balance distribution across known categories
            </p>
            <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors mt-2">
              <input
                type="checkbox"
                checked={!excludeSwapPools}
                onChange={(e) => setExcludeSwapPools(!e.target.checked)}
                className="rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span>Include Parallel Asset Swap Pools</span>
            </label>
          </div>
          <div className="text-xs text-muted-foreground text-right">
            <div>Block #{lastBlock.toLocaleString()}</div>
            <div>{formattedDate.toLocaleString()}</div>
          </div>
        </div>

        <div className="h-64">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={breakdown}
                dataKey="percentage"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="55%"
                outerRadius="85%"
                paddingAngle={3}
              >
                {breakdown.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <PieTooltip
                formatter={(value: number, name: string, item) => [
                  `${value.toFixed(2)}% (${item.payload.value.toLocaleString()} FLUX)`,
                  name,
                ]}
              />
              <Legend
                verticalAlign="middle"
                align="right"
                layout="vertical"
                iconType="circle"
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="border rounded-lg p-6 bg-card space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Top Holdings</h2>
          <p className="text-xs text-muted-foreground">
            Concentration statistics for leading addresses
          </p>
        </div>

        <div className="space-y-3">
          {circulatingSupply !== undefined && (
            <div className="p-3 rounded-lg bg-muted/50 border">
              <div className="text-xs uppercase text-muted-foreground">
                Circulating Supply
              </div>
              <div className="text-xl font-semibold">
                {circulatingSupply.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                FLUX
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Excludes unmined parallel assets
              </p>
            </div>
          )}

          <div className="p-3 rounded-lg bg-muted/50 border">
            <div className="text-xs uppercase text-muted-foreground">
              Total Supply
            </div>
            <div className="text-xl font-semibold">
              {totalSupply.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              FLUX
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Includes unmined parallel assets
            </p>
          </div>

          {/* Transparent vs Shielded Breakdown */}
          {transparentSupply !== undefined && shieldedPool !== undefined && (
            <div className="p-3 rounded-lg bg-muted/50 border space-y-2">
              <div className="text-xs uppercase text-muted-foreground">
                Total Supply Breakdown
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Transparent</span>
                  <span className="font-mono">
                    {transparentSupply.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    FLUX
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Shielded</span>
                  <span className="font-mono text-primary">
                    {shieldedPool.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    FLUX
                  </span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground pt-1">
                {((shieldedPool / totalSupply) * 100).toFixed(2)}% of supply is in shielded pool
              </div>
            </div>
          )}

          <div className="p-3 rounded-lg bg-muted/50 border space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Top 10 Addresses</span>
              <span className="font-mono text-primary">
                {top10Share.toFixed(2)}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {excludeSwapPools
                ? "Share of supply held by top 10 addresses (excluding swap pools)."
                : "Share of circulating supply held by the top 10 richest addresses."}
            </p>
          </div>

          <div className="p-3 rounded-lg bg-muted/50 border space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Top 100 Addresses</span>
              <span className="font-mono text-primary">
                {top100Share.toFixed(2)}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {excludeSwapPools
                ? "Cumulative balance of top 100 addresses (excluding swap pools)."
                : "Cumulative balance of the 100 largest addresses in the rich list."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

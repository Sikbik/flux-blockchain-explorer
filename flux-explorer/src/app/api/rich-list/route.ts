/**
 * Rich List API Route
 *
 * Fetches rich list data from the FluxIndexer API
 */

import { NextRequest, NextResponse } from "next/server";
import ky from "ky";
import type { RichListData, RichListAddress } from "@/types/rich-list";

const INDEXER_API_URL =
  process.env.SERVER_API_URL ||
  process.env.INDEXER_API_URL ||
  "http://indexer:3002";

const CACHE_DURATION = 3600; // 1 hour cache
const PAGE_SIZE = 1000; // Fetch all addresses in single request for speed
const MAX_ADDRESSES = 1000;

export const revalidate = CACHE_DURATION;

interface IndexerRichListResponse {
  lastUpdate: string;
  lastBlockHeight: number;
  totalSupply: string;
  totalAddresses: number;
  page: number;
  pageSize: number;
  totalPages: number;
  addresses: Array<{
    rank: number;
    address: string;
    balance: string;
    txCount: number;
  }>;
}

interface IndexerSupplyStatsResponse {
  blockHeight: number;
  transparentSupply: string;
  shieldedPool: string;
  totalSupply: string;
  lastUpdate: string;
  timestamp: string;
}

/**
 * GET /api/rich-list
 * Fetch paginated rich list data
 *
 * Query params:
 * - page: Page number (1-based, default: 1)
 * - pageSize: Results per page (default: 100, max: 1000)
 * - minBalance: Minimum balance filter (default: 1)
 */
export async function GET(request: NextRequest) {
  try {
    // Allow overriding min balance but default to 1 FLUX
    const minBalanceParam = parseInt(
      request.nextUrl.searchParams.get("minBalance") || "1",
      10
    );
    const minBalance = Number.isFinite(minBalanceParam)
      ? Math.max(0, minBalanceParam)
      : 1;

    const aggregatedAddresses: RichListAddress[] = [];
    let metadata: IndexerRichListResponse | null = null;
    let page = 1;

    // Start fetching supply stats in parallel with rich list
    const supplyStatsPromise = fetchSupplyStats().catch((error) => {
      console.warn("Failed to fetch supply stats, using rich list total:", error);
      return null;
    });

    while (
      aggregatedAddresses.length < MAX_ADDRESSES &&
      (metadata === null || page <= metadata.totalPages)
    ) {
      const response = await fetchRichListPage({
        page,
        pageSize: PAGE_SIZE,
        minBalance,
      });

      if (!metadata) {
        metadata = response;
      }

      const totalSupplyFlux = Number(response.totalSupply || "0") / 1e8;

      response.addresses.forEach((address) => {
        if (aggregatedAddresses.length >= MAX_ADDRESSES) {
          return;
        }
        const balanceFlux = Number(address.balance || "0") / 1e8;
        const percentage =
          totalSupplyFlux > 0 ? (balanceFlux / totalSupplyFlux) * 100 : 0;

        aggregatedAddresses.push({
          rank: address.rank,
          address: address.address,
          balance: balanceFlux,
          percentage,
          txCount: address.txCount,
        });
      });

      if (response.totalPages === 0 || page >= response.totalPages) {
        break;
      }

      page += 1;
    }

    if (!metadata) {
      return NextResponse.json(
        {
          error: "Rich list unavailable",
          message: "Indexer has not populated the rich list yet.",
        },
        { status: 503 }
      );
    }

    // Wait for supply stats to complete (started earlier in parallel)
    const supplyStats = await supplyStatsPromise;

    // Use supply stats if available, otherwise fall back to rich list total
    const totalSupplyFlux = supplyStats
      ? Number(supplyStats.totalSupply || "0") / 1e8
      : Number(metadata.totalSupply || "0") / 1e8;

    const transparentSupplyFlux = supplyStats
      ? Number(supplyStats.transparentSupply || "0") / 1e8
      : totalSupplyFlux;

    const shieldedPoolFlux = supplyStats
      ? Number(supplyStats.shieldedPool || "0") / 1e8
      : 0;

    const payload: RichListData = {
      lastUpdate: metadata.lastUpdate,
      // Use blockHeight from supply stats if available to match the transparent/shielded data
      lastBlockHeight: supplyStats?.blockHeight || metadata.lastBlockHeight,
      totalSupply: totalSupplyFlux,
      transparentSupply: transparentSupplyFlux,
      shieldedPool: shieldedPoolFlux,
      totalAddresses: metadata.totalAddresses,
      addresses: aggregatedAddresses,
    };

    return NextResponse.json(
      {
        ...payload,
        page: 1,
        pageSize: aggregatedAddresses.length,
        totalPages: Math.max(1, Math.ceil(metadata.totalAddresses / PAGE_SIZE)),
      },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_DURATION}, stale-while-revalidate=${
            CACHE_DURATION * 2
          }`,
        },
      }
    );
  } catch (error) {
    console.error("Failed to fetch rich list:", error);

    const message =
      error instanceof Error ? error.message : "Unable to retrieve rich list data.";

    return NextResponse.json(
      {
        error: "Failed to fetch rich list",
        message,
      },
      { status: 500 }
    );
  }
}

async function fetchSupplyStats(): Promise<IndexerSupplyStatsResponse> {
  const response = await ky.get(`${INDEXER_API_URL}/api/v1/supply`, {
    timeout: 10000,
    retry: {
      limit: 2,
      methods: ["get"],
      statusCodes: [408, 413, 429, 500, 502, 503, 504],
    },
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(
      `Indexer supply endpoint responded with ${response.status}: ${bodyText}`
    );
  }

  return (await response.json()) as IndexerSupplyStatsResponse;
}

async function fetchRichListPage(params: {
  page: number;
  pageSize: number;
  minBalance: number;
}): Promise<IndexerRichListResponse> {
  const response = await ky.get(`${INDEXER_API_URL}/api/v1/richlist`, {
    searchParams: {
      page: params.page.toString(),
      pageSize: params.pageSize.toString(),
      minBalance: params.minBalance.toString(),
    },
    timeout: 30000,
    retry: {
      limit: 2,
      methods: ["get"],
      statusCodes: [408, 413, 429, 500, 502, 503, 504],
    },
  });

  if (!response.ok) {
    const bodyText = await response.text();
    let details = bodyText;
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed?.error) {
        details = parsed.error;
      }
    } catch {
      // ignore JSON parse errors, keep raw text
    }
    throw new Error(
      `Indexer responded with ${response.status}: ${details || "Unknown error"}`
    );
  }

  return (await response.json()) as IndexerRichListResponse;
}

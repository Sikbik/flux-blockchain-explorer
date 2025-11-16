/**
 * Batch Price Fetching API Route
 *
 * Server-side endpoint to fetch historical prices from SQLite cache
 * Uses pre-populated hourly price data for FMV compliance
 */

import { NextRequest, NextResponse } from "next/server";
import { getCachedPriceByTimestamp } from "@/lib/db/price-cache";

/**
 * POST /api/prices/batch
 *
 * Request body: { timestamps: number[] }
 * Response: { prices: Record<number, number | null> }
 */
export async function POST(request: NextRequest) {
  try {
    const { timestamps } = await request.json() as { timestamps: number[] };

    if (!Array.isArray(timestamps)) {
      return NextResponse.json(
        { error: "Invalid request: timestamps must be an array" },
        { status: 400 }
      );
    }

    // Lookup prices from cache (finds closest within 2 hours)
    const results: Record<number, number | null> = {};

    for (const ts of timestamps) {
      results[ts] = getCachedPriceByTimestamp(ts);
    }

    // Count how many prices were found
    const found = Object.values(results).filter(p => p !== null).length;
    const missing = timestamps.length - found;

    if (missing > 0) {
      console.warn(`Price lookup: Found ${found}/${timestamps.length} prices (${missing} missing)`);
      console.warn(`Missing prices may indicate price database needs updating. Run: npm run update-prices`);
    }

    return NextResponse.json({ prices: results });

  } catch (error) {
    console.error("Error in batch price fetch:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Price Range API Route
 *
 * Returns historical FLUX/USD prices for a given date range.
 * Prices are hourly and sourced from CryptoCompare.
 *
 * Usage: GET /api/prices/range?start=2024-01-01&end=2024-12-31
 */

import { NextRequest, NextResponse } from "next/server";
import { getPricesByRange, getPriceDataRange } from "@/lib/db/price-cache";

/**
 * GET /api/prices/range
 *
 * Query params:
 *   - start: Start date (YYYY-MM-DD or Unix timestamp)
 *   - end: End date (YYYY-MM-DD or Unix timestamp)
 *
 * Response: { prices: [...], count, range: { start, end } }
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");

    if (!startParam || !endParam) {
      return NextResponse.json(
        { error: "Missing required parameters: start and end" },
        { status: 400 }
      );
    }

    // Parse dates - accept both YYYY-MM-DD and Unix timestamps
    let startTimestamp: number;
    let endTimestamp: number;

    if (/^\d{4}-\d{2}-\d{2}$/.test(startParam)) {
      // Date string format: YYYY-MM-DD (start of day UTC)
      startTimestamp = Math.floor(new Date(startParam + "T00:00:00Z").getTime() / 1000);
    } else if (/^\d+$/.test(startParam)) {
      // Unix timestamp
      startTimestamp = parseInt(startParam);
    } else {
      return NextResponse.json(
        { error: "Invalid start format. Use YYYY-MM-DD or Unix timestamp." },
        { status: 400 }
      );
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(endParam)) {
      // Date string format: YYYY-MM-DD (end of day UTC)
      endTimestamp = Math.floor(new Date(endParam + "T23:59:59Z").getTime() / 1000);
    } else if (/^\d+$/.test(endParam)) {
      // Unix timestamp
      endTimestamp = parseInt(endParam);
    } else {
      return NextResponse.json(
        { error: "Invalid end format. Use YYYY-MM-DD or Unix timestamp." },
        { status: 400 }
      );
    }

    // Validate range
    if (startTimestamp > endTimestamp) {
      return NextResponse.json(
        { error: "Start date must be before end date" },
        { status: 400 }
      );
    }

    // Limit to 2 years max per request to prevent abuse
    const maxRange = 2 * 365 * 24 * 60 * 60; // 2 years in seconds
    if (endTimestamp - startTimestamp > maxRange) {
      return NextResponse.json(
        { error: "Maximum range is 2 years per request" },
        { status: 400 }
      );
    }

    // Get available data range for info
    const dataRange = getPriceDataRange();

    // Fetch prices
    const prices = getPricesByRange(startTimestamp, endTimestamp);

    // Format response
    const formattedPrices = prices.map(p => ({
      timestamp: p.timestamp,
      date: new Date(p.timestamp * 1000).toISOString(),
      price: p.price_usd,
    }));

    return NextResponse.json({
      prices: formattedPrices,
      count: formattedPrices.length,
      range: {
        requested: {
          start: new Date(startTimestamp * 1000).toISOString(),
          end: new Date(endTimestamp * 1000).toISOString(),
        },
        available: {
          start: dataRange.oldest_timestamp
            ? new Date(dataRange.oldest_timestamp * 1000).toISOString()
            : null,
          end: dataRange.newest_timestamp
            ? new Date(dataRange.newest_timestamp * 1000).toISOString()
            : null,
          totalPrices: dataRange.count,
        },
      },
    });

  } catch (error) {
    console.error("Error in price range fetch:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Cache Statistics API Route
 *
 * Returns statistics about the SQLite price cache
 * Useful for monitoring and debugging
 */

import { NextResponse } from "next/server";
import { getCacheStats } from "@/lib/db/price-cache";

export async function GET() {
  try {
    const stats = getCacheStats();

    return NextResponse.json({
      ...stats,
      cache_file: "data/price-cache.db",
      status: "healthy",
    });
  } catch (error) {
    console.error("Error fetching cache stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch cache statistics" },
      { status: 500 }
    );
  }
}

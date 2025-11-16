/**
 * API Route for Flux Supply Statistics
 *
 * This server-side API route proxies requests to CoinMarketCap
 * to avoid CORS issues when calling from the browser
 */

import { NextResponse } from "next/server";

export async function GET() {
  try {
    const response = await fetch(
      "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail?slug=zel",
      {
        headers: {
          "Accept": "application/json",
        },
        // Cache for 5 minutes
        next: { revalidate: 300 },
      }
    );

    if (!response.ok) {
      throw new Error(`CoinMarketCap API returned ${response.status}`);
    }

    const data = await response.json();
    const stats = data.data.statistics;

    return NextResponse.json({
      circulatingSupply: stats.circulatingSupply,
      maxSupply: 560_000_000, // Hardcoded max supply: 560M FLUX
    });
  } catch (error) {
    console.error("Failed to fetch supply from CoinMarketCap:", error);
    return NextResponse.json(
      { error: "Failed to fetch supply data" },
      { status: 500 }
    );
  }
}

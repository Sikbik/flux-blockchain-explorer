/**
 * Price History API Client
 *
 * Fetches historical USD prices for Flux cryptocurrency
 * Uses internal API route which caches prices in SQLite
 */

/**
 * Get historical price for Flux at a specific timestamp
 * Calls the server-side API route which handles caching
 *
 * @param timestamp - Unix timestamp (seconds)
 * @returns USD price at that time (or null if unavailable)
 */
export async function getFluxPriceAtTime(timestamp: number): Promise<number | null> {
  try {
    // Use batch API with single timestamp
    const results = await batchGetFluxPrices([timestamp]);
    return results.get(timestamp) ?? null;
  } catch (error) {
    console.warn(`Failed to fetch price for timestamp ${timestamp}:`, error);
    return null;
  }
}

/**
 * Batch fetch prices for multiple transactions
 * Calls server-side API route which handles SQLite caching and rate limiting
 *
 * @param timestamps - Array of Unix timestamps (seconds)
 * @returns Map of timestamp -> USD price (null if unavailable)
 */
export async function batchGetFluxPrices(
  timestamps: number[]
): Promise<Map<number, number | null>> {
  const results = new Map<number, number | null>();

  if (timestamps.length === 0) {
    return results;
  }

  try {
    // Call server-side API route
    const response = await fetch('/api/prices/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ timestamps }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json() as { prices: Record<number, number | null> };

    // Convert to Map
    for (const [ts, price] of Object.entries(data.prices)) {
      results.set(Number(ts), price);
    }

    return results;
  } catch (error) {
    console.warn('Failed to batch fetch prices:', error);
    // Return map with null values for all timestamps
    for (const ts of timestamps) {
      results.set(ts, null);
    }
    return results;
  }
}


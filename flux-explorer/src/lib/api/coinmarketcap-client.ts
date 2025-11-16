/**
 * CoinMarketCap API Client
 *
 * Fetches cryptocurrency market data via internal API route
 * to avoid CORS issues
 */

import ky from "ky";

const apiClient = ky.create({
  timeout: 10000,
  retry: {
    limit: 2,
    methods: ["get"],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
  },
});

/**
 * Supply statistics for Flux cryptocurrency
 */
export interface FluxSupplyStats {
  circulatingSupply: number;
  maxSupply: number;
}

/**
 * CoinMarketCap API Client Class
 */
export class CoinMarketCapAPI {
  /**
   * Fetch Flux supply statistics via internal API route
   * Note: Flux is listed as "zel" on CoinMarketCap
   */
  static async getFluxSupplyStats(): Promise<FluxSupplyStats> {
    try {
      const response = await apiClient
        .get("/api/supply")
        .json<FluxSupplyStats>();

      return response;
    } catch (error) {
      console.error("Failed to fetch Flux supply stats:", error);
      throw error;
    }
  }
}

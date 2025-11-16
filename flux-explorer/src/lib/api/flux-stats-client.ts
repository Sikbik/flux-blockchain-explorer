/**
 * Flux Stats API Client
 *
 * Client for fetching Flux network statistics and application data
 * from api.runonflux.io
 */

import ky from "ky";

const FLUX_API_BASE_URL = "https://api.runonflux.io";
const FLUX_STATS_BASE_URL = "https://stats.runonflux.com";

const fluxApiClient = ky.create({
  prefixUrl: FLUX_API_BASE_URL,
  timeout: 30000,
  retry: {
    limit: 2,
    methods: ["get"],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
  },
});

const fluxStatsClient = ky.create({
  prefixUrl: FLUX_STATS_BASE_URL,
  timeout: 30000,
  retry: {
    limit: 2,
    methods: ["get"],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
  },
});

export interface FluxNodeCount {
  total: number;
  stable: number;
  "cumulus-enabled": number;
  "nimbus-enabled": number;
  "stratus-enabled": number;
  "basic-enabled": number;
  "super-enabled": number;
  "bamf-enabled": number;
  ipv4: number;
  ipv6: number;
  onion: number;
}

export interface FluxAppSpecification {
  version: number;
  name: string;
  description: string;
  owner: string;
  compose?: Array<Record<string, unknown>>;
  repotag: string;
  ports?: number[];
  domains?: string[];
  environmentParameters?: string[];
  commands?: string[];
  containerPorts?: number[];
  containerData?: string;
  cpu?: number;
  ram?: number;
  hdd?: number;
  tiered?: boolean;
  cpubasic?: number;
  cpusuper?: number;
  cpubamf?: number;
  rambasic?: number;
  ramsuper?: number;
  rambamf?: number;
  hddbasic?: number;
  hddsuper?: number;
  hddbamf?: number;
  height?: number;
  instances?: number;
  expire?: number;
  geolocation?: string[];
  staticip?: boolean;
  contacts?: Array<Record<string, unknown>>;
  hash?: string;
}

export class FluxStatsAPI {
  /**
   * Get total count of FluxNodes on the network
   */
  static async getNodeCount(): Promise<FluxNodeCount> {
    try {
      const response = await fluxApiClient
        .get("daemon/getzelnodecount")
        .json<{ status: string; data: FluxNodeCount }>();

      if (response.status !== "success") {
        throw new Error("Failed to fetch FluxNode count");
      }

      return response.data;
    } catch (error) {
      console.error("Error fetching FluxNode count:", error);
      throw error;
    }
  }

  /**
   * Get all running applications on the Flux network
   */
  static async getGlobalAppsSpecifications(): Promise<FluxAppSpecification[]> {
    try {
      const response = await fluxApiClient
        .get("apps/globalappsspecifications")
        .json<{ status: string; data: FluxAppSpecification[] }>();

      if (response.status !== "success") {
        throw new Error("Failed to fetch applications");
      }

      return response.data;
    } catch (error) {
      console.error("Error fetching applications:", error);
      throw error;
    }
  }

  /**
   * Get count of running applications (unique apps)
   */
  static async getRunningAppsCount(): Promise<number> {
    try {
      const apps = await this.getGlobalAppsSpecifications();
      return apps.length;
    } catch (error) {
      console.error("Error fetching running apps count:", error);
      return 0;
    }
  }

  /**
   * Get total count of running application instances
   * (sum of all instances across all apps)
   */
  static async getRunningInstancesCount(): Promise<number> {
    try {
      const apps = await this.getGlobalAppsSpecifications();
      return apps.reduce((total, app) => total + (app.instances || 0), 0);
    } catch (error) {
      console.error("Error fetching running instances count:", error);
      return 0;
    }
  }

  /**
   * Get FluxNode info to determine Arcane vs Legacy adoption
   */
  static async getArcaneAdoption(): Promise<{ arcane: number; legacy: number; total: number; percentage: number }> {
    try {
      const response = await fluxStatsClient
        .get("fluxinfo?projection=flux")
        .json<{ status: string; data: Array<{ flux: { arcaneVersion?: string } }> }>();

      if (response.status !== "success") {
        throw new Error("Failed to fetch FluxNode info");
      }

      const nodes = response.data;
      const total = nodes.length;
      const arcane = nodes.filter(node => node.flux.arcaneVersion).length;
      const legacy = total - arcane;
      const percentage = total > 0 ? (arcane / total) * 100 : 0;

      return { arcane, legacy, total, percentage };
    } catch (error) {
      console.error("Error fetching Arcane adoption:", error);
      return { arcane: 0, legacy: 0, total: 0, percentage: 0 };
    }
  }
}

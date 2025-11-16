/**
 * API Health Monitor
 *
 * Monitors FluxIndexer API health and automatically switches between
 * local and public configurations based on availability.
 */

import ky from 'ky';
import { setApiMode, getApiConfig, getApiMode } from './config';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResult {
  status: HealthStatus;
  responseTime: number;
  error?: string;
  timestamp: Date;
}

export interface ApiEndpoint {
  url: string;
  type: 'local' | 'public';
  priority: number; // Lower = higher priority
}

/**
 * Get API endpoints from environment
 */
function getApiEndpoints(): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];

  // FluxIndexer API endpoint
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

  console.log('[Health Monitor] Environment check:', {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    resolvedApiUrl: apiUrl,
  });

  console.log(`[Health Monitor] Adding FluxIndexer endpoint: ${apiUrl}`);
  endpoints.push({
    url: apiUrl,
    type: 'local',
    priority: 1,
  });

  return endpoints.sort((a, b) => a.priority - b.priority);
}

/**
 * Health Monitor Class
 * Manages periodic health checks and automatic failover
 *
 * Note: Health checks are performed server-side via /api/health
 * to support internal Flux DNS names that browsers cannot resolve
 */
class HealthMonitor {
  private endpoints: ApiEndpoint[];
  private currentEndpoint: ApiEndpoint | null = null;
  private healthStatus: Map<string, HealthCheckResult> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private isMonitoring = false;

  constructor() {
    this.endpoints = [];
  }

  /**
   * Initialize endpoints from server and apply health check results
   */
  async initializeEndpoints(): Promise<void> {
    try {
      // Call server-side API to get endpoints (reads runtime env vars and does health checks)
      console.log('[Health Monitor] Calling /api/health...');
      const response = await ky.get('/api/health').json<{
        selected: { endpoint: string; type: 'local' | 'public'; healthy: boolean; responseTime: number };
        allResults: Array<{ endpoint: string; type: 'local' | 'public'; healthy: boolean; responseTime: number }>;
      }>();

      console.log('[Health Monitor] Fetched endpoints from server:', response);

      this.endpoints = response.allResults.map(r => ({
        url: r.endpoint,
        type: r.type,
        priority: r.type === 'local' ? 1 : 2,
      })).sort((a, b) => a.priority - b.priority);

      // Store health results from server
      response.allResults.forEach(r => {
        this.healthStatus.set(r.endpoint, {
          status: r.healthy ? 'healthy' : 'unhealthy',
          responseTime: r.responseTime,
          timestamp: new Date(),
        });
      });

      // Immediately switch to the selected endpoint
      const selectedEndpoint = this.endpoints.find(e => e.url === response.selected.endpoint);
      if (selectedEndpoint) {
        this.switchToEndpoint(selectedEndpoint);
      }

    } catch {
      console.error('[Health Monitor] Failed to fetch endpoints from server, using fallback');
      // Fallback to getApiEndpoints() for backward compatibility
      this.endpoints = getApiEndpoints();
    }
  }

  /**
   * Start health monitoring
   */
  async start(): Promise<void> {
    if (this.isMonitoring) {
      console.warn('[Health Monitor] Already monitoring');
      return;
    }

    console.log('[Health Monitor] Starting health monitoring');
    this.isMonitoring = true;

    // Initialize endpoints from server (reads runtime env vars)
    await this.initializeEndpoints();

    // Perform initial health check
    await this.performHealthCheck();

    // Set up periodic health checks
    const config = getApiConfig();
    this.monitoringInterval = setInterval(
      () => this.performHealthCheck(),
      config.healthCheckInterval
    );
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.isMonitoring = false;
    console.log('[Health Monitor] Stopped health monitoring');
  }

  /**
   * Perform health check via server (proxied for internal DNS support)
   */
  async performHealthCheck(): Promise<void> {
    const mode = getApiMode();

    // Skip health checks if not in auto mode
    if (mode !== 'auto') {
      return;
    }

    console.log('[Health Monitor] Performing health check via server...');

    try {
      // Use server-side health check (can reach internal Flux DNS)
      const response = await ky.get('/api/health').json<{
        selected: { endpoint: string; type: 'local' | 'public'; healthy: boolean; responseTime: number };
        allResults: Array<{ endpoint: string; type: 'local' | 'public'; healthy: boolean; responseTime: number }>;
      }>();

      // Update health status from server results
      response.allResults.forEach(r => {
        this.healthStatus.set(r.endpoint, {
          status: r.healthy ? 'healthy' : 'unhealthy',
          responseTime: r.responseTime,
          timestamp: new Date(),
        });

        console.log(
          `[Health Monitor] ${r.type.toUpperCase()} endpoint: ` +
          `${r.healthy ? 'healthy' : 'unhealthy'} (${r.responseTime}ms)`
        );
      });

      // Switch to the selected endpoint
      const selectedEndpoint = this.endpoints.find(e => e.url === response.selected.endpoint);
      if (selectedEndpoint) {
        this.switchToEndpoint(selectedEndpoint);
      }

    } catch (error) {
      console.error('[Health Monitor] Health check failed:', error instanceof Error ? error.message : 'Unknown error');

      // Fallback to public endpoint on error
      const publicEndpoint = this.endpoints.find(e => e.type === 'public');
      if (publicEndpoint) {
        this.switchToEndpoint(publicEndpoint);
      }
    }
  }

  /**
   * Switch to a specific endpoint
   */
  private switchToEndpoint(endpoint: ApiEndpoint): void {
    // Only switch if it's different from current
    if (this.currentEndpoint?.url === endpoint.url) {
      return;
    }

    console.log(`[Health Monitor] Switching to ${endpoint.type.toUpperCase()} endpoint: ${endpoint.url}`);
    this.currentEndpoint = endpoint;

    // Update API mode based on endpoint type
    setApiMode(endpoint.type);

    // Restart monitoring interval with new config (important for healthCheckInterval changes)
    this.restartMonitoringInterval();

    // Emit event for components that need to know
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('api-endpoint-changed', {
          detail: { endpoint, type: endpoint.type },
        })
      );
    }
  }

  /**
   * Restart monitoring interval with updated configuration
   * Called when mode switches to pick up new healthCheckInterval
   */
  private restartMonitoringInterval(): void {
    if (!this.isMonitoring) {
      return;
    }

    // Clear existing interval
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    // Set up new interval with current config
    const config = getApiConfig();
    this.monitoringInterval = setInterval(
      () => this.performHealthCheck(),
      config.healthCheckInterval
    );

    console.log(`[Health Monitor] Monitoring interval updated to ${config.healthCheckInterval}ms (${config.healthCheckInterval / 1000}s)`);
  }

  /**
   * Get current endpoint
   */
  getCurrentEndpoint(): ApiEndpoint | null {
    return this.currentEndpoint;
  }

  /**
   * Get health status for all endpoints
   */
  getHealthStatus(): Map<string, HealthCheckResult> {
    return new Map(this.healthStatus);
  }

  /**
   * Force a health check now (useful for manual testing)
   */
  async forceCheck(): Promise<void> {
    await this.performHealthCheck();
  }

  /**
   * Check if monitoring is active
   */
  isActive(): boolean {
    return this.isMonitoring;
  }
}

// Singleton instance
let monitorInstance: HealthMonitor | null = null;

/**
 * Get the health monitor instance
 */
export function getHealthMonitor(): HealthMonitor {
  if (!monitorInstance) {
    monitorInstance = new HealthMonitor();
  }
  return monitorInstance;
}

/**
 * Initialize health monitoring (call once on app startup)
 */
export function initializeHealthMonitoring(): void {
  const mode = getApiMode();

  // Only start monitoring in auto mode
  if (mode === 'auto') {
    const monitor = getHealthMonitor();
    monitor.start();
    console.log('[Health Monitor] Initialized in AUTO mode');
  } else {
    console.log(`[Health Monitor] Manual mode (${mode}), health monitoring disabled`);
  }
}

/**
 * Stop health monitoring (useful for cleanup)
 */
export function stopHealthMonitoring(): void {
  if (monitorInstance) {
    monitorInstance.stop();
  }
}

// Auto-initialize on client-side only
if (typeof window !== 'undefined') {
  // Wait for app to be ready before starting
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeHealthMonitoring);
  } else {
    initializeHealthMonitoring();
  }

  // Handle page visibility changes - force health check when tab becomes visible
  // This solves the issue where setInterval is throttled in background tabs
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && monitorInstance?.isActive()) {
      console.log('[Health Monitor] Tab became visible, forcing health check...');
      monitorInstance.forceCheck();
    }
  });

  // Also check on window focus (for cases where visibility API doesn't fire)
  window.addEventListener('focus', () => {
    if (monitorInstance?.isActive()) {
      console.log('[Health Monitor] Window focused, forcing health check...');
      monitorInstance.forceCheck();
    }
  });
}

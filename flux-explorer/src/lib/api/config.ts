/**
 * API Configuration Management
 *
 * Provides dynamic configuration profiles for local vs public FluxIndexer APIs.
 * Automatically detects and switches between profiles based on connection availability.
 */

export type ApiMode = 'local' | 'public' | 'auto';

export interface ApiConfig {
  /** HTTP request timeout in milliseconds */
  timeout: number;
  /** Number of retry attempts for failed requests */
  retryLimit: number;
  /** Polling interval for real-time updates (ms) */
  refetchInterval: number;
  /** Stale time for cached data (ms) */
  staleTime: number;
  /** Scanner batch size (blocks per batch) */
  batchSize: number;
  /** Delay between batches (ms) */
  throttleDelay: number;
  /** Checkpoint save interval (blocks) */
  checkpointInterval: number;
  /** Health check interval (ms) */
  healthCheckInterval: number;
}

/**
 * Local FluxIndexer Profile (Aggressive)
 * - Used when connected to a local FluxIndexer instance
 * - Optimized for speed and low latency
 * - No rate limiting concerns
 */
export const LOCAL_CONFIG: ApiConfig = {
  timeout: 10000,              // 10s - local network is fast
  retryLimit: 1,               // Minimal retries - local is reliable
  refetchInterval: 2000,       // 2s - aggressive polling for real-time feel
  staleTime: 30000,            // 30s - data can be fresher
  batchSize: 1000,             // 1000 transactions per batch - local can handle it
  throttleDelay: 50,           // 50ms - balance between speed and stability
  checkpointInterval: 5000,    // Save state every 5000 blocks
  healthCheckInterval: 30000,  // Check health every 30s
};

/**
 * Public FluxIndexer Profile (Conservative)
 * - Used when connected to public FluxIndexer instance
 * - Optimized to avoid rate limiting
 * - More retries for network issues
 */
export const PUBLIC_CONFIG: ApiConfig = {
  timeout: 30000,              // 30s - account for network latency
  retryLimit: 3,               // More retries - network can be flaky
  refetchInterval: 30000,      // 30s - conservative to avoid rate limits
  staleTime: 60000,            // 60s - longer cache to reduce requests
  batchSize: 100,              // 100 transactions per batch (respectful to public API)
  throttleDelay: 1000,         // 1s - reasonable delay to avoid rate limits
  checkpointInterval: 1000,    // Save state every 1000 blocks (more frequent saves)
  healthCheckInterval: 60000,  // Check health every 60s
};

/**
 * Current active configuration
 */
let activeConfig: ApiConfig = PUBLIC_CONFIG;
let currentMode: ApiMode = 'public';

/**
 * Get the current active API configuration
 */
export function getApiConfig(): ApiConfig {
  return { ...activeConfig };
}

/**
 * Get the current API mode
 */
export function getApiMode(): ApiMode {
  return currentMode;
}

/**
 * Set the API mode and update configuration
 * @param mode - The API mode to use
 */
export function setApiMode(mode: ApiMode): void {
  currentMode = mode;

  switch (mode) {
    case 'local':
      activeConfig = LOCAL_CONFIG;
      console.log('[API Config] Switched to LOCAL mode (aggressive settings)');
      break;
    case 'public':
      activeConfig = PUBLIC_CONFIG;
      console.log('[API Config] Switched to PUBLIC mode (conservative settings)');
      break;
    case 'auto':
      // Auto mode will be determined by health monitor
      console.log('[API Config] Switched to AUTO mode (health-based)');
      break;
  }
}

/**
 * Get configuration for a specific mode without changing active config
 */
export function getConfigForMode(mode: 'local' | 'public'): ApiConfig {
  return mode === 'local' ? { ...LOCAL_CONFIG } : { ...PUBLIC_CONFIG };
}

/**
 * Override specific configuration values
 * Useful for fine-tuning without changing the entire profile
 */
export function overrideConfig(overrides: Partial<ApiConfig>): void {
  activeConfig = { ...activeConfig, ...overrides };
  console.log('[API Config] Configuration overridden:', overrides);
}

/**
 * Reset configuration to default based on current mode
 */
export function resetConfig(): void {
  setApiMode(currentMode);
}

/**
 * Get API mode from environment variables
 */
export function getApiModeFromEnv(): ApiMode {
  const mode = process.env.NEXT_PUBLIC_API_MODE ||
               process.env.API_MODE ||
               'auto';

  if (mode === 'local' || mode === 'public' || mode === 'auto') {
    return mode as ApiMode;
  }

  console.warn(`[API Config] Invalid API_MODE "${mode}", defaulting to "auto"`);
  return 'auto';
}

/**
 * Initialize configuration from environment
 */
export function initializeConfig(): void {
  const mode = getApiModeFromEnv();
  setApiMode(mode);

  // Check for individual environment overrides
  const overrides: Partial<ApiConfig> = {};

  if (process.env.API_TIMEOUT) {
    overrides.timeout = parseInt(process.env.API_TIMEOUT);
  }
  if (process.env.API_RETRY_LIMIT) {
    overrides.retryLimit = parseInt(process.env.API_RETRY_LIMIT);
  }
  if (process.env.API_REFETCH_INTERVAL) {
    overrides.refetchInterval = parseInt(process.env.API_REFETCH_INTERVAL);
  }
  if (process.env.API_BATCH_SIZE) {
    overrides.batchSize = parseInt(process.env.API_BATCH_SIZE);
  }
  if (process.env.API_THROTTLE_DELAY) {
    overrides.throttleDelay = parseInt(process.env.API_THROTTLE_DELAY);
  }

  if (Object.keys(overrides).length > 0) {
    overrideConfig(overrides);
  }
}

// Initialize on import
initializeConfig();

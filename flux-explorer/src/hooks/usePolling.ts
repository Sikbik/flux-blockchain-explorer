/**
 * Custom Hook for Polling with Controls
 *
 * Provides a reusable polling mechanism with pause/resume controls,
 * configurable intervals, and manual refresh capability.
 */

import { useState, useEffect, useCallback } from 'react';

export interface PollingConfig {
  /** Initial polling interval in milliseconds */
  interval?: number;
  /** Whether polling should be enabled initially */
  enabled?: boolean;
  /** Minimum interval allowed (default: 5000ms / 5 seconds) */
  minInterval?: number;
  /** Maximum interval allowed (default: 300000ms / 5 minutes) */
  maxInterval?: number;
}

export interface PollingControls {
  /** Whether polling is currently active */
  isPolling: boolean;
  /** Current polling interval in milliseconds */
  interval: number;
  /** Version counter to force refresh on demand */
  refreshToken: number;
  /** Pause polling */
  pause: () => void;
  /** Resume polling */
  resume: () => void;
  /** Toggle polling on/off */
  toggle: () => void;
  /** Set a new polling interval */
  setInterval: (newInterval: number) => void;
  /** Manually trigger a refresh */
  refresh: () => void;
  /** Last refresh timestamp */
  lastRefresh: Date | null;
}

/**
 * Hook to manage polling behavior with user controls
 *
 * @param config - Polling configuration
 * @returns Polling controls and state
 *
 * @example
 * ```tsx
 * const polling = usePolling({
 *   interval: 30000,  // 30 seconds
 *   enabled: true
 * });
 *
 * // Use polling.isPolling to determine if refetchInterval should be active
 * const { data } = useQuery({
 *   queryKey: ['myData'],
 *   queryFn: fetchData,
 *   refetchInterval: polling.isPolling ? polling.interval : false,
 * });
 *
 * // Provide UI controls to user
 * <button onClick={polling.toggle}>
 *   {polling.isPolling ? 'Pause' : 'Resume'}
 * </button>
 * ```
 */
export function usePolling(config: PollingConfig = {}): PollingControls {
  const {
    interval: initialInterval = 30000, // 30 seconds default
    enabled: initialEnabled = true,
    minInterval = 5000, // 5 seconds minimum
    maxInterval = 300000, // 5 minutes maximum
  } = config;

  const [isPolling, setIsPolling] = useState(initialEnabled);
  const [interval, setIntervalState] = useState(
    Math.max(minInterval, Math.min(maxInterval, initialInterval))
  );
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Update last refresh timestamp when manual refresh trigger increments
  useEffect(() => {
    if (refreshTrigger > 0) {
      setLastRefresh(new Date());
    }
  }, [refreshTrigger]);

  const pause = useCallback(() => {
    setIsPolling(false);
  }, []);

  const resume = useCallback(() => {
    setIsPolling(true);
  }, []);

  const toggle = useCallback(() => {
    setIsPolling(prev => !prev);
  }, []);

  const setInterval = useCallback((newInterval: number) => {
    const clampedInterval = Math.max(minInterval, Math.min(maxInterval, newInterval));
    setIntervalState(clampedInterval);
  }, [minInterval, maxInterval]);

  const refresh = useCallback(() => {
    // Trigger a refresh by updating the trigger counter
    setRefreshTrigger(prev => prev + 1);
    setRefreshToken(prev => prev + 1);
  }, []);

  return {
    isPolling,
    interval,
    refreshToken,
    pause,
    resume,
    toggle,
    setInterval,
    refresh,
    lastRefresh,
  };
}

/**
 * Predefined polling intervals for common use cases
 */
export const POLLING_INTERVALS = {
  /** 5 seconds - for rapidly changing data */
  FAST: 5000,
  /** 15 seconds - for frequently updated data */
  FREQUENT: 15000,
  /** 30 seconds - for regularly updated data (default) */
  NORMAL: 30000,
  /** 1 minute - for slowly changing data */
  SLOW: 60000,
  /** 5 minutes - for rarely changing data */
  RARE: 300000,
} as const;

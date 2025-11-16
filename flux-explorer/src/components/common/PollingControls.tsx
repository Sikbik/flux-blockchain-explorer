"use client";

import { Play, Pause, RefreshCw, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PollingControls as IPollingControls, POLLING_INTERVALS } from "@/hooks/usePolling";
import { formatDistanceToNow } from "date-fns";

interface PollingControlsProps {
  polling: IPollingControls;
  className?: string;
  showIntervalSelector?: boolean;
  compact?: boolean;
}

/**
 * UI Controls for Polling
 *
 * Provides play/pause, manual refresh, and interval selection controls
 * for data polling functionality.
 */
export function PollingControls({
  polling,
  className = "",
  showIntervalSelector = true,
  compact = false,
}: PollingControlsProps) {
  const formatInterval = (ms: number) => {
    if (ms < 60000) {
      return `${ms / 1000}s`;
    }
    return `${ms / 60000}m`;
  };

  const getLastRefreshText = () => {
    if (!polling.lastRefresh) return "Never";
    try {
      return formatDistanceToNow(polling.lastRefresh, { addSuffix: true });
    } catch {
      return "Just now";
    }
  };

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Button
          variant="outline"
          size="sm"
          onClick={polling.toggle}
          title={polling.isPolling ? "Pause auto-refresh" : "Resume auto-refresh"}
        >
          {polling.isPolling ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={polling.refresh}
          title="Refresh now"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 p-3 sm:p-4 rounded-lg border bg-card ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Auto-refresh:</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={polling.isPolling ? "default" : "outline"}
            size="sm"
            onClick={polling.toggle}
            className="gap-2"
          >
            {polling.isPolling ? (
              <>
                <Pause className="h-4 w-4" />
                Pause
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Resume
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={polling.refresh}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh Now
          </Button>

          {showIntervalSelector && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Every:</span>
              <Select
                value={polling.interval.toString()}
                onValueChange={(value) => polling.setInterval(parseInt(value))}
              >
                <SelectTrigger className="w-[100px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={POLLING_INTERVALS.FAST.toString()}>
                    5 seconds
                  </SelectItem>
                  <SelectItem value={POLLING_INTERVALS.FREQUENT.toString()}>
                    15 seconds
                  </SelectItem>
                  <SelectItem value={POLLING_INTERVALS.NORMAL.toString()}>
                    30 seconds
                  </SelectItem>
                  <SelectItem value={POLLING_INTERVALS.SLOW.toString()}>
                    1 minute
                  </SelectItem>
                  <SelectItem value={POLLING_INTERVALS.RARE.toString()}>
                    5 minutes
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 text-sm text-muted-foreground border-t pt-2">
        {polling.isPolling && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs sm:text-sm">Active ({formatInterval(polling.interval)})</span>
          </span>
        )}
        {!polling.isPolling && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gray-400" />
            <span className="text-xs sm:text-sm">Paused</span>
          </span>
        )}
        <span className="text-xs sm:text-sm">
          Last: {getLastRefreshText()}
        </span>
      </div>
    </div>
  );
}

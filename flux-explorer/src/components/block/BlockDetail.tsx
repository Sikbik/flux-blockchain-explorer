"use client";

import { useEffect } from "react";
import { useBlock } from "@/lib/api/hooks/useBlocks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BlockHeader } from "./BlockHeader";
import { BlockStats } from "./BlockStats";
import { BlockTransactions } from "./BlockTransactions";
import { BlockNavigation } from "./BlockNavigation";
import { BlockVisual } from "./BlockVisual";
import { PollingControls } from "@/components/common/PollingControls";
import { usePolling, POLLING_INTERVALS } from "@/hooks/usePolling";
import { AlertCircle } from "lucide-react";

interface BlockDetailProps {
  hashOrHeight: string;
}

export function BlockDetail({ hashOrHeight }: BlockDetailProps) {
  // Set up polling - blocks rarely change once confirmed, but useful for recent blocks
  const polling = usePolling({
    interval: POLLING_INTERVALS.SLOW,
    enabled: true,
  });

  const { data: block, isLoading, error, refetch } = useBlock(hashOrHeight, {
    staleTime: 0, // Always consider data stale for real-time updates
  });

  // Manual polling control with useEffect
  useEffect(() => {
    if (!polling.isPolling) return;

    const intervalId = setInterval(() => {
      polling.refresh();
    }, polling.interval);

    return () => clearInterval(intervalId);
  }, [polling.isPolling, polling.interval, polling.refresh]);

  useEffect(() => {
    if (polling.refreshToken === 0) return;
    refetch({ cancelRefetch: true });
  }, [polling.refreshToken, refetch]);

  // Connect manual refresh to query refetch
  const handleRefresh = () => {
    polling.refresh();
  };

  if (isLoading) {
    return <BlockDetailSkeleton />;
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Error Loading Block
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            {error.message || "Failed to load block data. Please try again."}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!block) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Block Not Found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            The requested block could not be found.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Polling Controls */}
      <PollingControls polling={{ ...polling, refresh: handleRefresh }} />

      {/* Block Navigation */}
      <BlockNavigation
        currentHeight={block.height}
        previousHash={block.previousblockhash}
        nextHash={block.nextblockhash}
      />

      {/* Block Header Info */}
      <BlockHeader block={block} />

      {/* Block Statistics */}
      <BlockStats block={block} />

      {/* Visual Representation */}
      <BlockVisual block={block} />

      {/* Transactions */}
      <BlockTransactions block={block} />
    </div>
  );
}

function BlockDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
      </div>
      <Skeleton className="h-64 w-full" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

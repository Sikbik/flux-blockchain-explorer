"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useLatestBlocks } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Blocks, ArrowRight, Server } from "lucide-react";

// Format time ago with minutes and seconds
function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = Math.floor((now - timestamp * 1000) / 1000); // seconds

  if (diff < 60) {
    return `${diff}s ago`;
  }

  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;
  return `${minutes}m ${seconds}s ago`;
}

export function LatestBlocks() {
  const { data: blocks, isLoading, error } = useLatestBlocks(6);
  const [, setTick] = useState(0);

  // Force re-render every second to update the time display
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Blocks className="h-5 w-5" />
            Latest Blocks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Failed to load latest blocks</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-primary/5">
      <CardHeader className="bg-gradient-to-r from-primary/3 to-transparent">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Blocks className="h-5 w-5 text-primary" />
            Latest Blocks
          </div>
          <Link
            href="/blocks"
            className="text-sm font-normal text-primary hover:underline flex items-center gap-1"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="divide-y">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-16" />
                </div>
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y">
            {blocks?.map((block) => {
              const nodeCount = block.nodeConfirmationCount ?? 0;
              const regularTxCount = block.regularTxCount ?? block.txlength ?? 0;
              return (
                <Link
                  key={block.hash}
                  href={`/block/${block.height}`}
                  className="block p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-semibold text-primary">
                          #{block.height.toLocaleString()}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {regularTxCount} txs
                        </Badge>
                        {nodeCount > 0 && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Server className="h-3 w-3" />
                            {nodeCount}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono truncate">{block.hash.substring(0, 16)}...</span>
                      </div>
                    </div>
                    <div className="text-right space-y-1 flex-shrink-0">
                      <div className="text-xs text-muted-foreground font-mono">
                        {formatTimeAgo(block.time)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {(block.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

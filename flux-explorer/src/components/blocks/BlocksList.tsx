"use client";

import { useState } from "react";
import Link from "next/link";
import { useLatestBlocks } from "@/lib/api/hooks/useBlocks";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Blocks,
  Clock,
  ChevronLeft,
  ChevronRight,
  Database,
  Coins,
  Server
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const BLOCKS_PER_PAGE = 20;

export function BlocksList() {
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch more blocks than we need for pagination
  const { data: blocks, isLoading, error } = useLatestBlocks(BLOCKS_PER_PAGE * 3);

  // Calculate pagination values
  const totalPages = blocks ? Math.ceil(blocks.length / BLOCKS_PER_PAGE) : 0;
  const startIndex = (currentPage - 1) * BLOCKS_PER_PAGE;
  const endIndex = startIndex + BLOCKS_PER_PAGE;
  const currentBlocks = blocks ? blocks.slice(startIndex, endIndex) : [];

  if (error) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-destructive">Failed to load blocks</p>
          <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !blocks) {
    return (
      <div className="space-y-4">
        {[...Array(BLOCKS_PER_PAGE)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="animate-pulse space-y-3">
                <div className="h-6 bg-muted rounded w-1/4"></div>
                <div className="h-4 bg-muted rounded w-3/4"></div>
                <div className="h-4 bg-muted rounded w-1/2"></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const formatTime = (timestamp: number) => {
    try {
      return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
    } catch {
      return "Unknown";
    }
  };

  const formatDate = (timestamp: number) => {
    try {
      return new Date(timestamp * 1000).toLocaleString();
    } catch {
      return "Unknown";
    }
  };

  return (
    <div className="space-y-6">
      {/* Blocks List */}
      <div className="space-y-3">
        {currentBlocks.map((block) => {
          const nodeCount = block.nodeConfirmationCount ?? 0;
          const regularTxCount = block.regularTxCount ?? block.txlength ?? 0;
          const tierCounts = block.tierCounts ?? {
            cumulus: 0,
            nimbus: 0,
            stratus: 0,
            starting: 0,
            unknown: 0,
          };

          return (
            <Link href={`/block/${block.height}`} key={block.hash}>
              <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                <CardContent className="p-6">
                  <div className="space-y-4">
                    {/* Header Row */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Blocks className="h-5 w-5 text-primary" />
                            <span className="text-2xl font-bold">
                              #{block.height.toLocaleString()}
                            </span>
                          </div>
                          <Badge variant="outline" className="bg-green-500/10 border-green-500/20 text-green-500">
                            PoUW
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          <span>{formatTime(block.time)}</span>
                          <span className="text-xs">({formatDate(block.time)})</span>
                        </div>
                      </div>

                      <div className="text-right space-y-1">
                        <div className="flex items-center gap-2 justify-end">
                          <Badge variant="secondary">{regularTxCount}</Badge>
                          {nodeCount > 0 && (
                            <div className="relative group">
                              <Badge variant="outline" className="gap-1 cursor-help">
                                <Server className="h-3 w-3" />
                                {nodeCount}
                              </Badge>
                              {/* Hover tooltip */}
                              <div className="absolute right-0 bottom-full mb-2 p-3 bg-card border rounded-md shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 min-w-[220px]">
                                <div className="space-y-2 text-sm">
                                  <p className="font-semibold mb-2">Node Confirmations</p>
                                  {tierCounts.cumulus > 0 && (
                                    <div className="flex items-center justify-between">
                                      <span className="text-pink-500 font-medium flex items-center gap-2">
                                        <span className="w-3 h-3 rounded-full bg-pink-500"></span>
                                        CUMULUS
                                      </span>
                                      <span className="font-bold text-pink-500">
                                        {tierCounts.cumulus}
                                      </span>
                                    </div>
                                  )}
                                  {tierCounts.nimbus > 0 && (
                                    <div className="flex items-center justify-between">
                                      <span className="text-purple-500 font-medium flex items-center gap-2">
                                        <span className="w-3 h-3 rounded-full bg-purple-500"></span>
                                        NIMBUS
                                      </span>
                                      <span className="font-bold text-purple-500">
                                        {tierCounts.nimbus}
                                      </span>
                                    </div>
                                  )}
                                  {tierCounts.stratus > 0 && (
                                    <div className="flex items-center justify-between">
                                      <span className="text-blue-500 font-medium flex items-center gap-2">
                                        <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                                        STRATUS
                                      </span>
                                      <span className="font-bold text-blue-500">
                                        {tierCounts.stratus}
                                      </span>
                                    </div>
                                  )}
                                  {tierCounts.starting > 0 && (
                                    <div className="flex items-center justify-between">
                                      <span className="text-yellow-500 font-medium flex items-center gap-2">
                                        <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
                                        STARTING
                                      </span>
                                      <span className="font-bold text-yellow-500">
                                        {tierCounts.starting}
                                      </span>
                                    </div>
                                  )}
                                  {tierCounts.unknown > 0 && (
                                    <div className="flex items-center justify-between">
                                      <span className="text-gray-400 font-medium flex items-center gap-2">
                                        <span className="w-3 h-3 rounded-full bg-gray-400"></span>
                                        UNKNOWN
                                      </span>
                                      <span className="font-bold text-gray-400">
                                        {tierCounts.unknown}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                {/* Arrow pointing down */}
                                <div className="absolute right-4 bottom-[-6px] w-3 h-3 bg-card border-r border-b rotate-45"></div>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 justify-end text-sm text-muted-foreground">
                          <Database className="h-3 w-3" />
                          <span>{(block.size / 1024).toFixed(2)} KB</span>
                        </div>
                      </div>
                    </div>

                    {/* Block Hash */}
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                      <span className="text-xs text-muted-foreground font-medium">Hash:</span>
                      <span className="font-mono text-sm flex-1 truncate">{block.hash}</span>
                      <CopyButton text={block.hash} />
                    </div>

                    {/* Stats Row */}
                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Size</p>
                        <p className="font-medium text-sm">{block.size.toLocaleString()} bytes</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Transactions</p>
                        <p className="font-medium text-sm">{block.txlength}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {startIndex + 1}-{Math.min(endIndex, blocks.length)} of {blocks.length} blocks
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>

            <div className="flex items-center gap-1 px-3 py-1 text-sm">
              Page <span className="font-medium">{currentPage}</span> of{" "}
              <span className="font-medium">{totalPages}</span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Info Card */}
      <Card className="bg-muted/50 border-primary/10">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Coins className="h-5 w-5 text-primary mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium">About Blocks</p>
              <p className="text-xs text-muted-foreground">
                Blocks contain all transactions on the Flux blockchain. Each block is validated using
                Proof of Useful Work (PoUW) consensus. Click on any block to view detailed information
                including all transactions.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

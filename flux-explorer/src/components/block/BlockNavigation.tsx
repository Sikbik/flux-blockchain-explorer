"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Home } from "lucide-react";
import Link from "next/link";

interface BlockNavigationProps {
  currentHeight: number;
  previousHash?: string;
  nextHash?: string;
}

export function BlockNavigation({
  currentHeight,
  previousHash,
  nextHash,
}: BlockNavigationProps) {
  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 overflow-hidden">
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <Button variant="outline" size="sm" asChild className="flex-shrink-0">
          <Link href="/">
            <Home className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Home</span>
          </Link>
        </Button>
        {previousHash && (
          <Button variant="outline" size="sm" asChild className="flex-1 sm:flex-initial min-w-0">
            <Link href={`/block/${previousHash}`} className="overflow-hidden">
              <ChevronLeft className="h-4 w-4 mr-2 flex-shrink-0" />
              <span className="hidden md:inline truncate">Previous Block</span>
              <span className="md:hidden truncate">Prev</span>
              <span className="ml-2 text-muted-foreground hidden lg:inline whitespace-nowrap">
                #{(currentHeight - 1).toLocaleString()}
              </span>
            </Link>
          </Button>
        )}
      </div>

      {nextHash && (
        <Button variant="outline" size="sm" asChild className="w-full sm:w-auto min-w-0">
          <Link href={`/block/${nextHash}`} className="overflow-hidden">
            <span className="mr-2 text-muted-foreground hidden lg:inline whitespace-nowrap">
              #{(currentHeight + 1).toLocaleString()}
            </span>
            <span className="hidden md:inline truncate">Next Block</span>
            <span className="md:hidden truncate">Next</span>
            <ChevronRight className="h-4 w-4 ml-2 flex-shrink-0" />
          </Link>
        </Button>
      )}
    </div>
  );
}

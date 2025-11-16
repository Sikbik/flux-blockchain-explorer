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
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href="/">
            <Home className="h-4 w-4 mr-2" />
            Home
          </Link>
        </Button>
        {previousHash && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/block/${previousHash}`}>
              <ChevronLeft className="h-4 w-4 mr-2" />
              Previous Block
              <span className="ml-2 text-muted-foreground">
                #{(currentHeight - 1).toLocaleString()}
              </span>
            </Link>
          </Button>
        )}
      </div>

      {nextHash && (
        <Button variant="outline" size="sm" asChild>
          <Link href={`/block/${nextHash}`}>
            <span className="mr-2 text-muted-foreground">
              #{(currentHeight + 1).toLocaleString()}
            </span>
            Next Block
            <ChevronRight className="h-4 w-4 ml-2" />
          </Link>
        </Button>
      )}
    </div>
  );
}

import { Suspense } from "react";
import { BlocksList } from "@/components/blocks/BlocksList";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = {
  title: "Recent Blocks - Flux Explorer",
  description: "Browse recent blocks on the Flux blockchain",
};

function BlocksListSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(10)].map((_, i) => (
        <div key={i} className="p-4 rounded-lg border bg-card">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-6 w-24" />
            </div>
            <div className="flex items-center gap-4">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function BlocksPage() {
  return (
    <div className="container py-8 max-w-[1600px] mx-auto">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recent Blocks</h1>
          <p className="text-muted-foreground mt-2">
            Browse the most recent blocks on the Flux blockchain
          </p>
        </div>

        <Suspense fallback={<BlocksListSkeleton />}>
          <BlocksList />
        </Suspense>
      </div>
    </div>
  );
}

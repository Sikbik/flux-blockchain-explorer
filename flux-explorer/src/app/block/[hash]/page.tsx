import { Suspense } from "react";
import { BlockDetail } from "@/components/block/BlockDetail";
import { Skeleton } from "@/components/ui/skeleton";

interface PageProps {
  params: {
    hash: string;
  };
}

export default function BlockPage({ params }: PageProps) {
  return (
    <div className="container py-8 max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
      <Suspense fallback={<BlockDetailSkeleton />}>
        <BlockDetail hashOrHeight={params.hash} />
      </Suspense>
    </div>
  );
}

function BlockDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  );
}

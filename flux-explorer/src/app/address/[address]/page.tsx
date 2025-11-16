import { Suspense } from "react";
import { AddressDetail } from "@/components/address/AddressDetail";
import { Skeleton } from "@/components/ui/skeleton";

interface PageProps {
  params: {
    address: string;
  };
}

export default function AddressPage({ params }: PageProps) {
  return (
    <div className="container py-8 max-w-[1600px] mx-auto">
      <Suspense fallback={<AddressDetailSkeleton />}>
        <AddressDetail address={params.address} />
      </Suspense>
    </div>
  );
}

function AddressDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-48 w-full" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

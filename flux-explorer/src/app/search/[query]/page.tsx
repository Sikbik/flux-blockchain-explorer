"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { FluxAPI } from "@/lib/api";

/**
 * Universal search page that intelligently routes to the correct page
 * Handles ambiguous 64-character hex strings by checking if they're transactions or blocks
 */
export default function SearchPage() {
  const router = useRouter();
  const params = useParams();
  const query = params.query as string;

  useEffect(() => {
    async function resolveSearch() {
      if (!query) {
        router.replace("/");
        return;
      }

      const trimmedQuery = query.trim();

      // Number: block height
      if (/^[0-9]+$/.test(trimmedQuery)) {
        router.replace(`/block/${trimmedQuery}`);
        return;
      }

      // Address
      if (trimmedQuery.startsWith("t1") || trimmedQuery.startsWith("t3")) {
        router.replace(`/address/${trimmedQuery}`);
        return;
      }

      // 64-character hex: could be transaction or block hash
      if (/^[a-fA-F0-9]{64}$/.test(trimmedQuery)) {
        try {
          // Try as transaction first (more common)
          await FluxAPI.getTransaction(trimmedQuery);
          router.replace(`/tx/${trimmedQuery}`);
          return;
        } catch {
          // If transaction fails, try as block hash
          try {
            await FluxAPI.getBlock(trimmedQuery);
            router.replace(`/block/${trimmedQuery}`);
            return;
          } catch {
            // Neither worked - show error
            router.replace(`/tx/${trimmedQuery}`);
            return;
          }
        }
      }

      // Default: try as transaction
      router.replace(`/tx/${trimmedQuery}`);
    }

    resolveSearch();
  }, [query, router]);

  return (
    <div className="container mx-auto py-8 max-w-[1600px]">
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Searching...</p>
        </div>
      </div>
    </div>
  );
}

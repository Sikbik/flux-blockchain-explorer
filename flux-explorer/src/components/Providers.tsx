"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";
import { parseError } from "@/lib/api/error-handler";
import "@/lib/api/health-monitor"; // Import to trigger initialization

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Parse the error to determine if it's retryable
              const errorResponse = parseError(error);

              // Don't retry if error is not retryable (e.g., 404, 400)
              if (!errorResponse.canRetry) {
                return false;
              }

              // Retry up to 3 times for network/server errors
              return failureCount < 3;
            },
            retryDelay: (attemptIndex) => {
              // Exponential backoff: 1s, 2s, 4s
              return Math.min(1000 * 2 ** attemptIndex, 30000);
            },
          },
          mutations: {
            retry: (failureCount, error) => {
              // Don't retry mutations on client errors
              const errorResponse = parseError(error);
              if (!errorResponse.canRetry) {
                return false;
              }
              return failureCount < 2;
            },
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

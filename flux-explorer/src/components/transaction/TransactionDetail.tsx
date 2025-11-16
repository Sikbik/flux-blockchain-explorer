"use client";

import { useEffect } from "react";
import { useTransaction } from "@/lib/api/hooks/useTransactions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TransactionHeader } from "./TransactionHeader";
import { TransactionOverview } from "./TransactionOverview";
import { TransactionInputsOutputs } from "./TransactionInputsOutputs";
import { TransactionRawData } from "./TransactionRawData";
import { PollingControls } from "@/components/common/PollingControls";
import { usePolling, POLLING_INTERVALS } from "@/hooks/usePolling";
import { AlertCircle } from "lucide-react";

interface TransactionDetailProps {
  txid: string;
}

export function TransactionDetail({ txid }: TransactionDetailProps) {
  // Set up polling - faster for unconfirmed transactions
  const polling = usePolling({
    interval: POLLING_INTERVALS.NORMAL, // 30 seconds default
    enabled: true,
  });

  const { data: transaction, isLoading, error, refetch } = useTransaction(txid, {
    staleTime: 0,
    refetchOnWindowFocus: false,
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
    return <TransactionDetailSkeleton />;
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Error Loading Transaction
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            {error.message || "Failed to load transaction data. Please try again."}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!transaction) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transaction Not Found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            The requested transaction could not be found.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Adjust polling speed based on confirmation status
  // Unconfirmed transactions should poll more frequently
  const isUnconfirmed = transaction.confirmations === 0;
  if (isUnconfirmed && polling.interval > POLLING_INTERVALS.FREQUENT) {
    polling.setInterval(POLLING_INTERVALS.FREQUENT);
  }

  return (
    <div className="space-y-6">
      {/* Polling Controls */}
      <PollingControls polling={{ ...polling, refresh: handleRefresh }} />

      {/* Transaction Header */}
      <TransactionHeader transaction={transaction} />

      {/* Transaction Overview */}
      <TransactionOverview transaction={transaction} />

      {/* Inputs and Outputs */}
      <TransactionInputsOutputs transaction={transaction} />

      {/* Raw Data Viewer */}
      <TransactionRawData txid={txid} transaction={transaction} />
    </div>
  );
}

function TransactionDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-32 w-full" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Download, FileJson } from "lucide-react";
import { AddressTransactionSummary } from "@/types/flux-api";
import { FluxAPI } from "@/lib/api/client";
import { batchGetFluxPrices } from "@/lib/api/price-history-client";

interface TransactionExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  address: string;
  totalTransactions: number;
}

type ExportFormat = "csv" | "json";

const PRESET_COUNTS = [
  { label: "Last 100", value: 100 },
  { label: "Last 500", value: 500 },
  { label: "Last 1,000", value: 1000 },
  { label: "Last 5,000", value: 5000 },
  { label: "All", value: -1 },
];

export function TransactionExportDialog({
  open,
  onOpenChange,
  address,
  totalTransactions,
}: TransactionExportDialogProps) {
  const [selectedCount, setSelectedCount] = useState<number>(-1);
  const [customCount, setCustomCount] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fetchedCount, setFetchedCount] = useState(0);
  const [targetCount, setTargetCount] = useState(0);
  const [currentStatus, setCurrentStatus] = useState("");

  const handleExport = async (format: ExportFormat) => {
    const count = selectedCount === -1
      ? totalTransactions
      : selectedCount > 0
        ? selectedCount
        : parseInt(customCount) || 100;

    setIsExporting(true);
    setProgress(0);
    setFetchedCount(0);
    setTargetCount(count);
    setCurrentStatus("Fetching transactions...");

    try {
      const batchSize = 1000; // Fetch 1000 transactions at a time
      let allTransactions: AddressTransactionSummary[] = [];
      let offset = 0;

      // Step 1: Fetch all transactions
      while (allTransactions.length < count) {
        const limit = Math.min(batchSize, count - allTransactions.length);

        // Fetch batch from API using FluxAPI client
        const data = await FluxAPI.getAddressTransactions([address], {
          from: offset,
          to: offset + limit,
        });

        const items = data.items || [];
        allTransactions = allTransactions.concat(items);

        offset += items.length; // Increment by actual items received
        setFetchedCount(allTransactions.length);
        setProgress((allTransactions.length / count) * 50); // First 50% is fetching transactions

        // Break if we've received fewer transactions than requested (end of data)
        if (items.length === 0 || items.length < limit) {
          break;
        }
      }

      // Step 2: Fetch price data for all transactions (second 50% of progress)
      setCurrentStatus("Fetching price data...");
      const timestamps = allTransactions.map(tx => tx.timestamp).filter(ts => ts > 0);
      const priceMap = await batchGetFluxPrices(timestamps);

      // Update progress as we process price data
      setProgress(75);

      // Step 3: Split into multiple files if needed (100K transactions per file)
      const MAX_TRANSACTIONS_PER_FILE = 100000;
      const totalFiles = Math.ceil(allTransactions.length / MAX_TRANSACTIONS_PER_FILE);
      const dateStr = new Date().toISOString().split('T')[0];

      if (totalFiles > 1) {
        setCurrentStatus(`Generating ${totalFiles} files (100K transactions per file)...`);
      } else {
        setCurrentStatus("Generating file...");
      }

      for (let fileIndex = 0; fileIndex < totalFiles; fileIndex++) {
        const start = fileIndex * MAX_TRANSACTIONS_PER_FILE;
        const end = Math.min(start + MAX_TRANSACTIONS_PER_FILE, allTransactions.length);
        const chunk = allTransactions.slice(start, end);

        // Generate file content based on format
        let content: string;
        let filename: string;
        let mimeType: string;

        if (format === "csv") {
          content = generateCSV(chunk, address, priceMap);
          filename = totalFiles > 1
            ? `${address}_transactions_${dateStr}_part${fileIndex + 1}of${totalFiles}.csv`
            : `${address}_transactions_${dateStr}.csv`;
          mimeType = "text/csv";
        } else {
          content = JSON.stringify(chunk, null, 2);
          filename = totalFiles > 1
            ? `${address}_transactions_${dateStr}_part${fileIndex + 1}of${totalFiles}.json`
            : `${address}_transactions_${dateStr}.json`;
          mimeType = "application/json";
        }

        setProgress(75 + ((fileIndex + 1) / totalFiles) * 25);

        // Trigger download
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        // Small delay between file downloads to avoid browser blocking
        if (fileIndex < totalFiles - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Close dialog after successful export
      setTimeout(() => {
        onOpenChange(false);
        setIsExporting(false);
        setProgress(0);
      }, 500);

    } catch (error) {
      console.error("Export failed:", error);
      alert(`Export failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      setIsExporting(false);
    }
  };

  const generateCSV = (
    transactions: AddressTransactionSummary[],
    address: string,
    priceMap: Map<number, number | null>
  ): string => {
    // CSV header compatible with Koinly and other tax software
    // Date format: UTC timezone
    const header = "Date (UTC),Type,Amount,Currency,Price USD,Value USD,TxHash,Block Height,Confirmations,From Address,To Address,Notes\n";

    const rows = transactions.map((tx) => {
      const date = tx.timestamp
        ? new Date(tx.timestamp * 1000).toISOString().replace('T', ' ').replace('Z', '')
        : "";

      const type = tx.isCoinbase
        ? "Block Reward"
        : tx.direction === "received"
          ? "Receive"
          : "Send";

      const amount = Math.abs(tx.value).toFixed(8);
      const currency = "FLUX";

      // Get price at transaction time
      const price = tx.timestamp ? (priceMap.get(tx.timestamp) ?? null) : null;
      const priceStr = price !== null ? price.toFixed(6) : "";
      const valueUsd = price !== null ? (Math.abs(tx.value) * price).toFixed(2) : "";

      const txHash = tx.txid;
      const blockHeight = tx.blockHeight || "";
      const confirmations = tx.confirmations || 0;

      // For received transactions, show sender(s); for sent, show recipient(s)
      const fromAddress = tx.direction === "received"
        ? (tx.fromAddresses && tx.fromAddresses.length > 0 ? tx.fromAddresses.join("; ") : "")
        : address;

      const toAddress = tx.direction === "sent"
        ? (tx.toAddresses && tx.toAddresses.length > 0 ? tx.toAddresses.join("; ") : "")
        : address;

      const notes = tx.isCoinbase ? "Coinbase" : "";

      // Escape fields that might contain commas
      return [
        date,
        type,
        amount,
        currency,
        priceStr,
        valueUsd,
        txHash,
        blockHeight,
        confirmations,
        `"${fromAddress}"`,
        `"${toAddress}"`,
        notes,
      ].join(",");
    });

    return header + rows.join("\n");
  };

  const handlePresetClick = (value: number) => {
    setSelectedCount(value);
    setCustomCount("");
  };

  const handleCustomCountChange = (value: string) => {
    setCustomCount(value);
    const parsed = parseInt(value);
    if (!isNaN(parsed) && parsed > 0) {
      setSelectedCount(parsed);
    }
  };

  const displayCount = selectedCount === -1
    ? totalTransactions
    : selectedCount > 0
      ? selectedCount
      : parseInt(customCount) || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transaction History</DialogTitle>
          <DialogDescription>
            {totalTransactions.toLocaleString()} total transactions
          </DialogDescription>
        </DialogHeader>

        {isExporting ? (
          <div className="space-y-4 py-4">
            <div className="text-sm font-medium text-center">
              {currentStatus}
            </div>
            {progress < 50 && (
              <div className="text-sm text-muted-foreground text-center">
                {fetchedCount.toLocaleString()} / {targetCount.toLocaleString()} transactions
              </div>
            )}
            <Progress value={progress} className="h-2" />
            <div className="text-center">
              <div className="text-2xl font-bold">{Math.round(progress)}%</div>
            </div>
            {targetCount > 100000 && (
              <div className="text-xs text-muted-foreground text-center">
                Large exports are split into multiple files (100K transactions each)
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Transaction count selection */}
            <div className="space-y-3">
              <label className="text-sm font-medium">
                Number of transactions to export
              </label>

              {/* Preset buttons */}
              <div className="flex flex-wrap gap-2">
                {PRESET_COUNTS.map((preset) => (
                  <Button
                    key={preset.label}
                    variant={selectedCount === preset.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => handlePresetClick(preset.value)}
                    disabled={preset.value > totalTransactions && preset.value !== -1}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>

              {/* Custom count input */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  Or enter exact amount:
                </label>
                <Input
                  type="number"
                  min="1"
                  max={totalTransactions}
                  value={customCount}
                  onChange={(e) => handleCustomCountChange(e.target.value)}
                  placeholder="All"
                  className="w-full"
                />
              </div>

              {displayCount > 0 && (
                <div className="text-xs text-muted-foreground text-right">
                  Will export {displayCount > totalTransactions ? totalTransactions : displayCount} of {totalTransactions.toLocaleString()} transactions
                </div>
              )}
            </div>

            {/* Export buttons */}
            <div className="flex gap-2">
              <Button
                onClick={() => handleExport("csv")}
                disabled={displayCount === 0}
                className="flex-1"
                variant="default"
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
              <Button
                onClick={() => handleExport("json")}
                disabled={displayCount === 0}
                className="flex-1"
                variant="outline"
              >
                <FileJson className="h-4 w-4 mr-2" />
                Export JSON
              </Button>
            </div>

            <Button
              onClick={() => onOpenChange(false)}
              variant="ghost"
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

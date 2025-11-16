"use client";

import { Block } from "@/types/flux-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Package,
  Coins,
  Zap,
  Server,
  Binary,
  Layers,
  Database,
  TrendingUp,
} from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";

interface BlockStatsProps {
  block: Block;
}

export function BlockStats({ block }: BlockStatsProps) {
  const summary = block.txSummary;
  const coinbaseDetail = block.txDetails?.find((detail) => detail.kind === "coinbase");

  const regularCount = summary
    ? summary.coinbase + summary.transfers
    : (block.txDetails?.filter((detail) => detail.kind === "coinbase" || detail.kind === "transfer").length || block.tx.length || 0);
  const nodeConfirmations = summary
    ? summary.fluxnodeConfirm
    : (block.txDetails?.filter((detail) => detail.kind === "fluxnode_confirm").length || 0);
  const blockReward = coinbaseDetail?.value ?? block.reward ?? 0;
  const isLoadingSummary = !summary;

  const stats = [
    {
      label: "Transactions",
      value: regularCount.toLocaleString(),
      subtitle: nodeConfirmations > 0
        ? `+${nodeConfirmations.toLocaleString()} node confirmations`
        : undefined,
      icon: Package,
      gradient: "from-blue-500 to-cyan-500",
    },
    {
      label: "Block Reward",
      value: `${blockReward.toFixed(8)} FLUX`,
      icon: Coins,
      gradient: "from-green-500 to-emerald-500",
    },
    {
      label: "Block Size",
      value: `${((block.size || 0) / 1024).toFixed(2)} KB`,
      subtitle: `${(block.size || 0).toLocaleString()} bytes`,
      icon: Database,
      gradient: "from-purple-500 to-pink-500",
    },
    {
      label: "Difficulty",
      value: (block.difficulty || 0).toFixed(8),
      icon: Zap,
      gradient: "from-orange-500 to-red-500",
    },
    {
      label: "Version",
      value: (block.version || 0).toString(),
      icon: Binary,
      gradient: "from-cyan-500 to-blue-500",
    },
    {
      label: "Bits",
      value: block.bits || "N/A",
      icon: Layers,
      gradient: "from-indigo-500 to-purple-500",
    },
    {
      label: "Nonce",
      value: block.nonce || "N/A",
      icon: TrendingUp,
      gradient: "from-pink-500 to-rose-500",
    },
    ...(block.chainwork ? [{
      label: "Chainwork",
      value: block.chainwork.slice(0, 16) + "...",
      subtitle: "Cumulative proof of work",
      icon: Server,
      gradient: "from-yellow-500 to-orange-500",
    }] : []),
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Block Statistics</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="relative overflow-hidden select-text">
            <div
              className={`absolute inset-0 bg-gradient-to-br ${stat.gradient} opacity-[0.03] pointer-events-none`}
            />
            <CardHeader className="pb-2 select-text">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground select-none">
                <stat.icon className="h-4 w-4" />
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="select-text">
              {stat.label === "Transactions" && isLoadingSummary ? (
                <div className="text-sm text-muted-foreground">Analyzing...</div>
              ) : stat.label === "Nonce" ? (
                <div className="text-sm font-mono font-bold break-all select-text cursor-text" style={{ userSelect: 'text' }}>{stat.value}</div>
              ) : (
                <div className="text-2xl font-bold select-text cursor-text" style={{ userSelect: 'text' }}>{stat.value}</div>
              )}
              {stat.subtitle && (
                <p className="text-xs text-muted-foreground mt-1 select-text cursor-text" style={{ userSelect: 'text' }}>{stat.subtitle}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* FluxNode Miner Information */}
      {(block.miner || block.nodeTier) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              FluxNode Miner
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {block.nodeTier && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Node Tier</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-semibold ${
                        block.nodeTier === "CUMULUS"
                          ? "text-pink-500"
                          : block.nodeTier === "NIMBUS"
                          ? "text-purple-500"
                          : "text-blue-500"
                      }`}
                    >
                      {block.nodeTier}
                    </span>
                  </div>
                </div>
              )}
              {block.miner && (
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">Wallet Address</div>
                  <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-2">
                    <a
                      href={`/address/${block.miner}`}
                      className="font-mono text-sm font-medium text-primary hover:underline flex-1 truncate"
                    >
                      {block.miner}
                    </a>
                    <CopyButton text={block.miner} />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

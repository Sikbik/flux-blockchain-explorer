"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Pickaxe, Coins, ArrowRight } from "lucide-react";
import { useDashboardStats } from "@/lib/api/hooks/useDashboardStats";
import { getRewardLabel } from "@/lib/block-rewards";

export function RecentBlockRewards() {
  const { data: dashboardStats, isLoading } = useDashboardStats();
  const latestReward = dashboardStats?.latestRewards?.[0];

  const rewards = latestReward
    ? latestReward.outputs
        .filter((output) => output.value > 0)
        .map((output) => {
          const label = getRewardLabel(output.value, latestReward.height);
          return {
            address: output.address || "Unknown",
            amount: output.value,
            tier: label.type,
            color: label.color,
          };
        })
    : [];

  const totalReward = rewards.reduce((sum, reward) => sum + reward.amount, 0);

  // Keep animation running continuously
  // (animating state is always true for continuous animation)

  return (
    <Card className="overflow-hidden border-primary/5">
      <CardHeader className="bg-gradient-to-r from-yellow-500/10 to-transparent">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pickaxe className="h-5 w-5 text-yellow-500 animate-bounce" />
            Latest Block Rewards
          </div>
          <Link
            href={latestReward ? `/block/${latestReward.hash}` : '#'}
            className="text-sm font-normal text-primary hover:underline flex items-center gap-1"
          >
            View block
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-20 w-full" />
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </div>
        ) : latestReward ? (
          <div className="space-y-6">
            {/* Block Info */}
            <div>
              <Link
                href={`/block/${latestReward.hash}`}
                className="text-2xl font-bold hover:text-primary transition-colors"
              >
                Block #{latestReward.height.toLocaleString()}
              </Link>
              <p className="text-sm text-muted-foreground mt-1">
                Total Reward: {totalReward.toFixed(2)} FLUX
              </p>
            </div>

            {/* Reward Recipients */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground mb-3">
                Block Reward Distribution
              </h4>
              {rewards.map((reward, i) => {
                const linkTarget = reward.address !== "Unknown" ? `/address/${reward.address}` : "#";
                return (
                  <Link
                  key={`${latestReward.height}-${reward.address}-${i}`}
                  href={linkTarget}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors border border-border/50"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-1 h-12 rounded-full ${reward.color}`} />
                    <div className="min-w-0">
                      <Badge variant="outline" className={`mb-1 ${reward.color.replace('bg-', 'text-')} border-${reward.color.replace('bg-', '')}/20 bg-${reward.color.replace('bg-', '')}/10`}>
                        {reward.tier}
                      </Badge>
                      <p className="text-xs font-mono truncate text-muted-foreground">
                        {reward.address.substring(0, 12)}...{reward.address.substring(Math.max(reward.address.length - 8, 0))}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-sm font-bold">
                    <Coins className="h-4 w-4 text-yellow-500" />
                    {reward.amount.toFixed(8)}
                  </div>
                </Link>
              );
              })}
            </div>
          </div>
        ) : (
          <div className="text-center text-sm text-muted-foreground py-8">
            No block data available
          </div>
        )}
      </CardContent>
    </Card>
  );
}

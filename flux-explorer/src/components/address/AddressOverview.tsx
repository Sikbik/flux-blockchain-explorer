"use client";

import { AddressInfo } from "@/types/flux-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Coins,
  ArrowDownCircle,
  ArrowUpCircle,
  Activity,
  TrendingUp,
  Package,
} from "lucide-react";

interface AddressOverviewProps {
  addressInfo: AddressInfo;
}

export function AddressOverview({ addressInfo }: AddressOverviewProps) {
  // Calculate statistics
  const totalReceived = addressInfo.totalReceived;
  const totalSent = addressInfo.totalSent;
  const currentBalance = addressInfo.balance;
  const totalVolume = totalReceived + totalSent;
  const receivedPercentage = totalVolume > 0 ? (totalReceived / totalVolume) * 100 : 0;
  const sentPercentage = totalVolume > 0 ? (totalSent / totalVolume) * 100 : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Balance & Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Current Balance */}
            <StatCard
              icon={<Coins className="h-5 w-5 text-blue-500" />}
              label="Current Balance"
              value={`${currentBalance.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 8,
              })} FLUX`}
              description="Available to spend"
              highlighted
            />

            {/* Total Received */}
            <StatCard
              icon={<ArrowDownCircle className="h-5 w-5 text-green-500" />}
              label="Total Received"
              value={`${totalReceived.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 8,
              })} FLUX`}
              description="All-time received"
            />

            {/* Total Sent */}
            <StatCard
              icon={<ArrowUpCircle className="h-5 w-5 text-red-500" />}
              label="Total Sent"
              value={`${totalSent.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 8,
              })} FLUX`}
              description="All-time sent"
            />

            {/* Total Transactions */}
            <StatCard
              icon={<Activity className="h-5 w-5 text-purple-500" />}
              label="Total Transactions"
              value={addressInfo.txApperances.toLocaleString()}
              description={`${addressInfo.unconfirmedTxApperances} pending`}
            />
          </div>
        </CardContent>
      </Card>

      {/* Activity Breakdown */}
      {totalVolume > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Activity Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Total Volume */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">Total Volume</p>
                <p className="text-sm font-bold">
                  {totalVolume.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 8,
                  })}{" "}
                  FLUX
                </p>
              </div>
            </div>

            {/* Received vs Sent Visualization */}
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ArrowDownCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm">Received</span>
                  </div>
                  <span className="text-sm font-medium">
                    {receivedPercentage.toFixed(1)}%
                  </span>
                </div>
                <Progress value={receivedPercentage} className="h-2 bg-muted">
                  <div
                    className="h-full bg-green-500 transition-all"
                    style={{ width: `${receivedPercentage}%` }}
                  />
                </Progress>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ArrowUpCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm">Sent</span>
                  </div>
                  <span className="text-sm font-medium">
                    {sentPercentage.toFixed(1)}%
                  </span>
                </div>
                <Progress value={sentPercentage} className="h-2 bg-muted">
                  <div
                    className="h-full bg-red-500 transition-all"
                    style={{ width: `${sentPercentage}%` }}
                  />
                </Progress>
              </div>
            </div>

            {/* Net Flow */}
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Net Flow</span>
                </div>
                <span
                  className={`text-sm font-bold ${
                    totalReceived - totalSent > 0
                      ? "text-green-600"
                      : totalReceived - totalSent < 0
                      ? "text-red-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {totalReceived - totalSent > 0 ? "+" : ""}
                  {(totalReceived - totalSent).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 8,
                  })}{" "}
                  FLUX
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Difference between received and sent
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  description: string;
  highlighted?: boolean;
}

function StatCard({ icon, label, value, description, highlighted }: StatCardProps) {
  return (
    <div
      className={`flex gap-3 p-4 rounded-lg border ${
        highlighted ? "bg-primary/5 border-primary/20" : "bg-card"
      }`}
    >
      <div className="flex-shrink-0 mt-1">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="text-base sm:text-lg font-semibold mt-1 break-words">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  );
}

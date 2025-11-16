"use client";

import { useState } from "react";
import { AddressInfo } from "@/types/flux-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Wallet, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface AddressHeaderProps {
  addressInfo: AddressInfo;
}

export function AddressHeader({ addressInfo }: AddressHeaderProps) {
  const [showQR, setShowQR] = useState(false);
  const hasBalance = addressInfo.balance > 0;
  const hasUnconfirmed = addressInfo.unconfirmedBalance > 0;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <Wallet className="h-8 w-8 text-primary" />
              <div>
                <CardTitle className="text-2xl">Address</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Flux Blockchain Address
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hasBalance && (
                <Badge variant="default" className="gap-1">
                  Active
                </Badge>
              )}
              {hasUnconfirmed && (
                <Badge variant="secondary" className="gap-1">
                  Pending Txs
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowQR(!showQR)}
                className="gap-2"
              >
                <QrCode className="h-4 w-4" />
                {showQR ? "Hide" : "Show"} QR
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Address Display */}
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">
                Address
              </p>
              <div className="flex items-center gap-2 p-4 bg-muted rounded-lg">
                <code className="flex-1 font-mono text-sm sm:text-base break-all">
                  {addressInfo.addrStr}
                </code>
                <CopyButton text={addressInfo.addrStr} />
              </div>
            </div>

            {/* QR Code Display */}
            {showQR && (
              <div className="flex justify-center items-center p-6 bg-card rounded-lg border">
                <div className="text-center space-y-4">
                  <div className="p-4 bg-white rounded-lg">
                    <QRCodeSVG
                      value={addressInfo.addrStr}
                      size={200}
                      level="H"
                      includeMargin={true}
                      bgColor="#ffffff"
                      fgColor="#000000"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    Scan this QR code to copy the address
                  </p>
                </div>
              </div>
            )}

            {/* Quick Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 pt-2">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Current Balance</p>
                <p className="text-lg font-bold mt-1">
                  {addressInfo.balance.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 8,
                  })}{" "}
                  <span className="text-sm font-normal">FLUX</span>
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Transactions</p>
                <p className="text-lg font-bold mt-1">
                  {addressInfo.txApperances.toLocaleString()}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Unconfirmed</p>
                <p className="text-lg font-bold mt-1">
                  {addressInfo.unconfirmedBalance.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 8,
                  })}{" "}
                  <span className="text-sm font-normal">FLUX</span>
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

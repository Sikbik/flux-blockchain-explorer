"use client";

import { Heart } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";

export function Footer() {
  const donationAddress = "t3aYE1U7yncYeCoAGmfpbEXo3dbQSegZCSP";

  return (
    <footer className="border-t bg-card">
      <div className="container py-8 max-w-[1600px] mx-auto">
        <div className="flex flex-col items-center gap-4 text-center">
          {/* Built with love message */}
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            Built with <Heart className="h-4 w-4 text-red-500 fill-red-500 inline" /> for the Flux community
          </p>

          {/* Donation section */}
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs text-muted-foreground">
              Donations help development and hosting costs
            </p>
            <div className="flex items-center gap-2 p-2 sm:p-3 rounded-lg border bg-muted/50 max-w-full">
              <code className="text-xs font-mono text-foreground break-all max-w-[250px] sm:max-w-none">
                {donationAddress}
              </code>
              <CopyButton text={donationAddress} className="flex-shrink-0" />
            </div>
          </div>

          {/* Links */}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 text-xs text-muted-foreground pt-2">
            <a
              href="https://runonflux.io"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              Flux Network
            </a>
            <span className="hidden sm:inline">•</span>
            <a
              href="https://github.com/Sikbik/flux-blockchain-explorer"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              GitHub
            </a>
            <span className="hidden sm:inline">•</span>
            <a
              href="https://github.com/Sikbik/flux-blockchain-explorer/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              Report Issue
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

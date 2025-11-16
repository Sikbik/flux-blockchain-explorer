/**
 * Rich List Page
 *
 * Displays the Flux blockchain rich list with pagination
 */

import { Metadata } from "next";
import { RichListTable } from "@/components/rich-list/RichListTable";

export const metadata: Metadata = {
  title: "Rich List | Flux Explorer",
  description:
    "View the richest Flux addresses sorted by balance. Complete rich list with rankings and balance percentages.",
};

export default function RichListPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-[1600px]">
      <div className="space-y-6">
        {/* Page Header */}
        <div className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-bold">
            Flux Rich List
          </h1>
          <p className="text-muted-foreground">
            Top Flux addresses sorted by balance.
          </p>
        </div>

        {/* Rich List Table */}
        <RichListTable />
      </div>
    </div>
  );
}

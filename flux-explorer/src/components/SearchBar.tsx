"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

export function SearchBar() {
  const [query, setQuery] = useState("");
  const router = useRouter();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    const trimmedQuery = query.trim();

    // Use smart search route that handles ambiguous queries
    router.push(`/search/${encodeURIComponent(trimmedQuery)}`);
    setQuery("");
  };

  return (
    <form onSubmit={handleSearch} className="w-full max-w-2xl">
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by block height, hash, transaction ID, or address..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10 pr-4 h-12 text-base"
          />
        </div>
        <Button type="submit" size="lg" className="h-12 px-6">
          Search
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-2 ml-1">
        Search for blocks, transactions, or addresses
      </p>
    </form>
  );
}

"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Search, TrendingUp, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isHomePage = pathname === "/";

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/search/${encodeURIComponent(query.trim())}`);
    setQuery("");
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center max-w-[1600px] mx-auto px-4 sm:px-6 gap-3 sm:gap-6">
        <Link href="/" className="flex items-center gap-2 sm:gap-3 group shrink-0">
          <div className="relative">
            <Image
              src="/flux-logo.svg"
              alt="Flux Logo"
              width={28}
              height={28}
              className="group-hover:scale-110 transition-transform sm:w-8 sm:h-8"
            />
            <div className="absolute inset-0 blur-md bg-blue-500/20 group-hover:bg-blue-400/30 transition-all" />
          </div>
          <span className="font-bold text-lg sm:text-2xl bg-gradient-to-r from-blue-500 via-cyan-500 to-blue-600 bg-clip-text text-transparent group-hover:from-blue-400 group-hover:via-cyan-400 group-hover:to-blue-500 transition-all whitespace-nowrap">
            Flux Explorer
          </span>
        </Link>

        {/* Navigation Links - Desktop */}
        <nav className="hidden md:flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="gap-2"
          >
            <Link href="/rich-list">
              <TrendingUp className="h-4 w-4" />
              <span>Rich List</span>
            </Link>
          </Button>
        </nav>

        {/* Search bar - only show on non-homepage */}
        {!isHomePage && (
          <form onSubmit={handleSearch} className="flex-1 max-w-xl min-w-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground hidden sm:block" />
              <Input
                type="text"
                placeholder="Search..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-3 sm:pl-10 pr-4 h-10 text-sm"
              />
            </div>
          </form>
        )}

        {/* Mobile Menu Button */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden ml-auto"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Mobile Navigation Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t bg-background">
          <nav className="container max-w-[1600px] mx-auto px-4 py-3 space-y-2">
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="w-full justify-start gap-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              <Link href="/rich-list">
                <TrendingUp className="h-4 w-4" />
                <span>Rich List</span>
              </Link>
            </Button>
          </nav>
        </div>
      )}
    </header>
  );
}

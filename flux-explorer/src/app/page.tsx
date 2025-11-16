import { SearchBar } from "@/components/SearchBar";
import { NetworkStats } from "@/components/home/NetworkStats";
import { LatestBlocks } from "@/components/home/LatestBlocks";
import { RecentBlockRewards } from "@/components/home/RecentBlockRewards";

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Hero Section with Gradient */}
      <div className="relative overflow-hidden bg-gradient-to-b from-background via-background to-muted/20">
        {/* Background pattern */}
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.02]" />

        {/* Subtle gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />

        <div className="relative container py-12 sm:py-16 md:py-24 max-w-[1600px] mx-auto px-4 sm:px-6">
          <div className="flex flex-col items-center text-center space-y-6 sm:space-y-8">
            {/* Title */}
            <div className="space-y-3 sm:space-y-4 max-w-4xl">
              <h1 className="text-3xl font-bold tracking-tight sm:text-6xl lg:text-7xl bg-clip-text text-transparent bg-gradient-to-r from-primary via-accent to-primary px-4">
                Flux Explorer
              </h1>
              <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto px-4">
                Explore the Flux blockchain in real-time. Powered by PoUW consensus.
              </p>
            </div>

            {/* Search Bar */}
            <div className="w-full flex justify-center px-4">
              <SearchBar />
            </div>
          </div>
        </div>
      </div>

      {/* Network Stats Section */}
      <div className="container py-8 max-w-[1600px] mx-auto px-4 sm:px-6">
        <div className="space-y-6 sm:space-y-8">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold mb-2">Network Statistics</h2>
            <p className="text-sm text-muted-foreground">
              Real-time metrics from the Flux network
            </p>
          </div>
          <NetworkStats />
        </div>
      </div>

      {/* Latest Data Section */}
      <div className="container py-8 pb-16 max-w-[1600px] mx-auto px-4 sm:px-6">
        <div className="grid gap-6 sm:gap-8 lg:grid-cols-2">
          <LatestBlocks />
          <RecentBlockRewards />
        </div>
      </div>
    </div>
  );
}

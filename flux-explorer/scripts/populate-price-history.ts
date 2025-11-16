/**
 * Automated Price History Population Script
 *
 * Fetches historical hourly price data from CryptoCompare (free, no API key) and populates SQLite cache
 * - Rate-limit safe: 1 second delays between API calls
 * - Resumable: Skips already-populated date ranges
 * - Free: CryptoCompare free tier, no authentication required
 */

import { batchSetPrices, getPriceDataRange, initPriceCache, getCacheStats } from '../src/lib/db/price-cache';
import ky from 'ky';

const apiClient = ky.create({
  prefixUrl: 'https://min-api.cryptocompare.com/data/v2',
  timeout: 30000,
  retry: {
    limit: 5,
    methods: ['get'],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
  },
});

interface CryptoCompareHistoHourResponse {
  Response: string;
  Message: string;
  Data: {
    Data: Array<{
      time: number; // timestamp in seconds
      high: number;
      low: number;
      open: number;
      close: number;
    }>;
  };
}

/**
 * Fetch hourly prices from CryptoCompare (free, no API key required)
 * CryptoCompare returns max 2000 data points per call
 */
async function fetchPriceRange(fromTimestamp: number, toTimestamp: number): Promise<[number, number][]> {
  try {
    console.log(`  Fetching from ${new Date(fromTimestamp * 1000).toISOString()} to ${new Date(toTimestamp * 1000).toISOString()}`);

    const response = await apiClient.get(`histohour`, {
      searchParams: {
        fsym: 'FLUX',
        tsym: 'USD',
        toTs: toTimestamp.toString(),
        limit: '2000', // Max 2000 hours (~83 days)
      },
    }).json<CryptoCompareHistoHourResponse>();

    if (response.Response === 'Success' && response.Data && response.Data.Data) {
      // Use closing price for each hour, filter out zeros (missing data from API)
      const validPrices = response.Data.Data
        .filter(item => item.close > 0) // Skip zero prices (API has no data for that period)
        .map(item => [
          item.time,
          item.close,
        ] as [number, number]);

      const zeroCount = response.Data.Data.length - validPrices.length;
      if (zeroCount > 0) {
        console.log(`  ℹ️  Skipped ${zeroCount} entries with zero prices (no data available for that period)`);
      }

      return validPrices;
    }

    console.warn(`  ⚠️  No data returned`);
    return [];
  } catch (error) {
    console.error(`  Failed to fetch prices:`, error);
    console.warn(`  ⚠️  No data returned`);
    return [];
  }
}

/**
 * Populate historical price data
 */
async function populatePriceHistory() {
  console.log('🚀 Starting price history population...\n');

  // Initialize database
  initPriceCache();

  // Check current state
  const range = getPriceDataRange();
  console.log('Current database state:');
  console.log(`  Total entries: ${range.count.toLocaleString()}`);

  if (range.oldest_timestamp && range.newest_timestamp) {
    console.log(`  Oldest: ${new Date(range.oldest_timestamp * 1000).toISOString()}`);
    console.log(`  Newest: ${new Date(range.newest_timestamp * 1000).toISOString()}`);
  }

  // Check for zero prices (corrupted data from failed API calls)
  const db = initPriceCache();
  const zeroCount = db.prepare('SELECT COUNT(*) as count FROM price_history WHERE price_usd = 0').get() as { count: number };
  if (zeroCount.count > 0) {
    console.log(`  ⚠️  Warning: ${zeroCount.count.toLocaleString()} entries have zero prices (corrupted data)`);
    console.log(`  🔧 Deleting corrupted entries and re-fetching...\n`);
    db.prepare('DELETE FROM price_history WHERE price_usd = 0').run();
    // Recalculate range after deletion
    const newRange = getPriceDataRange();
    console.log(`After cleanup: ${newRange.count.toLocaleString()} valid entries remaining\n`);
  }
  console.log();

  // Determine date range to fetch
  const now = Math.floor(Date.now() / 1000);
  const fourYearsAgo = now - (4 * 365 * 24 * 60 * 60); // 4 years in seconds (CryptoCompare has data back to ~Oct 2021)

  // Use fresh range after potential zero-price cleanup
  const currentRange = getPriceDataRange();
  let startTimestamp = currentRange.oldest_timestamp ?? fourYearsAgo;
  let endTimestamp = currentRange.newest_timestamp ?? now;

  // If database is empty, start from 4 years ago
  if (currentRange.count === 0) {
    startTimestamp = fourYearsAgo;
    endTimestamp = now;
    console.log('📦 Empty database - will populate last 4 years of hourly data\n');
  } else {
    // Fill gaps: from oldest data going back 4 years
    if (startTimestamp > fourYearsAgo) {
      console.log('📦 Filling historical gap...\n');
      endTimestamp = startTimestamp;
      startTimestamp = fourYearsAgo;
    }
    // Update: from newest data to now
    else if (endTimestamp < now - 86400) { // If newest is older than 1 day
      console.log('📦 Updating recent data...\n');
      startTimestamp = endTimestamp;
      endTimestamp = now;
    } else {
      console.log('✅ Database is up to date!');
      return;
    }
  }

  // Fetch in chunks (CryptoCompare allows 2000 hours = ~83 days per call)
  const HOURS_PER_CHUNK = 2000;
  const CHUNK_SIZE = HOURS_PER_CHUNK * 60 * 60; // ~83 days in seconds
  const chunks: Array<[number, number]> = [];

  for (let start = startTimestamp; start < endTimestamp; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, endTimestamp);
    chunks.push([start, end]);
  }

  console.log(`📊 Will fetch ${chunks.length} chunks (~83 days each)\n`);

  let totalPricesAdded = 0;

  for (let i = 0; i < chunks.length; i++) {
    const [chunkStart, chunkEnd] = chunks[i];

    console.log(`Chunk ${i + 1}/${chunks.length}:`);

    const prices = await fetchPriceRange(chunkStart, chunkEnd);

    if (prices.length > 0) {
      batchSetPrices(prices);
      totalPricesAdded += prices.length;
      console.log(`  ✅ Stored ${prices.length.toLocaleString()} price points`);
    } else {
      console.log(`  ⚠️  No data returned`);
    }

    // Rate limiting: 1 second delay between chunks (CryptoCompare free tier is generous)
    if (i < chunks.length - 1) {
      console.log(`  ⏳ Waiting 1 second (rate limit protection)...\n`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('\n✨ Population complete!');
  console.log(`   Added ${totalPricesAdded.toLocaleString()} new price points\n`);

  // Show final stats
  const finalStats = getCacheStats();
  console.log('Final database stats:');
  console.log(`  Total entries: ${finalStats.total_entries.toLocaleString()}`);
  if (finalStats.oldest_date) {
    console.log(`  Date range: ${finalStats.oldest_date} to ${finalStats.newest_date}`);
  }
}

/**
 * Daily update function - fetches last 48 hours
 */
async function dailyUpdate() {
  console.log('🔄 Running daily price update...\n');

  initPriceCache();

  const now = Math.floor(Date.now() / 1000);
  const twoDaysAgo = now - (48 * 60 * 60); // 48 hours to ensure overlap

  console.log(`Fetching last 48 hours...`);

  const prices = await fetchPriceRange(twoDaysAgo, now);

  if (prices.length > 0) {
    batchSetPrices(prices);
    console.log(`✅ Updated with ${prices.length.toLocaleString()} price points`);
  } else {
    console.log(`⚠️  No data returned`);
  }

  const stats = getCacheStats();
  console.log(`\nTotal database entries: ${stats.total_entries.toLocaleString()}`);
}

// Main execution
const command = process.argv[2];

if (command === 'daily') {
  dailyUpdate().catch(error => {
    console.error('❌ Daily update failed:', error);
    process.exit(1);
  });
} else {
  populatePriceHistory().catch(error => {
    console.error('❌ Population failed:', error);
    process.exit(1);
  });
}

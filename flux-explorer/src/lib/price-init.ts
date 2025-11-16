/**
 * Automatic Price Data Initialization
 *
 * Runs on app startup to ensure price database is populated
 * - Checks if database exists and has recent data
 * - Automatically populates if needed (background process)
 * - Non-blocking: app starts immediately
 */

import { getPriceDataRange, initPriceCache, setCachedPriceHourly } from './db/price-cache';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import ky from 'ky';

let initializationStarted = false;
let hourlyUpdateInterval: NodeJS.Timeout | null = null;

/**
 * Check if price data needs initialization
 */
export function checkPriceDataStatus(): { needsInit: boolean; reason: string } {
  try {
    initPriceCache();
    const range = getPriceDataRange();

    // No data at all
    if (range.count === 0) {
      return { needsInit: true, reason: 'Database is empty' };
    }

    // Check if data is recent (within last 7 days)
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60);

    if (range.newest_timestamp && range.newest_timestamp < sevenDaysAgo) {
      return { needsInit: true, reason: `Data is outdated (newest: ${new Date(range.newest_timestamp * 1000).toISOString()})` };
    }

    // Check if we have reasonable amount of data (at least 6 months = ~4300 hours)
    if (range.count < 4000) {
      return { needsInit: true, reason: `Insufficient data (${range.count} entries, need ~4000+)` };
    }

    return { needsInit: false, reason: 'Database is populated and up-to-date' };
  } catch (error) {
    return { needsInit: true, reason: `Error checking database: ${error}` };
  }
}

/**
 * Initialize price data in background process
 */
export function initializePriceData(): void {
  if (initializationStarted) {
    console.log('💰 Price data initialization already in progress');
    return;
  }

  const status = checkPriceDataStatus();

  if (!status.needsInit) {
    console.log('✅ Price data is ready:', status.reason);
    return;
  }

  console.log('🚀 Initializing price data:', status.reason);
  console.log('   This will run in the background and may take 30-45 minutes');
  console.log('   The app will remain fully functional during this time');
  console.log('   Price data will be available once complete\n');

  initializationStarted = true;

  // Determine script path
  const scriptPath = path.join(process.cwd(), 'scripts', 'populate-price-history.ts');

  // Check if we have tsx available
  const useTsx = fs.existsSync(path.join(process.cwd(), 'node_modules', '.bin', 'tsx'));

  if (!useTsx) {
    console.warn('⚠️  tsx not found - price data population requires: npm install tsx');
    console.warn('   Run manually: npm run populate-prices');
    return;
  }

  // Spawn background process
  const child = spawn('npx', ['tsx', scriptPath], {
    detached: true,
    stdio: 'ignore', // Fully detached, won't block app
    cwd: process.cwd(),
  });

  // Detach from parent process
  child.unref();

  console.log(`📊 Price data population started (PID: ${child.pid})`);
  console.log('   Check logs: tail -f data/price-population.log\n');
}

/**
 * Fetch and store the latest hourly price from CryptoCompare (free, no auth)
 */
async function updateLatestHourlyPrice(): Promise<void> {
  try {
    // Fetch latest hourly data from CryptoCompare
    const response = await ky.get('https://min-api.cryptocompare.com/data/v2/histohour', {
      searchParams: {
        fsym: 'FLUX',
        tsym: 'USD',
        limit: '1', // Just get the latest hour
      },
      timeout: 30000,
    }).json<{
      Response: string;
      Data: {
        Data: Array<{
          time: number;
          close: number;
        }>;
      };
    }>();

    if (response.Response === 'Success' && response.Data && response.Data.Data && response.Data.Data.length > 0) {
      // Get the most recent price
      const latest = response.Data.Data[response.Data.Data.length - 1];
      const timestamp = latest.time;
      const price = latest.close;

      setCachedPriceHourly(timestamp, price);
      console.log(`💰 Updated hourly price: $${price.toFixed(4)} at ${new Date(timestamp * 1000).toISOString()}`);
    }
  } catch (error) {
    console.error('❌ Failed to fetch hourly price update:', error);
  }
}

/**
 * Start continuous hourly price updates
 */
export function startHourlyPriceUpdates(): void {
  if (hourlyUpdateInterval) {
    console.log('⏰ Hourly price updates already running');
    return;
  }

  console.log('⏰ Starting hourly price updates (runs every 60 minutes)');

  // Run immediately on startup
  updateLatestHourlyPrice();

  // Then run every hour
  hourlyUpdateInterval = setInterval(() => {
    updateLatestHourlyPrice();
  }, 60 * 60 * 1000); // 1 hour in milliseconds
}

/**
 * Stop hourly updates (for cleanup)
 */
export function stopHourlyPriceUpdates(): void {
  if (hourlyUpdateInterval) {
    clearInterval(hourlyUpdateInterval);
    hourlyUpdateInterval = null;
    console.log('⏰ Stopped hourly price updates');
  }
}

/**
 * Auto-initialize on module load (only in production)
 */
if (process.env.NODE_ENV === 'production' || process.env.AUTO_INIT_PRICES === 'true') {
  // Run initialization check after a short delay to not block server startup
  setTimeout(() => {
    try {
      initializePriceData();

      // Start hourly updates after initialization
      // Wait 2 minutes to let initial population start if needed
      setTimeout(() => {
        startHourlyPriceUpdates();
      }, 120000); // 2 minute delay
    } catch (error) {
      console.error('❌ Failed to initialize price data:', error);
      console.error('   Run manually: npm run populate-prices');
    }
  }, 5000); // 5 second delay after app starts
}

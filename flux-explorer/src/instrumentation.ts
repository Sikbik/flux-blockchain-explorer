/**
 * Next.js Instrumentation Hook
 *
 * This file is automatically loaded when the Next.js server starts.
 * Perfect for initialization tasks like price data population.
 *
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Server-side only initialization
    await import('./lib/price-init');
  }
}

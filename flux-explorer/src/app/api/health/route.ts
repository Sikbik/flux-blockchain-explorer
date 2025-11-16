/**
 * API Health Check Route
 *
 * Server-side endpoint that determines FluxIndexer API health
 * based on environment variables and health checks.
 */

import { NextResponse } from 'next/server';
import ky from 'ky';

// Force this route to be dynamic and never cached
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface HealthCheckResult {
  endpoint: string;
  type: 'local' | 'public';
  healthy: boolean;
  responseTime: number;
  error?: string;
}

async function checkEndpoint(url: string, type: 'local' | 'public'): Promise<HealthCheckResult> {
  const startTime = Date.now();

  try {
    await ky.get(`${url}/api/v1/status`, {
      timeout: 5000,
      retry: 0,
    }).json();

    return {
      endpoint: url,
      type,
      healthy: true,
      responseTime: Date.now() - startTime,
    };
  } catch (error) {
    return {
      endpoint: url,
      type,
      healthy: false,
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function GET() {
  console.log('[Health API] ============ HEALTH CHECK REQUEST ============');
  console.log('[Health API] All environment variables:', {
    SERVER_API_URL: process.env.SERVER_API_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  });

  // Use SERVER_API_URL for server-side requests (Docker internal), fallback to NEXT_PUBLIC_API_URL
  const apiUrl = process.env.SERVER_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

  console.log('[Health API] Resolved API URL:', apiUrl);

  const results: HealthCheckResult[] = [];

  // Check FluxIndexer endpoint
  const result = await checkEndpoint(apiUrl, 'local');
  results.push(result);
  console.log('[Health API] FluxIndexer check:', result);

  // Select best endpoint
  const selectedEndpoint = results.find(r => r.healthy);

  if (!selectedEndpoint) {
    return NextResponse.json({
      error: 'No healthy endpoints available',
      results,
    }, { status: 503 });
  }

  return NextResponse.json({
    selected: selectedEndpoint,
    allResults: results,
    mode: selectedEndpoint.type,
  });
}

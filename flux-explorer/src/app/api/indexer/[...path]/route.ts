/**
 * Indexer API Proxy
 *
 * Proxies requests to the FluxIndexer backend API.
 * This allows the frontend to call /api/indexer/* which gets forwarded to the backend.
 *
 * Works on:
 * - Flux deployments (appname.app.runonflux.io)
 * - Custom domains with CNAME
 * - VPS deployments
 */

import { NextRequest, NextResponse } from 'next/server';

// Get indexer URL from environment
// Production (Flux/VPS): SERVER_API_URL set via docker-compose
// Local dev: Falls back to 127.0.0.1:42067 (IPv4 explicit to avoid IPv6 issues)
const INDEXER_API_URL = process.env.SERVER_API_URL || 'http://127.0.0.1:42067';

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxyRequest(request, params.path, 'GET');
}

export async function POST(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxyRequest(request, params.path, 'POST');
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxyRequest(request, params.path, 'PUT');
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxyRequest(request, params.path, 'DELETE');
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxyRequest(request, params.path, 'PATCH');
}

async function proxyRequest(
  request: NextRequest,
  pathSegments: string[],
  method: string
) {
  try {
    // Reconstruct the path
    const path = pathSegments.join('/');

    // Get search params from the request
    const searchParams = request.nextUrl.searchParams.toString();
    const queryString = searchParams ? `?${searchParams}` : '';

    // Build the target URL
    const targetUrl = `${INDEXER_API_URL}/${path}${queryString}`;

    // Prepare headers (exclude host and other problematic headers)
    const headers = new Headers();
    request.headers.forEach((value, key) => {
      // Skip certain headers that shouldn't be forwarded
      if (!['host', 'connection', 'content-length'].includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    });

    // Prepare request options
    const options: RequestInit = {
      method,
      headers,
    };

    // For methods that can have a body, include it
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      try {
        const body = await request.text();
        if (body) {
          options.body = body;
        }
      } catch {
        // Body might not be available, continue without it
      }
    }

    // Make the request to the backend
    const response = await fetch(targetUrl, options);

    // Get response body
    const responseBody = await response.text();

    // Create response with same status and headers
    const proxyResponse = new NextResponse(responseBody, {
      status: response.status,
      statusText: response.statusText,
    });

    // Copy relevant headers
    response.headers.forEach((value, key) => {
      // Skip certain headers
      if (!['connection', 'transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) {
        proxyResponse.headers.set(key, value);
      }
    });

    // Add CORS headers if needed
    proxyResponse.headers.set('Access-Control-Allow-Origin', '*');
    proxyResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    proxyResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return proxyResponse;

  } catch (error) {
    console.error('Indexer proxy error:', error);

    return NextResponse.json(
      {
        error: 'Failed to proxy request to indexer',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 502 }
    );
  }
}

// Handle OPTIONS for CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

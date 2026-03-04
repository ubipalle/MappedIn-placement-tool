/**
 * app/api/products/route.ts
 *
 * Serves the merged product catalog to the placement tool client.
 * Server-side only — HubSpot credentials never reach the browser.
 *
 * GET /api/products
 *   Returns the full catalog: mounts, models, powerSources, unmapped.
 *
 * GET /api/products?refresh=1
 *   Busts the server-side cache and forces a fresh fetch from HubSpot.
 *   Useful after adding/updating products in HubSpot without waiting for TTL.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProductCatalog, invalidateProductCache } from '@/lib/hubspotProducts';

export async function GET(req: NextRequest) {
  try {
    const refresh = req.nextUrl.searchParams.get('refresh');
    if (refresh) {
      invalidateProductCache();
    }

    const catalog = await getProductCatalog();

    // Surface unmapped products as a warning header so they're visible
    // in the network tab during development without polluting the response body
    const headers: Record<string, string> = {};
    if (catalog.unmapped.length > 0) {
      headers['X-Unmapped-Products'] = catalog.unmapped
        .map((u) => u.slug)
        .join(', ');
    }

    return NextResponse.json(catalog, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/products] Failed to fetch product catalog:', message);
    return NextResponse.json(
      { error: 'Failed to fetch product catalog', detail: message },
      { status: 500 },
    );
  }
}

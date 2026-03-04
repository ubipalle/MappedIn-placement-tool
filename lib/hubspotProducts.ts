/**
 * lib/hubspotProducts.ts
 *
 * Server-side only. Fetches the product catalog from HubSpot and merges it
 * with the geometric/behavioural data in mounts.json.
 *
 * Merge rules:
 *   - Geometric properties (snapsToWalls, useCeilingHeight, parameters, locked)
 *     always come from mounts.json — these are physical realities, not catalog data.
 *   - Identity properties (name, sku, price) come from HubSpot and override
 *     whatever is in mounts.json, keeping the UI in sync with the catalog.
 *   - A HubSpot product whose internal_slug matches no mounts.json entry is
 *     flagged as "unmapped" so it surfaces visibly rather than silently disappearing.
 *   - A mounts.json entry with no matching HubSpot product keeps its local values
 *     and is flagged as "unpriced" — it will still appear in the UI but with a warning.
 *
 * Cache: in-process, 5-minute TTL — same pattern as the orchestrator.
 */

import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MountParameters {
  range: number;
  height: number;
  tilt: number;
  rotation: number;
}

export interface MountLocked {
  fieldOfView: boolean;
  range: boolean;
  height: boolean;
  tilt: boolean;
  rotation: boolean;
}

/** A fully resolved mount — geometric data from mounts.json, identity from HubSpot */
export interface ResolvedMount {
  id: string;
  name: string;
  sku: string;
  price: number | null;
  description: string;
  snapsToWalls: boolean;
  useCeilingHeight: boolean;
  parameters: MountParameters;
  locked: MountLocked;
  /** true if this mount has no matching HubSpot product */
  unpriced?: boolean;
}

export interface CameraModel {
  id: string;
  name: string;
  sku: string;
  price: number | null;
  defaultFOV: number;
  verticalFOV: number;
  internalTilt: number;
  description: string;
  unpriced?: boolean;
}

export interface PowerSource {
  id: string;
  name: string;
  sku: string;
  price: number | null;
  unpriced?: boolean;
}

/** A HubSpot product whose slug doesn't match any mounts.json entry */
export interface UnmappedProduct {
  slug: string;
  name: string;
  sku: string;
  price: number | null;
  productType: string;
}

export interface ProductCatalog {
  mounts: ResolvedMount[];
  models: CameraModel[];
  powerSources: PowerSource[];
  /** HubSpot products with a slug that has no geometric entry in mounts.json */
  unmapped: UnmappedProduct[];
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// mounts.json shape (raw, before HubSpot merge)
// ---------------------------------------------------------------------------

interface RawMount {
  id: string;
  name: string;
  sku: string;
  description: string;
  snapsToWalls: boolean;
  useCeilingHeight: boolean;
  parameters: MountParameters;
  locked: MountLocked;
}

interface RawModel {
  name: string;
  defaultFOV: number;
  verticalFOV: number;
  internalTilt: number;
  description: string;
}

interface RawPowerSource {
  id: string;
  name: string;
  sku: string;
}

interface RawMountsJson {
  mounts: RawMount[];
  models: Record<string, RawModel>;
  powerSources: RawPowerSource[];
}

// ---------------------------------------------------------------------------
// HubSpot fetch
// ---------------------------------------------------------------------------

interface HubSpotProduct {
  slug: string;
  name: string;
  sku: string;
  price: number | null;
  productType: string;
}

const HS_PROPERTIES = [
  'name',
  'price',
  'hs_sku',
  'hs_product_type',
  'internal_slug',
].join(',');

async function fetchHubSpotProducts(): Promise<HubSpotProduct[]> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    console.warn('[hubspotProducts] HUBSPOT_ACCESS_TOKEN not set — using mounts.json values only');
    return [];
  }

  const all: HubSpotProduct[] = [];
  let after: string | undefined;

  do {
    const url = new URL('https://api.hubapi.com/crm/v3/objects/products');
    url.searchParams.set('limit', '100');
    url.searchParams.set('properties', HS_PROPERTIES);
    if (after) url.searchParams.set('after', after);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      // Next.js fetch: don't cache at the HTTP layer — we manage our own TTL
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error(`HubSpot products API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    for (const item of data.results ?? []) {
      const p = item.properties ?? {};
      const slug = (p.internal_slug ?? '').trim();
      if (!slug) continue; // skip products with no slug — they're not relevant here

      all.push({
        slug,
        name: p.name ?? '',
        sku: (p.hs_sku ?? '').trim(),
        price: p.price != null ? parseFloat(p.price) : null,
        productType: (p.hs_product_type ?? '').toLowerCase(),
      });
    }

    after = data.paging?.next?.after;
  } while (after);

  console.log(`[hubspotProducts] Fetched ${all.length} slugged products from HubSpot`);
  return all;
}

// ---------------------------------------------------------------------------
// mounts.json loader
// ---------------------------------------------------------------------------

function loadMountsJson(): RawMountsJson {
  const filePath = path.join(process.cwd(), 'mounts.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as RawMountsJson;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

function mergeCatalog(raw: RawMountsJson, hsProducts: HubSpotProduct[]): ProductCatalog {
  // Index HubSpot products by slug for O(1) lookup
  const bySlug = new Map<string, HubSpotProduct>();
  for (const p of hsProducts) {
    bySlug.set(p.slug, p);
  }

  // Track which slugs we've consumed so we can identify unmapped ones
  const consumed = new Set<string>();

  // --- Mounts ---
  const mounts: ResolvedMount[] = raw.mounts.map((m) => {
    const hs = bySlug.get(m.id);
    if (hs) consumed.add(m.id);

    return {
      id: m.id,
      name: hs?.name ?? m.name,
      sku: hs?.sku ?? m.sku,
      price: hs?.price ?? null,
      description: m.description,       // always from mounts.json
      snapsToWalls: m.snapsToWalls,      // geometric — never from HubSpot
      useCeilingHeight: m.useCeilingHeight,
      parameters: m.parameters,
      locked: m.locked,
      unpriced: !hs,
    };
  });

  // --- Camera models ---
  const models: CameraModel[] = Object.entries(raw.models).map(([modelId, m]) => {
    const slug = modelId.toLowerCase(); // UC2W → uc2w
    const hs = bySlug.get(slug);
    if (hs) consumed.add(slug);

    return {
      id: modelId,
      name: hs?.name ?? m.name,
      sku: hs?.sku ?? '',
      price: hs?.price ?? null,
      defaultFOV: m.defaultFOV,
      verticalFOV: m.verticalFOV,
      internalTilt: m.internalTilt,
      description: m.description,
      unpriced: !hs,
    };
  });

  // --- Power sources ---
  const powerSources: PowerSource[] = raw.powerSources.map((ps) => {
    const hs = bySlug.get(ps.id);
    if (hs) consumed.add(ps.id);

    return {
      id: ps.id,
      name: hs?.name ?? ps.name,
      sku: hs?.sku ?? ps.sku,
      price: hs?.price ?? null,
      unpriced: !hs,
    };
  });

  // --- Unmapped: HubSpot slugs with no mounts.json entry ---
  const unmapped: UnmappedProduct[] = hsProducts
    .filter((p) => !consumed.has(p.slug))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      sku: p.sku,
      price: p.price,
      productType: p.productType,
    }));

  if (unmapped.length > 0) {
    console.warn(
      `[hubspotProducts] ${unmapped.length} HubSpot product(s) have no geometric entry in mounts.json:`,
      unmapped.map((u) => u.slug).join(', '),
    );
  }

  return {
    mounts,
    models,
    powerSources,
    unmapped,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let _cache: ProductCatalog | null = null;
let _cacheTime = 0;

export async function getProductCatalog(): Promise<ProductCatalog> {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
    return _cache;
  }

  const raw = loadMountsJson();
  const hsProducts = await fetchHubSpotProducts();
  _cache = mergeCatalog(raw, hsProducts);
  _cacheTime = Date.now();
  return _cache;
}

export function invalidateProductCache(): void {
  _cache = null;
  _cacheTime = 0;
}

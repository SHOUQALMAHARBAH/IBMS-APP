import { Injectable } from '@nestjs/common';

/**
 * Process 49 — the network boundary, isolated to two tiny classes so
 * `WatchlistSyncService` never calls `fetch()` directly. Real, live,
 * publicly documented URLs (verified reachable 2026-09-04) — both free, no
 * API key. Overridable via env var for a non-production environment that
 * wants to point at a local fixture server instead of the real one; neither
 * is called anywhere in the unit-test suite, and the e2e suite stubs
 * `globalThis.fetch` rather than hitting the real endpoints (a scheduled
 * background sync must not make automated tests flaky/slow/offline-broken).
 */

const DEFAULT_OFAC_SDN_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
const DEFAULT_UN_CONSOLIDATED_URL =
  'https://scsanctions.un.org/resources/xml/en/consolidated.xml';

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} -> HTTP ${response.status}`);
  }
  return response.text();
}

@Injectable()
export class OfacSdnFetcher {
  private readonly url = process.env.OFAC_SDN_URL ?? DEFAULT_OFAC_SDN_URL;

  fetchRaw(): Promise<string> {
    return fetchText(this.url);
  }
}

@Injectable()
export class UnConsolidatedFetcher {
  private readonly url =
    process.env.UN_CONSOLIDATED_URL ?? DEFAULT_UN_CONSOLIDATED_URL;

  fetchRaw(): Promise<string> {
    return fetchText(this.url);
  }
}

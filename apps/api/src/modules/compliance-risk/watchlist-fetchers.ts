import { Injectable } from '@nestjs/common';
import { fetchTextWithRetry } from '../../common/http-retry.util';

/**
 * Process 49 — the network boundary, isolated to two tiny classes so
 * `WatchlistSyncService` never calls `fetch()` directly. Real, live,
 * publicly documented URLs (verified reachable 2026-09-04) — both free, no
 * API key. Overridable via env var for a non-production environment that
 * wants to point at a local fixture server instead of the real one; neither
 * is called anywhere in the unit-test suite, and `watchlist-sync.e2e-spec.ts`
 * stubs `globalThis.fetch` rather than hitting the real endpoints.
 *
 * ## Timeout and retry
 *
 * These were a bare `fetch(url)` with **no timeout and no retry** until
 * 2026-09-12. That is a worse gap in production than in tests: this runs as a
 * twice-daily background job against endpoints nobody here operates, so a
 * stalled connection hung the sync indefinitely instead of failing it, and a
 * single transient 503 from treasury.gov meant the sanctions list silently did
 * not refresh that cycle. Measured the same day, `treasury.gov` took **9.4
 * seconds just to return its redirect**.
 *
 * The budget is deliberately generous — these are multi-megabyte downloads on
 * a background schedule, not interactive requests — and the timeout covers the
 * body read, not just the headers (see `fetchTextWithRetry`).
 *
 * Note what a retry here does NOT do: it cannot turn a truncated download into
 * a good one. That is the plausibility floor's job
 * (`watchlist-dataset.config.ts`), which refuses to publish a generation
 * drastically smaller than the one in force.
 */

const DEFAULT_OFAC_SDN_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
const DEFAULT_UN_CONSOLIDATED_URL =
  'https://scsanctions.un.org/resources/xml/en/consolidated.xml';

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function downloadOptions() {
  return {
    timeoutMs: positiveInt(process.env.WATCHLIST_FETCH_TIMEOUT_MS, 120_000),
    maxRetries: positiveInt(process.env.WATCHLIST_FETCH_MAX_RETRIES, 2),
  };
}

@Injectable()
export class OfacSdnFetcher {
  private readonly url = process.env.OFAC_SDN_URL ?? DEFAULT_OFAC_SDN_URL;

  fetchRaw(): Promise<string> {
    return fetchTextWithRetry(this.url, downloadOptions());
  }
}

@Injectable()
export class UnConsolidatedFetcher {
  private readonly url =
    process.env.UN_CONSOLIDATED_URL ?? DEFAULT_UN_CONSOLIDATED_URL;

  fetchRaw(): Promise<string> {
    return fetchTextWithRetry(this.url, downloadOptions());
  }
}

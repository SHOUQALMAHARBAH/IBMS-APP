// Process 49 — Sanctions & PEP Screening (backlog Part C #49, Domain F).
// Reads apps/api's /watchlist-sync endpoints: the on-demand trigger + status
// view for the sync job that keeps OFAC SDN / UN Consolidated cached
// locally (otherwise every 12 hours), and /screening/recurring-batch, the
// on-demand trigger for the customer re-screen sweep (otherwise every 4
// hours). sanctions-pep.screen (Compliance).

import { apiGet, apiPost } from '../auth/api-client';

export interface WatchlistSyncOutcome {
  source: string;
  status: 'succeeded' | 'failed';
  recordCount?: number;
  errorMessage?: string;
}

export interface WatchlistSyncRun {
  id: string;
  source: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  recordCount: number | null;
  errorMessage: string | null;
}

export interface ScreeningBatchResult {
  screened: number;
  hits: number;
  failed: number;
}

export function runWatchlistSync(): Promise<WatchlistSyncOutcome[]> {
  return apiPost('/watchlist-sync/run', {});
}

export function getWatchlistSyncStatus(): Promise<WatchlistSyncRun[]> {
  return apiGet('/watchlist-sync/status');
}

export function runRecurringScreeningBatch(): Promise<ScreeningBatchResult> {
  return apiPost('/screening/recurring-batch', {});
}

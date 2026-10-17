// Process 49 — Sanctions & PEP Screening (backlog Part C #49, Domain F).
// Reads apps/api's /watchlist-sync endpoints: the on-demand trigger + status
// view for the sync job that keeps OFAC SDN / UN Consolidated cached
// locally (otherwise every 12 hours), and /screening/recurring-batch, the
// on-demand trigger for the customer re-screen sweep (otherwise every 4
// hours). sanctions-pep.screen (Compliance).

import { apiGet, apiPost } from '../auth/api-client';

export type WatchlistSource = 'OFAC_SDN' | 'UN_CONSOLIDATED';

export type WatchlistSyncRunStatus = 'running' | 'succeeded' | 'failed';

export interface WatchlistSyncOutcome {
  source: WatchlistSource;
  status: 'succeeded' | 'failed';
  recordCount?: number;
  errorMessage?: string;
}

export interface WatchlistSyncRun {
  id: string;
  source: WatchlistSource;
  startedAt: string;
  completedAt: string | null;
  status: WatchlistSyncRunStatus;
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

/*
 * THE GENERATIONS OF EACH LIST, AND RESTORING AN EARLIER ONE.
 *
 * `GET /watchlist-sync/datasets` and `POST /watchlist-sync/datasets/:id/rollback`
 * had no web caller (IMPROVEMENTS § 1.44, § 1.63). The API's own comment calls the
 * rollback "the most consequential manual override in this module" — it decides
 * that the newest available sanctions list is NOT the one screening runs against —
 * and it could only be reached by constructing the request by hand. So an office
 * that received a truncated or corrupted list had no way back to the last good
 * generation from inside the application.
 *
 * The three refusals below are worth knowing about from the screen because they are
 * three different operator problems and the retention one is the case an operator
 * actually hits. (The rollback was never untested — `watchlist-dataset-lifecycle`
 * covers the happy path, the reason and the RBAC refusal. What it lacked was a
 * caller and an audit row.)
 */

export type DatasetVersionStatus =
  | 'DOWNLOADED'
  | 'VALIDATED'
  | 'PUBLISHED'
  | 'SUPERSEDED'
  | 'REJECTED';

export interface WatchlistDatasetVersion {
  id: string;
  source: WatchlistSource;
  status: DatasetVersionStatus;
  version: string;
  recordCount: number | null;
  addedCount: number | null;
  downloadedAt: string;
  publishedAt: string | null;
  supersededAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  publishedByUserId: string | null;
  rolledBackFromId: string | null;
  rollbackReason: string | null;
}

export function listWatchlistDatasets(): Promise<WatchlistDatasetVersion[]> {
  return apiGet('/watchlist-sync/datasets');
}

/** Only a SUPERSEDED generation can be restored, and only while its rows are
 * still present — a generation past the retention window is still LISTED and
 * cannot be rolled back to, because there would be nothing left to screen
 * against. Both refusals come from the server; the screen offers the control
 * only where it can succeed, and reports the server's sentence when it cannot. */
export function rollbackWatchlistDataset(
  id: string,
  reason: string,
): Promise<WatchlistDatasetVersion> {
  return apiPost(`/watchlist-sync/datasets/${encodeURIComponent(id)}/rollback`, {
    reason: reason.trim(),
  });
}

/** The DTO's floor. Restoring an older sanctions list narrows what screening can
 * find, so the stated basis is the control rather than paperwork. */
export const ROLLBACK_REASON_MIN_LENGTH = 10;

export function rollbackReasonIsValid(reason: string): boolean {
  return reason.trim().length >= ROLLBACK_REASON_MIN_LENGTH;
}

/** A generation the server will accept a rollback for: SUPERSEDED, and with rows
 * still present. `recordCount` is the ingest count for that generation, which is
 * the best signal the list view has — the authoritative check is the server's own
 * live count of surviving rows, so a rollback the screen offers can still be
 * refused, and that refusal is rendered rather than swallowed. */
export function datasetCanBeRestored(d: WatchlistDatasetVersion): boolean {
  return d.status === 'SUPERSEDED' && (d.recordCount ?? 0) > 0;
}

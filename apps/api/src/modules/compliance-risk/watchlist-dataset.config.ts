import type { DatasetVersionStatus, WatchlistSource } from '@ibms/db';

/**
 * Part B §6/§7 — the rules governing a list generation's lifecycle.
 *
 * Pure functions and constants, so the transition rules are testable without a
 * database and there is exactly one place that says what may follow what.
 */

/**
 * Which statuses a generation may move to from each status.
 *
 * `PUBLISHED` is reachable ONLY from `VALIDATED` and from `SUPERSEDED` (a
 * rollback). It is deliberately NOT reachable from `DOWNLOADED`: publishing a
 * generation nobody validated is precisely the "half-written list" failure this
 * feature exists to prevent, and leaving it representable in the transition
 * table would make the validation step advisory.
 *
 * `REJECTED` is terminal. A generation that failed validation is kept for the
 * audit trail — "we downloaded this and refused it, for this reason" is the
 * record that matters — but it never becomes publishable by a later attempt;
 * that attempt downloads its own generation.
 */
export const DATASET_TRANSITIONS: Readonly<
  Record<DatasetVersionStatus, readonly DatasetVersionStatus[]>
> = {
  DOWNLOADED: ['VALIDATED', 'REJECTED'],
  VALIDATED: ['PUBLISHED', 'REJECTED'],
  PUBLISHED: ['SUPERSEDED'],
  // Rollback: a superseded generation whose rows are still present can be
  // published again.
  SUPERSEDED: ['PUBLISHED'],
  REJECTED: [],
};

export function canTransition(
  from: DatasetVersionStatus,
  to: DatasetVersionStatus,
): boolean {
  return DATASET_TRANSITIONS[from].includes(to);
}

/**
 * How many non-published generations per source are kept.
 *
 * Retention exists for rollback: a generation with no rows left cannot be
 * rolled back to, however good its metadata looks. Two is enough to step back
 * past one bad publication without holding several multiples of ~19,000 rows
 * indefinitely.
 *
 * Rejected generations are kept as METADATA regardless — their rows are
 * dropped, but the row saying "this was refused, and why" is the audit trail.
 */
export const DATASET_RETENTION_COUNT = 2;

/** `OFAC_SDN@2026-09-10T18:00:00.000Z` — sortable, unambiguous, and stable
 * enough to be recorded on a `ScreeningResult` and looked up years later. */
export function datasetVersionLabel(
  source: WatchlistSource,
  downloadedAt: Date,
): string {
  return `${source}@${downloadedAt.toISOString()}`;
}

export interface DatasetValidationInput {
  parsedCount: number;
  /** The record count of the currently published generation for this source,
   * or null when there is none. */
  publishedCount: number | null;
  minAbsoluteRecords: number;
  minAcceptableRatio: number;
}

export interface DatasetValidationResult {
  ok: boolean;
  /** Operator-facing, and free of feed content. */
  reason: string;
  floor: number;
}

/**
 * Would this generation be a plausible replacement for the published one?
 *
 * The check that matters: a 200 response carrying the wrong content — a WAF
 * interstitial, a captcha, a changed redirect target — parses to zero or
 * near-zero records without throwing anything. Nothing distinguishes that from
 * a genuine drastic list shrink, which OFAC and UN lists do not do in practice.
 *
 * Refusing to publish is the safe direction: the previously published
 * generation stays in force and screening continues against a real list,
 * rather than against a nearly empty one that would return CLEAR for everybody.
 */
export function validateDataset(
  input: DatasetValidationInput,
): DatasetValidationResult {
  const floor =
    input.publishedCount && input.publishedCount > 0
      ? Math.floor(input.publishedCount * input.minAcceptableRatio)
      : input.minAbsoluteRecords;

  if (input.parsedCount < floor) {
    return {
      ok: false,
      floor,
      reason:
        `Parsed only ${input.parsedCount} record(s), below the plausibility floor of ${floor}` +
        (input.publishedCount
          ? ` (the published generation has ${input.publishedCount})`
          : ' (no previously published generation)') +
        ' — likely a fetch or parse failure rather than a real list change. Refusing to publish; the previous generation stays in force.',
    };
  }

  return {
    ok: true,
    floor,
    reason: `Parsed ${input.parsedCount} record(s), at or above the plausibility floor of ${floor}.`,
  };
}

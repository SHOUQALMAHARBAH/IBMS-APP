import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { WatchlistSource, WatchlistSyncRun } from '@ibms/db';
import { WatchlistEntryRepository } from '../../repositories/watchlist-entry.repository';
import { OfacSdnFetcher, UnConsolidatedFetcher } from './watchlist-fetchers';
import {
  WATCHLIST_MIN_ACCEPTABLE_RATIO,
  WATCHLIST_MIN_ABSOLUTE_RECORDS,
  normalizeWatchlistName,
  parseOfacSdnCsv,
  parseUnConsolidatedXml,
  type ParsedWatchlistRecord,
} from './watchlist-sync.config';

export interface WatchlistSyncOutcome {
  source: WatchlistSource;
  status: 'succeeded' | 'failed' | 'skipped';
  recordCount?: number;
  errorMessage?: string;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * Process 49 — fetches, parses, and caches the two free public sanctions
 * lists (`OFAC_SDN`, `UN_CONSOLIDATED`) into `WatchlistEntry`, on the
 * `WATCHLIST_SYNC_CRON` schedule (`WatchlistSyncScheduler`) or on demand
 * (`POST /watchlist-sync/run`, `sanctions-pep.screen`). Per-source
 * isolation: one source's fetch/parse failure does not block the other —
 * the `#9/#12/#27/#46/#48` per-candidate-isolation shape, at the source
 * level instead of the per-row level, since there are only two sources.
 */
@Injectable()
export class WatchlistSyncService {
  private readonly logger = new Logger(WatchlistSyncService.name);

  constructor(
    private readonly entries: WatchlistEntryRepository,
    private readonly ofac: OfacSdnFetcher,
    private readonly un: UnConsolidatedFetcher,
  ) {}

  /** Syncs both sources, each independently. Never throws — a scheduler
   * calling this must not have one source's failure abort the other or
   * crash the cron tick. */
  async runSync(): Promise<WatchlistSyncOutcome[]> {
    const [ofacResult, unResult] = await Promise.all([
      this.syncSource('OFAC_SDN', () => this.ofac.fetchRaw(), parseOfacSdnCsv),
      this.syncSource(
        'UN_CONSOLIDATED',
        () => this.un.fetchRaw(),
        parseUnConsolidatedXml,
      ),
    ]);
    return [ofacResult, unResult];
  }

  private async syncSource(
    source: WatchlistSource,
    fetchRaw: () => Promise<string>,
    parse: (raw: string) => ParsedWatchlistRecord[],
  ): Promise<WatchlistSyncOutcome> {
    // RACE-SAFE INVARIANT (a @code-reviewer BLOCKER on the first pass): the
    // partial UNIQUE on WatchlistSyncRun("source") WHERE status='running'
    // (migration 20260904140000) means a second, concurrent sync of the
    // SAME source can't even start — createSyncRun throws P2002 instead of
    // creating a row, so there is no run.id to interleave a pruneStale
    // against another run's in-flight upserts.
    let run: WatchlistSyncRun;
    try {
      run = await this.entries.createSyncRun(source);
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        this.logger.warn(
          `Watchlist sync (${source}) skipped — a sync for this source is already running.`,
        );
        return {
          source,
          status: 'skipped',
          errorMessage: 'a sync for this source is already running',
        };
      }
      throw err;
    }

    try {
      const raw = await fetchRaw();
      const parsed = parse(raw);

      // A @code-reviewer BLOCKER on the first pass: a 200 response carrying
      // the wrong content (a WAF/interstitial page, a captcha, a changed
      // redirect target) parses to zero or near-zero records without ever
      // throwing — nothing here distinguishes that from a genuine, drastic
      // list shrink (which OFAC/UN lists don't do in practice). Compare
      // against the last successful run's count before committing anything;
      // a suspicious drop is treated as a failure, leaving the existing
      // cache untouched rather than pruned to near-nothing.
      const lastSuccessful = await this.entries.findLastSuccessfulRun(source);
      const floor = lastSuccessful?.recordCount
        ? Math.floor(
            lastSuccessful.recordCount * WATCHLIST_MIN_ACCEPTABLE_RATIO,
          )
        : WATCHLIST_MIN_ABSOLUTE_RECORDS;
      if (parsed.length < floor) {
        throw new Error(
          `Parsed only ${parsed.length} record(s), below the plausibility floor of ${floor}` +
            (lastSuccessful?.recordCount
              ? ` (last successful sync had ${lastSuccessful.recordCount})`
              : ' (no prior successful sync)') +
            ' — likely a fetch/parse failure, not a real list change. Refusing to prune the existing cache.',
        );
      }

      // A @code-reviewer BLOCKER on the first pass: normalizeWatchlistName
      // reduces an all-non-Latin-script name to "" (a plausible fullName at
      // this scale — a degenerate/placeholder source field). Storing such a
      // row would make "" a live lookup key; skip it instead (logged, not
      // silently dropped without a trace).
      const withNormalizedName = parsed.map((record) => ({
        ...record,
        normalizedName: normalizeWatchlistName(record.fullName),
      }));
      const records = withNormalizedName.filter((r) => r.normalizedName !== '');
      const skippedEmpty = withNormalizedName.length - records.length;
      if (skippedEmpty > 0) {
        this.logger.warn(
          `Watchlist sync (${source}): ${skippedEmpty} record(s) normalized to an empty name and were not stored.`,
        );
      }

      await this.entries.upsertMany(source, run.id, records);
      await this.entries.pruneStale(source, run.id);
      await this.entries.completeSyncRun(run.id, {
        recordCount: records.length,
      });
      this.logger.log(
        `Watchlist sync (${source}): ${records.length} record(s) synced.`,
      );
      return { source, status: 'succeeded', recordCount: records.length };
    } catch (err) {
      const errorMessage = (err as Error).message;
      await this.entries.completeSyncRun(run.id, { errorMessage });
      this.logger.error(`Watchlist sync (${source}) failed: ${errorMessage}`);
      return { source, status: 'failed', errorMessage };
    }
  }

  findLatestSyncRuns(): Promise<WatchlistSyncRun[]> {
    return this.entries.findLatestSyncRuns();
  }
}

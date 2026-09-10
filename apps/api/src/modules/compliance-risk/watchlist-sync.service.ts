import { canonicalNameTokens } from './watchlist-match.config';
import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { WatchlistSource, WatchlistSyncRun } from '@ibms/db';
import { WatchlistEntryRepository } from '../../repositories/watchlist-entry.repository';
import type { WatchlistDatasetVersion } from '@ibms/db';
import { WatchlistDatasetVersionRepository } from '../../repositories/watchlist-dataset-version.repository';
import { validateDataset } from './watchlist-dataset.config';
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
  /** Part B §21 — entries seen for the first time in this run. */
  addedCount?: number;
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
    private readonly versions: WatchlistDatasetVersionRepository,
    private readonly ofac: OfacSdnFetcher,
    private readonly un: UnConsolidatedFetcher,
  ) {}

  /** Syncs both sources, each independently. Never throws — a scheduler
   * calling this must not have one source's failure abort the other or
   * crash the cron tick. */
  async runSync(): Promise<WatchlistSyncOutcome[]> {
    // Entries written before `canonicalTokens` existed carry `[]`, which the
    // fuzzy branch of `findMatchCandidates` cannot see (array_length of an
    // empty array is NULL). Rewriting them is idempotent and a no-op once
    // done, so it runs before the fetch rather than depending on one
    // succeeding — a failing source must not leave the cache half-matchable.
    try {
      const filled = await this.entries.backfillCanonicalTokens();
      if (filled > 0) {
        this.logger.log(
          `Backfilled canonicalTokens for ${filled} watchlist entr${filled === 1 ? 'y' : 'ies'} written before the column existed.`,
        );
      }
    } catch (err) {
      // Never abort the sync for this — the exact branches still match, so a
      // failed backfill degrades fuzzy coverage, it does not blind screening.
      this.logger.error(
        `canonicalTokens backfill failed; fuzzy matching stays degraded for pre-existing entries until this succeeds: ${(err as Error).message}`,
      );
    }

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
      // Part B §6 — open a generation. Rows are written against it and are
      // invisible to every screening until it is PUBLISHED, so the validation
      // and write phases below cannot be observed half-done.
      const version = await this.versions.create({ source, syncRunId: run.id });

      // A @code-reviewer BLOCKER on the first pass: a 200 response carrying
      // the wrong content (a WAF/interstitial page, a captcha, a changed
      // redirect target) parses to zero or near-zero records without ever
      // throwing — nothing here distinguishes that from a genuine, drastic
      // list shrink (which OFAC/UN lists don't do in practice). Validate
      // against the PUBLISHED generation's count; a suspicious drop is
      // REJECTED, which leaves the published generation exactly as it was.
      const published = await this.versions.findPublished(source);
      const validation = validateDataset({
        parsedCount: parsed.length,
        publishedCount: published?.recordCount ?? null,
        minAbsoluteRecords: WATCHLIST_MIN_ABSOLUTE_RECORDS,
        minAcceptableRatio: WATCHLIST_MIN_ACCEPTABLE_RATIO,
      });
      if (!validation.ok) {
        await this.versions.markRejected(version.id, validation.reason);
        throw new Error(validation.reason);
      }

      // A @code-reviewer BLOCKER on the first pass: normalizeWatchlistName
      // reduces an all-non-Latin-script name to "" (a plausible fullName at
      // this scale — a degenerate/placeholder source field). Storing such a
      // row would make "" a live lookup key; skip it instead (logged, not
      // silently dropped without a trace).
      const withNormalizedName = parsed.map((record) => ({
        ...record,
        normalizedName: normalizeWatchlistName(record.fullName),
        // Process 49 (fuzzy matching) — computed on the way in so screening
        // never has to canonicalise 19,000 entries at query time. Recomputed
        // on every sync, so improving the transliteration table takes effect
        // for the whole list on the next run rather than needing a backfill.
        canonicalTokens: canonicalNameTokens(record.fullName),
      }));
      const records = withNormalizedName.filter((r) => r.normalizedName !== '');
      const skippedEmpty = withNormalizedName.length - records.length;
      if (skippedEmpty > 0) {
        this.logger.warn(
          `Watchlist sync (${source}): ${skippedEmpty} record(s) normalized to an empty name and were not stored.`,
        );
      }

      // DOWNLOADED: write every row against the new generation. Chunked and
      // non-transactional, exactly as before — and now that is FINE, because
      // nothing can read a generation that is not published.
      await this.entries.upsertMany(source, run.id, records, version.id);

      // VALIDATED: the parse cleared the plausibility floor and the rows are
      // all present.
      await this.versions.markValidated(version.id, records.length);

      // Part B §21 — what this generation adds over the one currently live,
      // compared on the list's own record identity rather than on our row ids.
      // Computed BEFORE the flip, so it describes the change the flip makes.
      const addedCount = await this.versions.countNewAgainstPublished(
        source,
        version.id,
      );

      // PUBLISHED: one transaction, one row flipped. Every screening from this
      // moment reads the new generation; every screening before it read the old
      // one complete.
      await this.versions.publish({ id: version.id, addedCount });

      // Retention, after the flip: keeps the rollback window and reclaims
      // anything older. Never touches the generation just published.
      await this.versions.pruneRetired(source);

      await this.entries.completeSyncRun(run.id, {
        recordCount: records.length,
        addedCount,
      });
      this.logger.log(
        `Watchlist sync (${source}): published generation ${version.version} with ${records.length} record(s), ${addedCount} newly listed.`,
      );
      return {
        source,
        status: 'succeeded',
        recordCount: records.length,
        addedCount,
      };
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

  /** Part B §6 — every generation, newest first. */
  listDatasets() {
    return this.versions.list();
  }

  /**
   * Part B §6 — republish an earlier generation.
   *
   * Refuses three distinct ways, each with its own message, because they are
   * three different operator problems:
   *
   *  * the generation does not exist
   *  * it is not SUPERSEDED (publishing the already-live one is a no-op
   *    dressed as an action; a REJECTED one was refused for a reason)
   *  * its rows were reclaimed by retention, so there is nothing left to
   *    screen against — the case an operator is most likely to hit, and the
   *    one where a silent "success" would be worst
   */
  async rollbackDataset(
    id: string,
    reason: string,
    actorUserId: string,
  ): Promise<WatchlistDatasetVersion> {
    const target = await this.versions.findById(id);
    if (!target) {
      throw new NotFoundException(`Dataset generation ${id} not found`);
    }
    if (target.status !== 'SUPERSEDED') {
      throw new UnprocessableEntityException(
        `Dataset generation ${target.version} is ${target.status}. Only a SUPERSEDED generation can be rolled back to.`,
      );
    }

    const remaining = await this.entries.countByDatasetVersion(target.id);
    if (remaining === 0) {
      throw new UnprocessableEntityException(
        `Dataset generation ${target.version} has no records left — it is past the retention window and cannot be restored. Run a fresh sync instead.`,
      );
    }

    const current = await this.versions.findPublished(target.source);
    const restored = await this.versions.publish({
      id: target.id,
      publishedByUserId: actorUserId,
      rolledBackFromId: current?.id,
      rollbackReason: reason,
    });

    this.logger.warn(
      `Watchlist ROLLBACK (${target.source}): ${current?.version ?? '(none)'} -> ${restored.version} by ${actorUserId}. Screening now runs against the restored generation.`,
    );
    return restored;
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type {
  WatchlistEntry,
  WatchlistSource,
  WatchlistSyncRun,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import type { ParsedWatchlistRecord } from '../modules/compliance-risk/watchlist-sync.config';
import { MIN_ENTRY_TOKENS_FOR_FUZZY } from '../modules/compliance-risk/watchlist-match.config';

export interface WatchlistMatch {
  source: WatchlistSource;
  sourceRecordId: string;
  fullName: string;
  listProgram: string | null;
}

const WATCHLIST_UPSERT_CHUNK_SIZE = 100;

/** Upper bound on candidates returned for one subject name. A real name
 * yields a handful; a pathological one (many very common tokens) must not be
 * able to pull thousands of rows into the review queue in one go. */
const WATCHLIST_CANDIDATE_LIMIT = 50;

/**
 * Process 49 — owns `WatchlistEntry` (the synced sanctions/PEP cache) and
 * `WatchlistSyncRun` (the sync job's own operational log). Wraps
 * `PrismaService` (services depend on repositories in this codebase, never
 * on Prisma directly). Provided directly by both `ComplianceRiskModule`
 * (owns the sync) and `CustomerModule` (`ScreeningService` reads it) —
 * a stateless wrapper around the shared `PrismaService` singleton, so two
 * independent instances still operate on the same rows; simpler than an
 * inter-module export/import for a single narrow read.
 */
@Injectable()
export class WatchlistEntryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The match `ScreeningService` needs: an exact `normalizedName` hit,
   * indexed. Not fuzzy — see `watchlist-sync.config.ts`'s
   * `normalizeWatchlistName`. Refuses an empty `normalizedName` outright — a
   * `@code-reviewer` BLOCKER on the first pass: `normalizeWatchlistName`
   * reduces an all-non-Latin-script name (a plausible `Customer.legalName`
   * for this Jordan-based broker, whose default `languagePreference` is
   * `AR`) to `""`; without this guard, that would become a universal
   * wildcard the moment even one synced entry also normalized to `""`. The
   * caller (`ScreeningService`) already checks this too — belt and
   * suspenders, since this method has no other caller to rely on that. */
  async findByNormalizedName(
    normalizedName: string,
  ): Promise<WatchlistMatch | null> {
    if (!normalizedName) return null;
    const row = await this.prisma.client.watchlistEntry.findFirst({
      where: { normalizedName },
      select: {
        source: true,
        sourceRecordId: true,
        fullName: true,
        listProgram: true,
      },
    });
    return row;
  }

  createSyncRun(source: WatchlistSource): Promise<WatchlistSyncRun> {
    return this.prisma.client.watchlistSyncRun.create({ data: { source } });
  }

  /** The most recent `succeeded` run for `source`, or `null` if none —
   * the plausibility baseline `WatchlistSyncService` checks a fresh parse's
   * record count against before pruning (a `@code-reviewer` BLOCKER: a 200
   * response carrying the wrong content — a WAF page, a captcha, a changed
   * redirect target — parses to near-zero records and, with no check,
   * would `pruneStale` the entire prior cache for that source). */
  findLastSuccessfulRun(
    source: WatchlistSource,
  ): Promise<WatchlistSyncRun | null> {
    return this.prisma.client.watchlistSyncRun.findFirst({
      where: { source, status: 'succeeded' },
      orderBy: { startedAt: 'desc' },
    });
  }

  completeSyncRun(
    id: string,
    result: { recordCount: number } | { errorMessage: string },
  ): Promise<WatchlistSyncRun> {
    return this.prisma.client.watchlistSyncRun.update({
      where: { id },
      data:
        'errorMessage' in result
          ? {
              status: 'failed',
              completedAt: new Date(),
              errorMessage: result.errorMessage,
            }
          : {
              status: 'succeeded',
              completedAt: new Date(),
              recordCount: result.recordCount,
            },
    });
  }

  /** The single latest `WatchlistSyncRun` per source — the status view. */
  async findLatestSyncRuns(): Promise<WatchlistSyncRun[]> {
    const sources: WatchlistSource[] = ['OFAC_SDN', 'UN_CONSOLIDATED'];
    const runs = await Promise.all(
      sources.map((source) =>
        this.prisma.client.watchlistSyncRun.findFirst({
          where: { source },
          orderBy: { startedAt: 'desc' },
        }),
      ),
    );
    return runs.filter((r): r is WatchlistSyncRun => r !== null);
  }

  /** Upserts every parsed record for `source` under this `syncRunId` (the
   * "still on the list" stamp `pruneStale` below reads), then deletes every
   * row of this `source` NOT stamped with `syncRunId` — i.e. every entry
   * that existed before this sync but was not seen in it, because the
   * source list dropped it. Two passes over the DB, not a single
   * transaction: this is a cache refresh from an external, non-transactional
   * source, not a financial or workflow write — a sync that dies partway
   * leaves a mix of old and new rows, which the NEXT sync (or `findLatest
   * SyncRuns` showing a `failed` run) will simply supersede or retry, never
   * a stranded invariant the way `race-safe-invariants.md` guards against
   * for e.g. a `Refund`.
   *
   * Chunked with bounded concurrency (`WATCHLIST_UPSERT_CHUNK_SIZE`
   * upserts in flight at once) — OFAC SDN alone is ~19,000 records; a fully
   * sequential await-per-row loop would take unnecessarily long for a
   * background job with no user waiting on it, but 19,000 fully concurrent
   * connections would be worse. Not a raw-SQL bulk upsert: this stays in
   * Prisma's normal query builder, consistent with every other write in
   * this codebase — a 12-hourly sync job taking well under a minute either
   * way is not a case that calls for hand-rolled SQL. */
  async upsertMany(
    source: WatchlistSource,
    syncRunId: string,
    records: readonly (ParsedWatchlistRecord & {
      normalizedName: string;
      canonicalTokens: string[];
    })[],
  ): Promise<void> {
    for (let i = 0; i < records.length; i += WATCHLIST_UPSERT_CHUNK_SIZE) {
      const chunk = records.slice(i, i + WATCHLIST_UPSERT_CHUNK_SIZE);
      await Promise.all(
        chunk.map((record) =>
          this.prisma.client.watchlistEntry.upsert({
            where: {
              source_sourceRecordId: {
                source,
                sourceRecordId: record.sourceRecordId,
              },
            },
            create: {
              source,
              sourceRecordId: record.sourceRecordId,
              fullName: record.fullName,
              normalizedName: record.normalizedName,
              canonicalTokens: record.canonicalTokens,
              listProgram: record.listProgram,
              remarks: record.remarks,
              syncRunId,
            },
            update: {
              fullName: record.fullName,
              normalizedName: record.normalizedName,
              canonicalTokens: record.canonicalTokens,
              listProgram: record.listProgram,
              remarks: record.remarks,
              syncRunId,
            },
          }),
        ),
      );
    }
  }

  /**
   * Process 49 — every watchlist entry that is a CANDIDATE for one subject
   * name, by three ORed branches. Returns `truncated` when the cap bit.
   *
   * Raw SQL because Prisma cannot express the array-containment operator, and
   * `<@` is what the GIN index on `canonicalTokens` answers — doing this by
   * loading 19,000 entries and filtering in JS would work but would scan the
   * whole table on every screening of every customer.
   *
   * ## The three branches, and why the first two are not optional
   *
   *  1. `normalizedName = <subject's>` — the ORIGINAL exact matcher, kept as
   *     a FLOOR. The first version of this feature deleted it and made
   *     containment the only rule; a `@code-reviewer` pass proved that
   *     regressed the control to CLEAR for every entry below the fuzzy floor
   *     (a real UN entity is listed under the single token "ADF"). Whatever
   *     the pre-change matcher found, this branch still finds. It is a single
   *     indexed equality read, so it costs nothing to keep.
   *  2. `canonicalTokens = <subject's>` — exact match AFTER transliteration
   *     collapsing, which is how a single-token entry ("MOHAMMED") still
   *     reaches a subject recorded in Arabic ("محمد"). Set equality, not
   *     containment, so it cannot over-fire: the subject must be that name and
   *     nothing else. Both sides are stored sorted and de-duplicated, so `=`
   *     is a sound set comparison here.
   *  3. `canonicalTokens <@ <subject's>` with `array_length >= MIN_ENTRY_TOKENS_FOR_FUZZY`
   *     — the fuzzy subset rule. The floor keeps single-token entries out of
   *     SUBSET matching (matching one token against a four-part name is a
   *     substring search over the whole list, not screening); branches 1 and 2
   *     are what keep those entries reachable at all.
   *
   * ## Why the cap reports itself
   *
   * `LIMIT` alone was a silent miss: with no tiebreaker on a non-unique
   * `ORDER BY`, Postgres may return a DIFFERENT 50 rows on each execution, so
   * a queue item could appear on one 4-hourly batch pass and vanish on the
   * next. `"id" ASC` makes the page deterministic, and fetching one row past
   * the cap tells the caller the truth instead of quietly dropping evidence a
   * human was supposed to adjudicate.
   */
  async findMatchCandidates(input: {
    subjectTokens: readonly string[];
    normalizedName: string;
  }): Promise<{ entries: WatchlistEntry[]; truncated: boolean }> {
    const { subjectTokens, normalizedName } = input;
    if (subjectTokens.length === 0 && !normalizedName) {
      return { entries: [], truncated: false };
    }

    // An empty `normalizedName` must never match: `normalizeWatchlistName`
    // reduces an all-non-Latin-script name to `""`, and any synced entry that
    // also normalized to `""` would become a universal wildcard. The same
    // guard `findByNormalizedName` has carried since its own review.
    const exactName = normalizedName || null;

    const rows = await this.prisma.client.$queryRaw<
      WatchlistEntry[]
    >(Prisma.sql`
      SELECT *
      FROM "WatchlistEntry"
      WHERE ("normalizedName" = ${exactName})
         OR ("canonicalTokens" <@ ${subjectTokens}
             AND ("canonicalTokens" @> ${subjectTokens}
                  OR array_length("canonicalTokens", 1) >= ${MIN_ENTRY_TOKENS_FOR_FUZZY}))
      ORDER BY array_length("canonicalTokens", 1) DESC, "id" ASC
      LIMIT ${WATCHLIST_CANDIDATE_LIMIT + 1}
    `);

    const truncated = rows.length > WATCHLIST_CANDIDATE_LIMIT;
    return {
      entries: truncated ? rows.slice(0, WATCHLIST_CANDIDATE_LIMIT) : rows,
      truncated,
    };
  }

  pruneStale(
    source: WatchlistSource,
    syncRunId: string,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.watchlistEntry.deleteMany({
      where: { source, syncRunId: { not: syncRunId } },
    });
  }

  countBySource(source: WatchlistSource): Promise<number> {
    return this.prisma.client.watchlistEntry.count({ where: { source } });
  }
}

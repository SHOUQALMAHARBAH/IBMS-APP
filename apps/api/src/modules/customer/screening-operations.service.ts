import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MATCHING_ALGORITHM_VERSION } from '../compliance-risk/watchlist-match.config';
import { loadHoldPolicy } from './screening-hold.config';
import {
  SANCTIONS_RESCREEN_CRON,
  WATCHLIST_SYNC_CRON,
} from '../compliance-risk/watchlist-sync.config';
import { nextCronRun } from './screening-schedule.util';

/**
 * Part B §18/§28/§33 — what an operator needs to see to know whether screening
 * is actually working.
 *
 * ## Why counts and not just a green light
 *
 * A provider health check answers "can I reach it right now?". It cannot
 * answer the question that actually matters: "how many of our customers were
 * screened for real?" A deployment can pass every health check and still have
 * a third of its attempts coming back SCREENING_FAILED — each one correctly
 * refusing to say NO_MATCH, each one silently held for review, and nobody
 * looking at the aggregate.
 *
 * These are counts over the recorded `ScreeningRequest` rows, which is the
 * only honest source: it is what actually happened, not what the configuration
 * says should happen.
 *
 * Nothing here carries subject PII. Counts, outcomes, versions and timestamps
 * only — this view is read by operators who may not hold
 * `isSensitiveDataAccess` (sensitive-data-handling.md).
 */
@Injectable()
export class ScreeningOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param windowDays how far back the counts reach. Bounded by the caller's
   * DTO; a very wide window is a table scan on a growing table.
   */
  async overview(windowDays = 30) {
    const since = new Date(Date.now() - windowDays * 86_400_000);

    const [
      byOutcome,
      byProvider,
      unresolvedRecent,
      syncRuns,
      pendingMatches,
      holdsReleased,
      matchProvenance,
      caseWorkload,
      datasets,
      heldFiles,
      decidableFiles,
    ] = await Promise.all([
      this.prisma.client.screeningRequest.groupBy({
        by: ['outcome'],
        where: { startedAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.client.screeningRequest.groupBy({
        by: ['provider'],
        where: { startedAt: { gte: since } },
        _count: { _all: true },
      }),
      // The most recent unresolved attempts, so an operator can see WHAT is
      // failing rather than only how often. `failureReason` never contains
      // credentials or subject PII by construction — adapters pass an error
      // message, never a request body or a header.
      this.prisma.client.screeningRequest.findMany({
        where: {
          startedAt: { gte: since },
          outcome: {
            in: ['NOT_CONFIGURED', 'SCREENING_FAILED', 'UNABLE_TO_SCREEN'],
          },
        },
        orderBy: { startedAt: 'desc' },
        take: 10,
        select: {
          correlationId: true,
          outcome: true,
          failureReason: true,
          providerName: true,
          startedAt: true,
          durationMs: true,
        },
      }),
      this.prisma.client.watchlistSyncRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: 6,
        select: {
          source: true,
          status: true,
          recordCount: true,
          addedCount: true,
          startedAt: true,
          completedAt: true,
          errorMessage: true,
        },
      }),
      this.prisma.client.screeningMatch.count({
        where: { status: 'pending' },
      }),
      this.prisma.client.screeningHoldRelease.count({
        where: { releasedAt: { gte: since } },
      }),
      // Which matcher versions the OPEN queue was raised by. A queue holding
      // items from two different matcher versions is a queue where two items
      // with the same score do not mean the same thing.
      this.prisma.client.screeningMatch.groupBy({
        by: ['algorithmVersion'],
        where: { status: 'pending' },
        _count: { _all: true },
      }),
      // Part B §16 — open case work, by workflow state. A queue where
      // everything is OPEN and nothing is UNDER_REVIEW is a queue nobody is
      // working, which no count of "pending" alone would reveal.
      this.prisma.client.screeningMatch.groupBy({
        by: ['caseStatus'],
        where: { status: 'pending' },
        _count: { _all: true },
      }),
      // Part B §6 — the generations, so an operator can see which list is live.
      this.prisma.client.watchlistDatasetVersion.findMany({
        orderBy: { downloadedAt: 'desc' },
        take: 8,
        select: {
          id: true,
          source: true,
          status: true,
          version: true,
          recordCount: true,
          addedCount: true,
          downloadedAt: true,
          publishedAt: true,
          rejectionReason: true,
          rollbackReason: true,
        },
      }),
      // Part B §17 — files sitting in a decidable state that a hold is
      // currently stopping. Counted from the same signals the hold evaluator
      // reads, rather than by evaluating every file (which would be one query
      // per KYC record on a dashboard read).
      this.prisma.client.kYCRecord.count({
        where: {
          status: { in: ['SCREENING', 'EDD'] },
          OR: [
            {
              screeningResults: {
                some: {
                  attemptOutcome: {
                    in: [
                      'NOT_CONFIGURED',
                      'SCREENING_FAILED',
                      'UNABLE_TO_SCREEN',
                    ],
                  },
                },
              },
            },
            { screeningMatches: { some: { status: 'pending' } } },
            { screeningMatches: { some: { status: 'confirmed' } } },
          ],
        },
      }),
      this.prisma.client.kYCRecord.count({
        where: { status: { in: ['SCREENING', 'EDD'] } },
      }),
    ]);

    const total = byOutcome.reduce((sum, row) => sum + row._count._all, 0);
    const unresolvedCount = byOutcome
      .filter((row) =>
        ['NOT_CONFIGURED', 'SCREENING_FAILED', 'UNABLE_TO_SCREEN'].includes(
          row.outcome,
        ),
      )
      .reduce((sum, row) => sum + row._count._all, 0);

    const policy = loadHoldPolicy();

    return {
      windowDays,
      since: since.toISOString(),
      attempts: {
        total,
        byOutcome: Object.fromEntries(
          byOutcome.map((row) => [row.outcome, row._count._all]),
        ),
        byProvider: Object.fromEntries(
          byProvider.map((row) => [row.provider, row._count._all]),
        ),
        /**
         * The number that matters most, stated as a number rather than left
         * for somebody to compute: the share of attempts that did NOT produce
         * a usable answer. A deployment where this is not near zero is one
         * where screening is not working, however green the health check is.
         */
        unresolved: unresolvedCount,
        unresolvedRate: total === 0 ? 0 : unresolvedCount / total,
        recentUnresolved: unresolvedRecent.map((row) => ({
          ...row,
          startedAt: row.startedAt.toISOString(),
        })),
      },
      matchQueue: {
        pending: pendingMatches,
        /** Matcher versions represented in the OPEN queue. More than one means
         * two items with the same score were judged by different rules. */
        pendingByAlgorithmVersion: Object.fromEntries(
          matchProvenance.map((row) => [
            row.algorithmVersion ?? 'unrecorded',
            row._count._all,
          ]),
        ),
        currentAlgorithmVersion: MATCHING_ALGORITHM_VERSION,
      },
      caseWorkload: Object.fromEntries(
        caseWorkload.map((row) => [row.caseStatus, row._count._all]),
      ),
      datasets: datasets.map((d) => ({
        ...d,
        downloadedAt: d.downloadedAt.toISOString(),
        publishedAt: d.publishedAt?.toISOString() ?? null,
      })),
      /**
       * Part B §19 — when the recurring work last ran and when it runs next,
       * computed from the same cron expressions the schedulers are registered
       * with rather than restated. A dashboard that says "every 4 hours" while
       * the scheduler says something else is worse than saying nothing.
       */
      schedules: {
        rescreenBatch: {
          cron: SANCTIONS_RESCREEN_CRON,
          nextRunAt: nextCronRun(SANCTIONS_RESCREEN_CRON),
        },
        listSync: {
          cron: WATCHLIST_SYNC_CRON,
          nextRunAt: nextCronRun(WATCHLIST_SYNC_CRON),
          lastSuccessAt:
            syncRuns
              .find((r) => r.status === 'succeeded' && r.completedAt)
              ?.completedAt?.toISOString() ?? null,
        },
      },
      holds: {
        /** Files in a decidable state that a hold is currently stopping. */
        activeHolds: heldFiles,
        decidableFiles,
        releasedInWindow: holdsReleased,
        policy: policy.levels,
        staleAfterDays: policy.staleAfterDays,
        configurationProblems: policy.invalid,
      },
      listSync: syncRuns.map((run) => ({
        ...run,
        startedAt: run.startedAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
      })),
    };
  }
}

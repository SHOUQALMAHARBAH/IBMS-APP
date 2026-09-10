import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MATCHING_ALGORITHM_VERSION } from '../compliance-risk/watchlist-match.config';
import { loadHoldPolicy } from './screening-hold.config';

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
      holds: {
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

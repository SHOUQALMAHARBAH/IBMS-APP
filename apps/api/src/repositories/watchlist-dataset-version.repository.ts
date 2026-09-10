import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { WatchlistDatasetVersion, WatchlistSource } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import {
  DATASET_RETENTION_COUNT,
  canTransition,
  datasetVersionLabel,
} from '../modules/compliance-risk/watchlist-dataset.config';

/**
 * Part B §6/§7 — the list-generation lifecycle, in one place.
 *
 * The single property everything here protects: a screening reads the
 * PUBLISHED generation and only the PUBLISHED generation. Rows are written
 * against a generation nobody can see, and become visible in one transaction
 * that flips one row.
 */
@Injectable()
export class WatchlistDatasetVersionRepository {
  private readonly logger = new Logger(WatchlistDatasetVersionRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Open a new generation. Invisible to readers from the moment it exists. */
  create(input: {
    source: WatchlistSource;
    syncRunId: string;
    checksum?: string;
  }): Promise<WatchlistDatasetVersion> {
    const downloadedAt = new Date();
    return this.prisma.client.watchlistDatasetVersion.create({
      data: {
        source: input.source,
        status: 'DOWNLOADED',
        version: datasetVersionLabel(input.source, downloadedAt),
        downloadedAt,
        syncRunId: input.syncRunId,
        checksum: input.checksum,
      },
    });
  }

  findById(id: string): Promise<WatchlistDatasetVersion | null> {
    return this.prisma.client.watchlistDatasetVersion.findUnique({
      where: { id },
    });
  }

  findPublished(
    source: WatchlistSource,
  ): Promise<WatchlistDatasetVersion | null> {
    return this.prisma.client.watchlistDatasetVersion.findFirst({
      where: { source, status: 'PUBLISHED' },
    });
  }

  /** Every generation for the operations view, newest first. */
  list(limit = 20): Promise<WatchlistDatasetVersion[]> {
    return this.prisma.client.watchlistDatasetVersion.findMany({
      orderBy: { downloadedAt: 'desc' },
      take: limit,
    });
  }

  /** Generations a rollback could target: SUPERSEDED, and still holding rows. */
  async findRollbackCandidates(
    source: WatchlistSource,
  ): Promise<WatchlistDatasetVersion[]> {
    const rows = await this.prisma.client.watchlistDatasetVersion.findMany({
      where: { source, status: 'SUPERSEDED' },
      orderBy: { publishedAt: 'desc' },
      include: { _count: { select: { entries: true } } },
    });
    // A generation whose rows were reclaimed cannot be rolled back to, however
    // healthy its metadata looks. Filtering here rather than letting an
    // operator pick one and get an empty list.
    return rows.filter((row) => row._count.entries > 0);
  }

  /** DOWNLOADED -> VALIDATED. */
  async markValidated(
    id: string,
    recordCount: number,
  ): Promise<WatchlistDatasetVersion | null> {
    return this.transition(id, 'VALIDATED', {
      validatedAt: new Date(),
      recordCount,
    });
  }

  /** DOWNLOADED|VALIDATED -> REJECTED. Terminal; the row is kept as the record
   * that this generation was refused, and why. */
  async markRejected(
    id: string,
    reason: string,
  ): Promise<WatchlistDatasetVersion | null> {
    return this.transition(id, 'REJECTED', {
      rejectedAt: new Date(),
      rejectionReason: reason,
    });
  }

  /**
   * THE ATOMIC FLIP.
   *
   * Supersede the currently published generation and publish this one, in one
   * transaction. A reader either sees the old generation (before commit) or the
   * new one (after) — there is no instant at which both or neither is
   * published, because `WatchlistDatasetVersion_one_published_per_source` makes
   * "both" unrepresentable and the transaction makes "neither" unobservable.
   *
   * ## Why NOT Serializable
   *
   * This ran at Serializable first, on the reasoning that two concurrent
   * publishes of the same source should conflict cleanly rather than through a
   * constraint error. That was wrong, and a real end-to-end sync proved it: the
   * two sources sync CONCURRENTLY, and their publish transactions each take a
   * predicate lock on the same `(source, status)` index while reading "is
   * anything published?". Postgres reported a write conflict and the whole
   * OFAC sync failed — a self-inflicted outage in the normal path, to defend
   * against a case that cannot actually corrupt anything.
   *
   * It cannot corrupt anything because the guarantee does not live here. It
   * lives in `WatchlistDatasetVersion_one_published_per_source`, a partial
   * unique index: two generations of one source being published at once is
   * unrepresentable, whatever any transaction believes it read. If two
   * publishes of the same source do race, one commits and the other fails
   * outright — and its supersede rolls back with it, so the source is never
   * left with no published generation.
   *
   * The transaction is still essential; it is what makes supersede-and-publish
   * one step. Only the isolation level was wrong.
   */
  async publish(input: {
    id: string;
    publishedByUserId?: string;
    rolledBackFromId?: string;
    rollbackReason?: string;
    addedCount?: number;
  }): Promise<WatchlistDatasetVersion> {
    return this.prisma.client.$transaction(async (tx) => {
      const version = await tx.watchlistDatasetVersion.findUniqueOrThrow({
        where: { id: input.id },
      });
      if (!canTransition(version.status, 'PUBLISHED')) {
        throw new Error(
          `Dataset generation ${version.version} is ${version.status} and cannot be published. Only a VALIDATED generation, or a SUPERSEDED one being rolled back to, may be published.`,
        );
      }

      const current = await tx.watchlistDatasetVersion.findFirst({
        where: { source: version.source, status: 'PUBLISHED' },
      });
      if (current && current.id !== version.id) {
        await tx.watchlistDatasetVersion.update({
          where: { id: current.id },
          data: { status: 'SUPERSEDED', supersededAt: new Date() },
        });
      }

      return tx.watchlistDatasetVersion.update({
        where: { id: version.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          supersededAt: null,
          publishedByUserId: input.publishedByUserId,
          rolledBackFromId: input.rolledBackFromId,
          rollbackReason: input.rollbackReason,
          ...(input.addedCount !== undefined
            ? { addedCount: input.addedCount }
            : {}),
        },
      });
    });
  }

  /**
   * How many entries in this generation are not in the published one.
   *
   * Compared on `(source, sourceRecordId)`, which is the list's own identity
   * for a record — not on our row id, which differs per generation by
   * construction.
   */
  async countNewAgainstPublished(
    source: WatchlistSource,
    candidateId: string,
  ): Promise<number> {
    const rows = await this.prisma.client.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`
        SELECT count(*)::bigint AS count
        FROM "WatchlistEntry" candidate
        WHERE candidate."datasetVersionId" = ${candidateId}
          AND NOT EXISTS (
            SELECT 1
            FROM "WatchlistEntry" live
            JOIN "WatchlistDatasetVersion" v
              ON v."id" = live."datasetVersionId" AND v."status" = 'PUBLISHED'
            WHERE live."source" = ${source}::"WatchlistSource"
              AND live."sourceRecordId" = candidate."sourceRecordId"
          )
      `,
    );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Reclaim old generations' rows.
   *
   * Keeps the published one plus `DATASET_RETENTION_COUNT` superseded ones — a
   * generation with no rows cannot be rolled back to, so retention IS the
   * rollback window. Rejected generations keep their metadata row (that is the
   * audit trail) but hold no rows worth keeping, so they are pruned by the same
   * pass.
   *
   * Deleting the generation cascades to its entries, which is the whole reason
   * the FK is `onDelete: Cascade`.
   */
  async pruneRetired(source: WatchlistSource): Promise<number> {
    const superseded =
      await this.prisma.client.watchlistDatasetVersion.findMany({
        where: { source, status: 'SUPERSEDED' },
        orderBy: { publishedAt: 'desc' },
        select: { id: true },
      });
    const doomed = superseded.slice(DATASET_RETENTION_COUNT).map((v) => v.id);

    const rejected = await this.prisma.client.watchlistDatasetVersion.findMany({
      where: { source, status: 'REJECTED' },
      select: { id: true },
    });

    if (rejected.length > 0) {
      // Metadata stays; only the rows go.
      await this.prisma.client.watchlistEntry.deleteMany({
        where: { datasetVersionId: { in: rejected.map((v) => v.id) } },
      });
    }
    if (doomed.length === 0) return 0;

    const { count } =
      await this.prisma.client.watchlistDatasetVersion.deleteMany({
        where: { id: { in: doomed } },
      });
    this.logger.log(
      `Watchlist retention (${source}): removed ${count} retired generation(s) beyond the ${DATASET_RETENTION_COUNT} kept for rollback.`,
    );
    return count;
  }

  /** Guarded status change: refuses a transition the lifecycle does not allow,
   * and reports a lost race as `null` rather than overwriting. */
  private async transition(
    id: string,
    to: 'VALIDATED' | 'REJECTED',
    data: Prisma.WatchlistDatasetVersionUpdateInput,
  ): Promise<WatchlistDatasetVersion | null> {
    const current = await this.prisma.client.watchlistDatasetVersion.findUnique(
      { where: { id } },
    );
    if (!current) return null;
    if (!canTransition(current.status, to)) {
      throw new Error(
        `Dataset generation ${current.version}: ${current.status} -> ${to} is not a permitted transition.`,
      );
    }
    // Status-conditional, so a concurrent transition loses cleanly instead of
    // silently overwriting (race-safe-invariants.md).
    const { count } =
      await this.prisma.client.watchlistDatasetVersion.updateMany({
        where: { id, status: current.status },
        data: {
          status: to,
          ...(data as Prisma.WatchlistDatasetVersionUpdateManyMutationInput),
        },
      });
    if (count === 0) return null;
    return this.findById(id);
  }
}

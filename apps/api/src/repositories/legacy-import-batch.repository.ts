import { Injectable } from '@nestjs/common';
import type { LegacyImportIssueKind } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The durable report of a legacy import run.
 *
 * Created 2026-10-02 together with migration `20261108100000`. **There was no such model before** — I
 * had described one as already existing, which was wrong, and the migration's header says so. The
 * report used to be the HTTP response body plus an audit row carrying counts, so an office importing
 * 2,000 rows could read its forty refusals once and never come back to them.
 */
@Injectable()
export class LegacyImportBatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One batch and all its issues, in ONE transaction.
   *
   * A batch whose issues failed to write is worse than no batch at all: it would report counts a reader
   * cannot reconcile against a list — "40 refused" above an empty table, which reads as a display fault
   * rather than as a missing write. The nested create makes that unrepresentable.
   */
  create(input: {
    actorUserId: string;
    fileName: string;
    totalDataRows: number;
    imported: number;
    refused: number;
    screened: number;
    needsReview: number;
    issues: {
      lineNumber: number;
      kind: LegacyImportIssueKind;
      detail: string;
      collidedWithCustomerId?: string;
    }[];
  }): Promise<{ id: string }> {
    const { issues, ...batch } = input;
    return this.prisma.client.legacyImportBatch.create({
      data: {
        ...batch,
        issues: {
          create: issues.map((i) => ({
            lineNumber: i.lineNumber,
            kind: i.kind,
            detail: i.detail,
            collidedWithCustomerId: i.collidedWithCustomerId,
          })),
        },
      },
      select: { id: true },
    });
  }

  /** The office's import history, newest first. Counts only — the issues are read per batch. */
  listRecent(take: number) {
    return this.prisma.client.legacyImportBatch.findMany({
      orderBy: { startedAt: 'desc' },
      take,
    });
  }

  /**
   * One batch with its issues, ORDERED BY KIND then line.
   *
   * By kind first because that is how the report is read: an officer resolving duplicates is doing a
   * different job from one fixing typos, and interleaving them by line number makes the screen a
   * mixed list that has to be re-sorted before either job can start.
   */
  findWithIssues(id: string) {
    return this.prisma.client.legacyImportBatch.findUnique({
      where: { id },
      include: {
        issues: { orderBy: [{ kind: 'asc' }, { lineNumber: 'asc' }] },
      },
    });
  }
}

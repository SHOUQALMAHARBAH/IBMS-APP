import { Injectable } from '@nestjs/common';
import type {
  CertificateOfDestruction,
  DisposalBatch,
  DisposalBatchStatus,
  Prisma,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateDisposalBatchInput {
  retentionScheduleItemId: string | null;
  nominatedByUserId: string;
}

export interface DisposalBatchFilter {
  retentionScheduleItemId?: string;
  status?: DisposalBatchStatus;
}

export interface CreateCertificateInput {
  disposalBatchId: string;
  issuedByUserId: string;
}

/** M06 — owns `DisposalBatch`/`CertificateOfDestruction` reads and the two
 * writes that are NOT a `status` transition (`create`/certificate issuance
 * — `WorkflowTransitionService` owns every `status` move,
 * `ibms-brain/meta/lex/workflow-state-transitions.md`). */
/**
 * The combined-duty act, on every read and write that returns a batch.
 *
 * `DisposalBatch_maker_checker_distinct` requires that whoever NOMINATES records for destruction is not
 * whoever approves it (`nominatedByUserId` / `dpoApprovedByUserId`, checker permission
 * `retention.dispose.approve`). This is the pair that authorises **irreversible destruction of personal
 * data** — there is no undo behind it, and a certificate of destruction is issued afterwards.
 *
 * Part 4 step 5: on the record, not only in the report at `/internal-controls`.
 */
const DISPOSAL_INCLUDE = { combinedDutyAct: true } as const;

export type DisposalBatchWithAct = Prisma.DisposalBatchGetPayload<{
  include: typeof DISPOSAL_INCLUDE;
}>;

@Injectable()
export class DisposalBatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  retentionScheduleItemExists(id: string): Promise<boolean> {
    return this.prisma.client.retentionScheduleItem
      .count({ where: { id } })
      .then((n) => n > 0);
  }

  /** The category and whether a lawyer has confirmed its period — both, in one read, because
   *  the refusal message names the category and a second query to get the name would be a
   *  round trip for a string we already had. */
  findRetentionScheduleItemForNomination(id: string): Promise<{
    recordCategory: string;
    confirmedByLegalCounselAt: Date | null;
  } | null> {
    return this.prisma.client.retentionScheduleItem.findUnique({
      where: { id },
      select: { recordCategory: true, confirmedByLegalCounselAt: true },
    });
  }

  create(input: CreateDisposalBatchInput): Promise<DisposalBatchWithAct> {
    // The include on the write too, so one shape serves every path out of this repository. A newly
    // nominated batch has no act; what this buys is that the row type needs no optional field.
    return this.prisma.client.disposalBatch.create({
      data: input,
      include: DISPOSAL_INCLUDE,
    });
  }

  findById(id: string): Promise<DisposalBatchWithAct | null> {
    return this.prisma.client.disposalBatch.findUnique({
      where: { id },
      include: DISPOSAL_INCLUDE,
    });
  }

  findMany(filter: DisposalBatchFilter): Promise<DisposalBatchWithAct[]> {
    return this.prisma.client.disposalBatch.findMany({
      include: DISPOSAL_INCLUDE,
      where: {
        retentionScheduleItemId: filter.retentionScheduleItemId,
        status: filter.status,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findCertificateByBatchId(
    disposalBatchId: string,
  ): Promise<CertificateOfDestruction | null> {
    return this.prisma.client.certificateOfDestruction.findUnique({
      where: { disposalBatchId },
    });
  }

  /** The `disposalBatchId @unique` constraint is the real backstop against
   * a double-issue — a second call for the same batch surfaces as an
   * ordinary `P2002`, the same shape `RetentionScheduleService.create`
   * relies on for a duplicate `recordCategory`. */
  createCertificate(
    input: CreateCertificateInput,
  ): Promise<CertificateOfDestruction> {
    return this.prisma.client.certificateOfDestruction.create({
      data: input,
    });
  }
}

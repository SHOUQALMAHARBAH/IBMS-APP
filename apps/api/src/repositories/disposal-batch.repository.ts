import { Injectable } from '@nestjs/common';
import type {
  CertificateOfDestruction,
  DisposalBatch,
  DisposalBatchStatus,
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
@Injectable()
export class DisposalBatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  retentionScheduleItemExists(id: string): Promise<boolean> {
    return this.prisma.client.retentionScheduleItem
      .count({ where: { id } })
      .then((n) => n > 0);
  }

  create(input: CreateDisposalBatchInput): Promise<DisposalBatch> {
    return this.prisma.client.disposalBatch.create({ data: input });
  }

  findById(id: string): Promise<DisposalBatch | null> {
    return this.prisma.client.disposalBatch.findUnique({ where: { id } });
  }

  findMany(filter: DisposalBatchFilter): Promise<DisposalBatch[]> {
    return this.prisma.client.disposalBatch.findMany({
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

import { Injectable } from '@nestjs/common';
import type { DpiaScreening, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateDpiaScreeningInput {
  subjectDescription: string;
  qSensitiveData: boolean;
  qLargeScaleProcessing: boolean;
  qCrossBorderTransfer: boolean;
  qNewTechnologyMonitoring: boolean;
  qNewDigitalChannel: boolean;
  outcome: 'AUTO_APPROVED' | 'DPO_REVIEW_REQUIRED';
  dpoReviewDueAt: Date | null;
}

export interface DpiaScreeningScope {
  outcome?: string;
}

/** M10 — owns `DpiaScreening`. `recordReview`/`recordSpotCheck`/
 * `escalateToFullDpia` are all status-conditional `updateMany` calls — see
 * `dpia-screening.config.ts`'s header comment for why `outcome` isn't
 * routed through `WorkflowTransitionService`. */
@Injectable()
export class DpiaScreeningRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateDpiaScreeningInput): Promise<DpiaScreening> {
    return this.prisma.client.dpiaScreening.create({ data: input });
  }

  findById(id: string): Promise<DpiaScreening | null> {
    return this.prisma.client.dpiaScreening.findUnique({ where: { id } });
  }

  findMany(scope: DpiaScreeningScope, take: number): Promise<DpiaScreening[]> {
    return this.prisma.client.dpiaScreening.findMany({
      where: {
        ...(scope.outcome ? { outcome: scope.outcome as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** Only from DPO_REVIEW_REQUIRED, only once, only if not escalated. */
  recordReview(id: string, dpoReviewedAt: Date): Promise<Prisma.BatchPayload> {
    return this.prisma.client.dpiaScreening.updateMany({
      where: {
        id,
        outcome: 'DPO_REVIEW_REQUIRED',
        dpoReviewedAt: null,
        escalatedToFullDpiaAt: null,
      },
      data: { dpoReviewedAt },
    });
  }

  /** Only on an AUTO_APPROVED result, only once. */
  recordSpotCheck(
    id: string,
    dpoSpotCheckedAt: Date,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.dpiaScreening.updateMany({
      where: { id, outcome: 'AUTO_APPROVED', dpoSpotCheckedAt: null },
      data: { dpoSpotCheckedAt },
    });
  }

  /** Only from DPO_REVIEW_REQUIRED, only once, only if not already
   * reviewed — mutually exclusive with recordReview(). */
  escalateToFullDpia(
    id: string,
    escalatedToFullDpiaAt: Date,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.dpiaScreening.updateMany({
      where: {
        id,
        outcome: 'DPO_REVIEW_REQUIRED',
        dpoReviewedAt: null,
        escalatedToFullDpiaAt: null,
      },
      data: {
        outcome: 'ESCALATED_FULL_DPIA',
        escalatedToFullDpiaAt,
      },
    });
  }
}

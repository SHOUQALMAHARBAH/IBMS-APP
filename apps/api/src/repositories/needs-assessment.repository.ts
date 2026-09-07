import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type NeedsAssessment,
  type NeedsAssessmentStatus,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateNeedsAssessmentInput {
  riskProfileId: string;
  questionnaireAnswers: Prisma.InputJsonValue;
  recommendedCoverageLines: string[];
  createdByUserId: string;
}

export interface NeedsAssessmentFilter {
  riskProfileId?: string;
  status?: NeedsAssessmentStatus;
  createdByUserId?: string;
}

/** Process 5 — Needs Assessment. Same "one repository per aggregate root"
 * shape as lead/prospect/customer. `status` is never written here — it moves
 * only through WorkflowTransitionService (A.6); see
 * needs-assessment.service.ts. */
@Injectable()
export class NeedsAssessmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateNeedsAssessmentInput): Promise<NeedsAssessment> {
    return this.prisma.client.needsAssessment.create({ data: input });
  }

  findById(id: string): Promise<NeedsAssessment | null> {
    return this.prisma.client.needsAssessment.findUnique({ where: { id } });
  }

  findMany(filter: NeedsAssessmentFilter): Promise<NeedsAssessment[]> {
    return this.prisma.client.needsAssessment.findMany({
      where: {
        riskProfileId: filter.riskProfileId,
        status: filter.status,
        createdByUserId: filter.createdByUserId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Re-saves the questionnaire and its derived coverage list while the
   * assessment is still in DRAFT (guarded by the service). Never touches
   * `status`. */
  updateQuestionnaire(
    id: string,
    data: {
      questionnaireAnswers: Prisma.InputJsonValue;
      recommendedCoverageLines: string[];
    },
  ): Promise<NeedsAssessment> {
    return this.prisma.client.needsAssessment.update({ where: { id }, data });
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma, type NeedsAssessmentStatus } from '@ibms/db';
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
/**
 * BOTH combined-duty acts, on every read and write that returns an assessment.
 *
 * `NeedsAssessment` is the only table in the sixteen carrying TWO pairs, and therefore two escape columns:
 * `NeedsAssessment_reviewer_maker_checker_distinct` (the capturer is not the reviewer) and
 * `NeedsAssessment_approver_maker_checker_distinct` (the capturer is not the approver). One shared column
 * would let a declared combined REVIEW excuse a self-APPROVAL, which is the reason there are fifteen
 * columns and not fourteen — so the record must show them SEPARATELY too.
 *
 * Part 4 step 5: on the record, not only in the report at `/internal-controls`.
 */
const NEEDS_ASSESSMENT_INCLUDE = {
  reviewerCombinedDutyAct: true,
  approverCombinedDutyAct: true,
} as const;

export type NeedsAssessmentWithActs = Prisma.NeedsAssessmentGetPayload<{
  include: typeof NEEDS_ASSESSMENT_INCLUDE;
}>;

/**
 * WHO REVIEWED AND WHO APPROVED, BY NAME — decision 48.
 *
 * The owner read two uuids under «راجعه» and «اعتمده» on `/needs-assessments/[id]`,
 * and `rendered-identifiers.py` reported that screen CLEAN: its ternary exclusion
 * `\?[^.]` was written to let optional chaining through and let NULLISH COALESCING
 * through with it, so the one shape the budget exists to count was the one shape it
 * could not see.
 *
 * BOTH FIELDS ARE REQUIRED, not optional, and that is the whole reason this type
 * exists rather than a widened inline return: ten call sites return this shape and an
 * optional field would leave any one of them projecting `undefined` while the others
 * carried a name — a name after a REVIEW and none after a CREATE, which is the
 * `IncidentReport.load()` defect and is invisible to a test that only reads.
 *
 * A MISSING key means NO NAME and must never become the uuid.
 */
export interface NeedsAssessmentActorNames {
  reviewedByName: string | null;
  approvedByName: string | null;
}

export type NeedsAssessmentWithNames = NeedsAssessmentWithActs &
  NeedsAssessmentActorNames;

@Injectable()
export class NeedsAssessmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateNeedsAssessmentInput): Promise<NeedsAssessmentWithActs> {
    return this.prisma.client.needsAssessment.create({
      include: NEEDS_ASSESSMENT_INCLUDE,
      data: input,
    });
  }

  findById(id: string): Promise<NeedsAssessmentWithActs | null> {
    return this.prisma.client.needsAssessment.findUnique({
      include: NEEDS_ASSESSMENT_INCLUDE,
      where: { id },
    });
  }

  findMany(filter: NeedsAssessmentFilter): Promise<NeedsAssessmentWithActs[]> {
    return this.prisma.client.needsAssessment.findMany({
      include: NEEDS_ASSESSMENT_INCLUDE,
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
  ): Promise<NeedsAssessmentWithActs> {
    return this.prisma.client.needsAssessment.update({
      include: NEEDS_ASSESSMENT_INCLUDE,
      where: { id },
      data,
    });
  }
}

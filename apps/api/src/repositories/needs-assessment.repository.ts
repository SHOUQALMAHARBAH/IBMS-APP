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
  /*
   * §W4 — WHICH CUSTOMER THIS ASSESSMENT IS FOR.
   *
   * The owner's demo-path walk found `/needs-assessments` rendering a list of cards with
   * nothing to tell them apart. The policy list solved the identical problem and its comment is
   * the precedent — IDENTITY ONLY, two columns rather than the `Customer` row, because a list
   * read must not become a route into a customer's wider file.
   *
   * ⚠️ THROUGH THE RISK PROFILE, because `NeedsAssessment` HAS NO CUSTOMER COLUMN — it reaches
   * one only via `RiskProfile.customerId`. A first attempt wrote `customer:` directly here and
   * **tsc accepted it**: the include is `as const` and `GetPayload` degraded silently rather
   * than refusing an unknown field, so the error surfaced only at runtime as a
   * `PrismaClientValidationError` across five e2e tests.
   *
   * 🔴 AND IT UNCOVERED A SECOND DEFECT OF THE SAME CLASS AS §W3's. The web's
   * `NeedsAssessment` type declares `customerId: string`, and only the DETAIL route ever sent
   * one — `get()` resolves it off the risk profile by hand, and `list()` did not. So every list
   * item carried `customerId: undefined` behind a type that promised a string. Including it
   * here answers both: the list now sends what its own type has always claimed.
   */
  riskProfile: {
    select: {
      customerId: true,
      customer: { select: { id: true, legalName: true } },
    },
  },
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

/**
 * The assessment AS IT LEAVES THE SERVICE — the risk-profile join replaced by two flat fields.
 *
 * §W4: `NeedsAssessment` reaches a customer only through `RiskProfile`, so the repository joins
 * it. Leaving that join on the wire would be the raw-join-as-payload shape that left the RFQ's
 * insurer column blank, so `withNames` strips it and this type says so.
 */
export type NeedsAssessmentWithNames = Omit<
  NeedsAssessmentWithActs,
  'riskProfile'
> &
  NeedsAssessmentActorNames & {
    /** Resolved off the parent risk profile. Null only if the join was not selected. */
    customerId: string | null;
    /** Identity only — never the `Customer` row. The policy list's precedent. */
    customer: { id: string; legalName: string } | null;
  };

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

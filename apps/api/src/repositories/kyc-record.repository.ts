import { Injectable } from '@nestjs/common';
import type {
  ScreeningAttemptOutcome,
  ScreeningProviderKind,
  CustomerType,
  KYCRecord,
  KycStatus,
  Prisma,
  RiskLevel,
  RiskRating,
  ScreeningOutcome,
  ScreeningResult,
  ScreeningType,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/** findMany()'s row shape — enriched with just enough of the parent
 * Customer to render a queue row (legalName/customerType are not
 * sensitive; see ENCRYPTED_FIELDS in security/encrypted-fields.ts for what
 * IS) without the frontend making one extra GET /customers/:id per row. */
export interface KycRecordWithCustomer extends KYCRecord {
  customer: { legalName: string; customerType: CustomerType };
}

export interface CreateKycRecordInput {
  customerId: string;
  createdByUserId: string;
}

export interface KycRecordFilter {
  status?: KycStatus;
  customerId?: string;
  /** Scopes to KYCRecords whose Customer.ownerUserId matches — the Sales
   * Officer's-own-book slice of the Compliance queue (see kyc.service.ts's
   * list()), via the `customer` relation rather than a denormalized column
   * on KYCRecord itself. */
  customerOwnerUserId?: string;
}

export interface CreateScreeningResultInput {
  kycRecordId: string;
  screeningType: ScreeningType;
  result: ScreeningOutcome;
  listSource?: string;
  escalatedToComplianceAt?: Date;
  /** The attempt that produced this result — which provider, which dataset,
   * and the five-value outcome behind the three-value `result`. Optional so
   * callers predating the provider seam still compile; a NULL here means the
   * result was written before attempts were recorded. */
  screeningRequestId?: string;
  provider?: ScreeningProviderKind;
  attemptOutcome?: ScreeningAttemptOutcome;
  datasetVersion?: string;
}

export interface UpsertRiskRatingInput {
  kycRecordId: string;
  level: RiskLevel;
  reason?: string;
}

export interface UpdateKycRecordInput {
  isEdd?: boolean;
  nextReviewDueAt?: Date | null;
  approvedByUserId?: string;
  approvedAt?: Date;
}

/** Process 3-4 (Customer Acquisition/Onboarding) — KYCRecord plus its two
 * child tables, ScreeningResult and RiskRating. `status` is never written
 * here directly (ibms-brain/meta/lex/workflow-state-transitions.md) — every
 * status move goes through WorkflowTransitionService via
 * workflow-transitions.config.ts's `KYCRecord` entity; `update()` below
 * covers only the non-status columns a KYC decision or screening run needs
 * to persist alongside (or independently of) a transition. */
/**
 * The combined-duty act, on every KYC read.
 *
 * `KYCRecord_maker_checker_distinct` requires that whoever creates a KYC file is not whoever approves
 * it. In an office that declared COMBINED mode one person may do both by stating why, and the act
 * lands in `combinedDutyActId`.
 *
 * THE OWNER RULED THIS IN SCOPE rather than deferred, and the reasoning is worth keeping: the money
 * and screening deferral covers screening work, and **showing who performed an act and who approved it
 * is neither.** It does not touch the screening engine, does not extend it, and adds no screening
 * claim anywhere. It is the same line as the other pairs, on a record that happens to be a KYC record.
 */
const KYC_INCLUDE = { combinedDutyAct: true } as const;

export type KycRecordWithAct = Prisma.KYCRecordGetPayload<{
  include: typeof KYC_INCLUDE;
}>;

@Injectable()
export class KycRecordRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateKycRecordInput): Promise<KycRecordWithAct> {
    // The include here too, so one shape serves reads and writes. A newly started KYC file has no act
    // — nothing has approved it — so this always yields null; what it buys is that the row type needs
    // no optional field, and an optional field is what lets the next caller pass a row whose act state
    // nobody knows.
    return this.prisma.client.kYCRecord.create({
      data: input,
      include: KYC_INCLUDE,
    });
  }

  findById(id: string): Promise<KycRecordWithAct | null> {
    return this.prisma.client.kYCRecord.findUnique({
      where: { id },
      include: KYC_INCLUDE,
    });
  }

  findMany(filter: KycRecordFilter): Promise<KycRecordWithCustomer[]> {
    return this.prisma.client.kYCRecord.findMany({
      where: {
        status: filter.status,
        customerId: filter.customerId,
        customer: filter.customerOwnerUserId
          ? { ownerUserId: filter.customerOwnerUserId }
          : undefined,
      },
      include: {
        customer: { select: { legalName: true, customerType: true } },
        ...KYC_INCLUDE,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The most recently created KYCRecord for a Customer, any status — "the
   * current KYC file" a submit/screening/decision call resolves ownership
   * and state against. */
  findLatestByCustomerId(customerId: string): Promise<KycRecordWithAct | null> {
    return this.prisma.client.kYCRecord.findFirst({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: KYC_INCLUDE,
    });
  }

  /** Every APPROVED KYCRecord whose nextReviewDueAt has passed — the
   * periodic re-KYC sweep (kyc-periodic-review.scheduler.ts). */
  findApprovedDueForReview(now: Date): Promise<KYCRecord[]> {
    return this.prisma.client.kYCRecord.findMany({
      where: { status: 'APPROVED', nextReviewDueAt: { lte: now } },
    });
  }

  update(id: string, data: UpdateKycRecordInput): Promise<KycRecordWithAct> {
    // The include on the write too — every path out of this repository carries the same shape, so a
    // caller cannot receive a row whose act state is unknowable.
    return this.prisma.client.kYCRecord.update({
      where: { id },
      data,
      include: KYC_INCLUDE,
    });
  }

  createScreeningResult(
    input: CreateScreeningResultInput,
  ): Promise<ScreeningResult> {
    return this.prisma.client.screeningResult.create({ data: input });
  }

  findScreeningResultsByKycRecordId(
    kycRecordId: string,
  ): Promise<ScreeningResult[]> {
    return this.prisma.client.screeningResult.findMany({
      where: { kycRecordId },
      orderBy: { screenedAt: 'desc' },
    });
  }

  upsertRiskRating(input: UpsertRiskRatingInput): Promise<RiskRating> {
    return this.prisma.client.riskRating.upsert({
      where: { kycRecordId: input.kycRecordId },
      create: input,
      update: { level: input.level, reason: input.reason, ratedAt: new Date() },
    });
  }

  findRiskRatingByKycRecordId(kycRecordId: string): Promise<RiskRating | null> {
    return this.prisma.client.riskRating.findUnique({
      where: { kycRecordId },
    });
  }
}

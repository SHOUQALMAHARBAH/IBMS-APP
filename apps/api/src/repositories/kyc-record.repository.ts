import { Injectable } from '@nestjs/common';
import type {
  CustomerType,
  KYCRecord,
  KycStatus,
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
@Injectable()
export class KycRecordRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateKycRecordInput): Promise<KYCRecord> {
    return this.prisma.client.kYCRecord.create({ data: input });
  }

  findById(id: string): Promise<KYCRecord | null> {
    return this.prisma.client.kYCRecord.findUnique({ where: { id } });
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
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The most recently created KYCRecord for a Customer, any status — "the
   * current KYC file" a submit/screening/decision call resolves ownership
   * and state against. */
  findLatestByCustomerId(customerId: string): Promise<KYCRecord | null> {
    return this.prisma.client.kYCRecord.findFirst({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Every APPROVED KYCRecord whose nextReviewDueAt has passed — the
   * periodic re-KYC sweep (kyc-periodic-review.scheduler.ts). */
  findApprovedDueForReview(now: Date): Promise<KYCRecord[]> {
    return this.prisma.client.kYCRecord.findMany({
      where: { status: 'APPROVED', nextReviewDueAt: { lte: now } },
    });
  }

  update(id: string, data: UpdateKycRecordInput): Promise<KYCRecord> {
    return this.prisma.client.kYCRecord.update({ where: { id }, data });
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

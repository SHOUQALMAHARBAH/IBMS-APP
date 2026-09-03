import { Injectable } from '@nestjs/common';
import type {
  CommissionAgreement,
  CommissionLedgerEntry,
  Prisma,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/** An agreement row joined to its insurer name — the shape the commission
 * reads return. */
const AGREEMENT_WITH_INSURER = {
  include: { insurer: { select: { name: true } } },
} as const;

export type AgreementWithInsurer = Prisma.CommissionAgreementGetPayload<
  typeof AGREEMENT_WITH_INSURER
>;

export interface CreateAgreementRow {
  insurerId: string;
  insuranceLine: string;
  ratePercent: Prisma.Decimal;
  effectiveFrom: Date;
}

/**
 * Process 35 — Commission Calculation (backlog Part C #35, Domain D). Owns the
 * `CommissionAgreement` governed rate table and the `CommissionLedgerEntry`
 * commission ledger, wrapping `PrismaService` (services depend on repositories
 * in this codebase, never on Prisma directly).
 *
 * Race backstops (`ibms-brain/meta/lex/race-safe-invariants.md`): the partial
 * `UNIQUE ("insurerId", "insuranceLine") WHERE "effectiveTo" IS NULL`
 * (migration `20260903120000`) makes "one open governed rate per pair"
 * structural; `CommissionLedgerEntry.policyId @unique` makes "one commission
 * entry per policy" structural. `P2002` on either surfaces to the service as
 * a resume-or-409.
 */
@Injectable()
export class CommissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- CommissionAgreement -------------------------------------------------

  insurerExists(insurerId: string): Promise<boolean> {
    return this.prisma.client.insurer
      .count({ where: { id: insurerId } })
      .then((n) => n > 0);
  }

  listInsurers(): Promise<{ id: string; name: string }[]> {
    return this.prisma.client.insurer.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Every agreement for a pair, newest window first — the input to
   * `resolveGovernedRate` and the history read. `insuranceLine` is matched
   * **case-insensitively** and trimmed: both `Policy.insuranceLine` and
   * `CommissionAgreement.insuranceLine` are free text entered independently, so
   * a casing / whitespace mismatch must not silently 422 a calculation whose
   * governing rate does exist. */
  findAgreementsForPair(
    insurerId: string,
    insuranceLine: string,
  ): Promise<AgreementWithInsurer[]> {
    return this.prisma.client.commissionAgreement.findMany({
      where: {
        insurerId,
        insuranceLine: { equals: insuranceLine.trim(), mode: 'insensitive' },
      },
      ...AGREEMENT_WITH_INSURER,
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  findAgreements(scope: {
    insurerId?: string;
    insuranceLine?: string;
  }): Promise<AgreementWithInsurer[]> {
    return this.prisma.client.commissionAgreement.findMany({
      where: {
        ...(scope.insurerId ? { insurerId: scope.insurerId } : {}),
        ...(scope.insuranceLine
          ? {
              insuranceLine: {
                equals: scope.insuranceLine.trim(),
                mode: 'insensitive',
              },
            }
          : {}),
      },
      ...AGREEMENT_WITH_INSURER,
      orderBy: [{ insuranceLine: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  /** The currently-open agreement for a pair (or null) — mirrors the partial
   * UNIQUE index. Case-insensitive / trimmed `insuranceLine` so a supersede
   * catches a casing variant of the same line rather than opening a near-
   * duplicate window. */
  findOpenAgreement(
    insurerId: string,
    insuranceLine: string,
  ): Promise<CommissionAgreement | null> {
    return this.prisma.client.commissionAgreement.findFirst({
      where: {
        insurerId,
        insuranceLine: { equals: insuranceLine.trim(), mode: 'insensitive' },
        effectiveTo: null,
      },
    });
  }

  /**
   * Open a new governed rate window for a pair, closing the prior open one (if
   * any) at the new window's `effectiveFrom` — both in ONE `$transaction` (a
   * deliberate local exception to this codebase's no-`$transaction`
   * convention, same rationale as `PolicyRepository.createIssuanceArtifacts` /
   * `QuotationRepository.reviseChain`: a crash between the close and the open
   * would leave the pair with no open rate or two). The partial UNIQUE index
   * is the race backstop — a concurrent supersede rolls the whole transaction
   * back on `P2002`.
   */
  supersedeAndCreateAgreement(input: {
    create: CreateAgreementRow;
    supersedeId: string | null;
  }): Promise<AgreementWithInsurer> {
    return this.prisma.client.$transaction(async (tx) => {
      if (input.supersedeId !== null) {
        await tx.commissionAgreement.update({
          where: { id: input.supersedeId },
          data: { effectiveTo: input.create.effectiveFrom },
        });
      }
      return tx.commissionAgreement.create({
        data: input.create,
        ...AGREEMENT_WITH_INSURER,
      });
    });
  }

  // --- CommissionLedgerEntry --------------------------------------------

  createLedgerEntry(input: {
    policyId: string;
    commissionAgreementId: string;
    amount: Prisma.Decimal;
  }): Promise<CommissionLedgerEntry> {
    return this.prisma.client.commissionLedgerEntry.create({
      data: {
        policyId: input.policyId,
        commissionAgreementId: input.commissionAgreementId,
        amount: input.amount,
        status: 'outstanding',
        isManualOverride: false,
      },
    });
  }

  findLedgerEntryById(id: string): Promise<CommissionLedgerEntry | null> {
    return this.prisma.client.commissionLedgerEntry.findUnique({
      where: { id },
    });
  }

  findLedgerEntryByPolicyId(
    policyId: string,
  ): Promise<CommissionLedgerEntry | null> {
    return this.prisma.client.commissionLedgerEntry.findUnique({
      where: { policyId },
    });
  }

  /** Book-wide ledger read, optionally narrowed to one policy or one insurer
   * (via the policy relation). Capped — a broker's commission book fits, but
   * an unbounded book-wide `findMany` should still not run away. */
  findLedgerEntries(
    scope: { policyId?: string; insurerId?: string },
    take: number,
  ): Promise<CommissionLedgerEntry[]> {
    return this.prisma.client.commissionLedgerEntry.findMany({
      where: {
        ...(scope.policyId ? { policyId: scope.policyId } : {}),
        ...(scope.insurerId
          ? { policy: { is: { insurerId: scope.insurerId } } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** Raise / revise a still-pending manual override. `amount` is left
   * untouched — the governed figure keeps governing until an approval copies
   * `overrideAmount` into it. */
  recordOverrideRaise(
    id: string,
    input: {
      overrideAmount: Prisma.Decimal;
      overrideReason: string;
      overrideRequestedByUserId: string;
    },
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.commissionLedgerEntry.updateMany({
      where: { id, status: 'outstanding', overrideApprovedByUserId: null },
      data: {
        isManualOverride: true,
        overrideAmount: input.overrideAmount,
        overrideReason: input.overrideReason,
        overrideRequestedByUserId: input.overrideRequestedByUserId,
      },
    });
  }

  /**
   * Approve a pending override: stamp the checker and copy `overrideAmount`
   * into `amount`. Status-conditional `updateMany` — the `where` re-asserts
   * **every** field the service validated (`status`, `isManualOverride`,
   * `overrideApprovedByUserId IS NULL`, **plus** the exact `requestedByUserId`
   * `assertDifferentActors` was checked against and the exact `overrideAmount`
   * being copied into `amount`), so a concurrent `raiseOverride` landing
   * between the service's load and this write turns into a clean 0-row →
   * reload → resume / 409 rather than (a) a DB-CHECK P2004 → 500 if the racing
   * raiser is the approver, or (b) a stale amount being copied while
   * `overrideAmount` now holds a newer value.
   */
  recordOverrideApproval(
    id: string,
    approverUserId: string,
    expected: {
      requestedByUserId: string;
      overrideAmount: Prisma.Decimal;
    },
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.commissionLedgerEntry.updateMany({
      where: {
        id,
        status: 'outstanding',
        isManualOverride: true,
        overrideApprovedByUserId: null,
        overrideRequestedByUserId: expected.requestedByUserId,
        overrideAmount: expected.overrideAmount,
      },
      data: {
        overrideApprovedByUserId: approverUserId,
        amount: expected.overrideAmount,
      },
    });
  }
}

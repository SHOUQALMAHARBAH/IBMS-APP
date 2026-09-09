import { Injectable } from '@nestjs/common';
import type { Prisma, RenewalCase } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

const RENEWAL_CASE_INCLUDE = {
  policy: {
    select: {
      id: true,
      customerId: true,
      policyNumber: true,
      insuranceLine: true,
      insurerId: true,
      status: true,
      inceptionDate: true,
      expiryDate: true,
      issuedPremium: true,
      requestedPremium: true,
      customer: { select: { legalName: true } },
    },
  },
  lossRatio: true,
} as const;

export type RenewalCaseWithContext = Prisma.RenewalCaseGetPayload<{
  include: typeof RENEWAL_CASE_INCLUDE;
}>;

/** A policy inside the renewal lead-time window with no case open yet. */
export interface RenewalCandidateRow {
  id: string;
  customerId: string;
  expiryDate: Date | null;
}

/** Part 3.9 — a global sweep is capped like every other unbounded scan in
 * this codebase (`FOLLOWUP_SWEEP_LIMIT`, `ANALYTICS_POLICY_LIMIT`, ...). */
export const RENEWAL_SWEEP_LIMIT = 1000;

/**
 * Part 3.9 — Renewal Management. Owns `RenewalCase`, the parent the dormant
 * `LossRatio` row and `RetentionCaseService.runSweep` both key off.
 */
@Injectable()
export class RenewalCaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<RenewalCaseWithContext | null> {
    return this.prisma.client.renewalCase.findUnique({
      where: { id },
      include: RENEWAL_CASE_INCLUDE,
    });
  }

  findByPolicyId(policyId: string): Promise<RenewalCaseWithContext | null> {
    return this.prisma.client.renewalCase.findUnique({
      where: { policyId },
      include: RENEWAL_CASE_INCLUDE,
    });
  }

  findMany(filter: {
    customerId?: string;
    policyId?: string;
    status?: RenewalCase['status'];
  }): Promise<RenewalCaseWithContext[]> {
    return this.prisma.client.renewalCase.findMany({
      where: {
        policyId: filter.policyId,
        status: filter.status,
        ...(filter.customerId
          ? { policy: { is: { customerId: filter.customerId } } }
          : {}),
      },
      include: RENEWAL_CASE_INCLUDE,
      orderBy: { triggeredAt: 'desc' },
    });
  }

  /**
   * Every ACTIVE policy whose `expiryDate` falls inside the lead-time window
   * and that has no `RenewalCase` yet.
   *
   * The `renewalCase: null` filter is a NARROWING convenience, not the race
   * gate — `RenewalCase.policyId @unique` is, and `open()` maps its `P2002`
   * to a counted skip. A concurrent sweep therefore cannot double-open.
   *
   * NOTE — an ACTIVE policy whose `expiryDate` is already in the PAST matches
   * too, deliberately: nothing in this codebase moves a policy to `EXPIRED`
   * when its date passes (`Policy.expiryDate` is an independent bound, see
   * `claim.service.ts#resolveCoverageAtLossDate`), so "ACTIVE and past
   * expiry" is a renewal that was missed, not a row to skip. It does mean a
   * first run against a book with old data opens a batch of overdue cases;
   * `RENEWAL_SWEEP_LIMIT` bounds each run and the `@unique` keeps re-runs
   * idempotent. Revisit if a real policy-expiry sweep ever lands.
   */
  findRenewalCandidates(windowEnd: Date): Promise<RenewalCandidateRow[]> {
    return this.prisma.client.policy.findMany({
      where: {
        status: 'ACTIVE',
        expiryDate: { not: null, lte: windowEnd },
        renewalCase: { is: null },
      },
      select: { id: true, customerId: true, expiryDate: true },
      orderBy: { expiryDate: 'asc' },
      take: RENEWAL_SWEEP_LIMIT,
    });
  }

  create(input: {
    policyId: string;
    leadTimeDays: number;
  }): Promise<RenewalCase> {
    return this.prisma.client.renewalCase.create({ data: input });
  }

  /** Set the two re-marketing trigger flags. Plain field writes — neither is
   * a status, so neither goes through the workflow engine. */
  updateFlags(
    id: string,
    data: {
      riskChangedSinceLastRenewal?: boolean;
      insurerTermsWorsened?: boolean;
    },
  ): Promise<RenewalCase> {
    return this.prisma.client.renewalCase.update({ where: { id }, data });
  }
}

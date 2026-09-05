import { Injectable } from '@nestjs/common';
import type { Prisma, ProfessionalIndemnityPolicy } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreatePiPolicyInput {
  insurerName: string;
  coverageLimit: Prisma.Decimal;
  expiresAt: Date;
  claimsHistorySummary: string | null;
}

/**
 * Process 53-54/Part 7.1 — owns `ProfessionalIndemnityPolicy`. Unlike
 * `BrokerLicenseRepository`'s fixed-id singleton, this model has no
 * `issuedAt`/period-start field to define a validity window with, and a
 * renewal is its own new row (preserving `claimsHistorySummary` history per
 * period, the #41/#46/compliance-calendar per-instance shape) rather than an
 * in-place overwrite — "current" is simply whichever row expires furthest in
 * the future (`findCurrent`), the exact definition
 * `PolicyCheckingRepository.findLatestPiPolicyId` already needed for its
 * discrepancy auto-link (Process 20/54) before this module existed; that
 * method now delegates here instead of carrying its own copy of the query,
 * so there is exactly one definition of "current" for both callers to drift
 * out of sync from.
 */
@Injectable()
export class PiPolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreatePiPolicyInput): Promise<ProfessionalIndemnityPolicy> {
    return this.prisma.client.professionalIndemnityPolicy.create({
      data: {
        insurerName: input.insurerName,
        coverageLimit: input.coverageLimit,
        expiresAt: input.expiresAt,
        claimsHistorySummary: input.claimsHistorySummary,
      },
    });
  }

  /** The broker's most-recently-expiring PI policy on record, or `null` if
   * none has ever been logged. A `@code-reviewer` BLOCKER on the first pass:
   * `orderBy: { expiresAt: 'desc' }` alone has no secondary sort key, and a
   * tie is the LIKELY case, not an edge case — `CreatePiPolicyDto.expiresAt`
   * goes through `parseCalendarDate`, so any plain date (the expected input
   * shape) normalizes to an exact UTC midnight; two officers entering the
   * same calendar-year renewal date, a genuine multi-insurer PI tower with
   * layers expiring the same day, or an accidental duplicate submission (no
   * uniqueness guard exists on this table) all tie to the millisecond.
   * Postgres gives no guarantee which tied row `ORDER BY ... LIMIT 1`
   * returns, so `GET /pi-policy/current`, `list()`'s `isCurrent` flag, and
   * the discrepancy auto-link (`findLatestPiPolicyId` below) could each
   * independently — and inconsistently across calls — pick a different one
   * of the tied rows. `id` (a UUID, not itself meaningful, but STABLE) is
   * the deterministic tiebreaker; the tied set's actual "true" current
   * record is a business judgement call no orderBy can make, but every
   * caller must at least agree on the SAME row. */
  findCurrent(): Promise<ProfessionalIndemnityPolicy | null> {
    return this.prisma.client.professionalIndemnityPolicy.findFirst({
      orderBy: [{ expiresAt: 'desc' }, { id: 'desc' }],
    });
  }

  findById(id: string): Promise<ProfessionalIndemnityPolicy | null> {
    return this.prisma.client.professionalIndemnityPolicy.findUnique({
      where: { id },
    });
  }

  findMany(take: number): Promise<ProfessionalIndemnityPolicy[]> {
    return this.prisma.client.professionalIndemnityPolicy.findMany({
      orderBy: [{ expiresAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }

  updateClaimsHistory(
    id: string,
    claimsHistorySummary: string,
  ): Promise<ProfessionalIndemnityPolicy> {
    return this.prisma.client.professionalIndemnityPolicy.update({
      where: { id },
      data: { claimsHistorySummary },
    });
  }
}

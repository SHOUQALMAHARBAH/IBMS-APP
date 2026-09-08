import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type InsuranceProgram,
  type InsuranceProgramLine,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateInsuranceProgramInput {
  riskProfileId: string;
  needsAssessmentId: string;
  assembledByUserId: string;
}

export interface InsuranceProgramLineInput {
  insuranceLine: string;
  /** Fils-precision — already quantized by the service via money.util.ts. */
  sumInsuredBasis: Prisma.Decimal | null;
}

/** An InsuranceProgram with its assembled lines (Part C #7). */
export interface InsuranceProgramWithLines extends InsuranceProgram {
  lines: InsuranceProgramLine[];
}

/** Process 7 — Product Recommendation / Program Design. Same "one repository
 * per aggregate root" shape as lead/prospect/customer/risk-profile — an
 * `InsuranceProgramLine` only ever exists inside one program and is only
 * read/written through here. `status` is never written here — it moves only
 * through WorkflowTransitionService (A.6); see insurance-program.service.ts. */
@Injectable()
export class InsuranceProgramRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateInsuranceProgramInput): Promise<InsuranceProgram> {
    return this.prisma.client.insuranceProgram.create({ data: input });
  }

  findById(id: string): Promise<InsuranceProgramWithLines | null> {
    return this.prisma.client.insuranceProgram.findUnique({
      where: { id },
      include: { lines: { orderBy: { insuranceLine: 'asc' } } },
    });
  }

  findManyByCustomerId(
    customerId: string,
  ): Promise<InsuranceProgramWithLines[]> {
    return this.prisma.client.insuranceProgram.findMany({
      where: { riskProfile: { customerId } },
      include: { lines: { orderBy: { insuranceLine: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Every program for one Risk Profile, newest first — feeds the "a
   * non-superseded program already exists" assembly guard. */
  findManyByRiskProfileId(riskProfileId: string): Promise<InsuranceProgram[]> {
    return this.prisma.client.insuranceProgram.findMany({
      where: { riskProfileId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Distinct customer ids that have at least one non-SUPERSEDED Insurance
   * Program — the set the Up-Selling sweep (Part C #9) scans for
   * under-insurance. `InsuranceProgram_one_live_per_risk_profile` (migration
   * 20260827180000) already caps it at one non-SUPERSEDED program per Risk
   * Profile, so the `new Set` only has to fold a multi-site customer's
   * several profiles into one id. */
  async findCustomerIdsWithLiveProgram(): Promise<string[]> {
    const rows = await this.prisma.client.insuranceProgram.findMany({
      where: { status: { not: 'SUPERSEDED' } },
      select: { riskProfile: { select: { customerId: true } } },
    });
    return [...new Set(rows.map((r) => r.riskProfile.customerId))];
  }

  createLines(
    insuranceProgramId: string,
    lines: readonly InsuranceProgramLineInput[],
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.insuranceProgramLine.createMany({
      data: lines.map((line) => ({ ...line, insuranceProgramId })),
    });
  }

  /** Re-assembly's guard + wholesale lines rewrite, in ONE transaction
   * (ibms-brain/meta/lex/race-safe-invariants.md — the
   * `escalateAndCreateRetentionCase` shape, retention-case.repository.ts).
   * The guard is a real `UPDATE ... WHERE id = ? AND status = 'DRAFT'`, not
   * a `findUnique` read: Postgres takes a row lock on the InsuranceProgram
   * row for that write and holds it until this transaction commits, so a
   * concurrent finalize() — WorkflowTransitionService.transition()'s own
   * status-conditional `updateMany` against the SAME row — either blocks
   * behind this transaction or blocks this one. Whichever commits second
   * re-evaluates its own status predicate against the row the other one
   * just committed, so the loser always lands on a clean zero-row result
   * instead of the open read-then-write window a separate re-read before an
   * unconditional delete+create used to leave.
   *
   * The guard write also stamps `assembledByUserId` with the re-assembling
   * officer — a real field update (who last (re)assembled the program),
   * not a synthetic touch column, so it doubles as the lock's write target.
   *
   * Returns `null` when this call lost the race — the program was no
   * longer DRAFT by the time the lock was acquired (a concurrent finalize()
   * won). Returns the lines createMany BatchPayload on success. */
  async reassembleLines(
    insuranceProgramId: string,
    reassembledByUserId: string,
    lines: readonly InsuranceProgramLineInput[],
  ): Promise<Prisma.BatchPayload | null> {
    return this.prisma.client.$transaction(async (tx) => {
      const locked = await tx.insuranceProgram.updateMany({
        where: { id: insuranceProgramId, status: 'DRAFT' },
        data: { assembledByUserId: reassembledByUserId },
      });
      if (locked.count === 0) return null;

      await tx.insuranceProgramLine.deleteMany({
        where: { insuranceProgramId },
      });
      return tx.insuranceProgramLine.createMany({
        data: lines.map((line) => ({ ...line, insuranceProgramId })),
      });
    });
  }
}

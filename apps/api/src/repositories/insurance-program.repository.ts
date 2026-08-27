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

  createLines(
    insuranceProgramId: string,
    lines: readonly InsuranceProgramLineInput[],
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.insuranceProgramLine.createMany({
      data: lines.map((line) => ({ ...line, insuranceProgramId })),
    });
  }

  /** Wipes a DRAFT program's lines ahead of a re-assembly (guarded by the
   * service — only ever called while the program is DRAFT). */
  deleteLines(insuranceProgramId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.client.insuranceProgramLine.deleteMany({
      where: { insuranceProgramId },
    });
  }
}

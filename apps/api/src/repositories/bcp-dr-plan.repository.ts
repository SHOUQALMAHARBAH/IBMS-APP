import { Injectable } from '@nestjs/common';
import type { BcpDrPlan } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateBcpDrPlanInput {
  scenario: string;
  planDocumentId: string | null;
  rtoHours: number | null;
  rpoHours: number | null;
}

export interface UpdateBcpDrPlanInput {
  planDocumentId?: string | null;
  rtoHours?: number | null;
  rpoHours?: number | null;
}

export interface BcpDrPlanFilter {
  scenario?: string;
}

/**
 * Process 72-73 (backlog Part C #72-73, Domain H) — `BcpDrPlan` pre-exists
 * in the core schema with zero prior application code. First real writer.
 */
@Injectable()
export class BcpDrPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateBcpDrPlanInput): Promise<BcpDrPlan> {
    return this.prisma.client.bcpDrPlan.create({ data: input });
  }

  findById(id: string): Promise<BcpDrPlan | null> {
    return this.prisma.client.bcpDrPlan.findUnique({ where: { id } });
  }

  findMany(filter: BcpDrPlanFilter): Promise<BcpDrPlan[]> {
    return this.prisma.client.bcpDrPlan.findMany({
      where: { scenario: filter.scenario },
    });
  }

  update(id: string, input: UpdateBcpDrPlanInput): Promise<BcpDrPlan> {
    return this.prisma.client.bcpDrPlan.update({
      where: { id },
      data: input,
    });
  }

  recordTest(
    id: string,
    testedAt: Date,
    nextTestDueAt: Date,
  ): Promise<BcpDrPlan> {
    return this.prisma.client.bcpDrPlan.update({
      where: { id },
      data: { lastTestedAt: testedAt, nextTestDueAt },
    });
  }
}

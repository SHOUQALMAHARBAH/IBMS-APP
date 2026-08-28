import { Injectable } from '@nestjs/common';
import type { Opportunity } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateOpportunityInput {
  customerId: string;
  insuranceProgramId: string;
  createdByUserId: string;
}

/**
 * Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B). The
 * minimal parent-record home an `RFQ` hangs off — an Opportunity is created
 * from a FINALIZED `InsuranceProgram` and, in this backlog item, only ever
 * read or listed afterward (the full lifecycle — client decision,
 * renegotiation, close-lost — is Processes 16-17, not built). Same "one
 * repository per aggregate root" shape as lead/prospect/customer.
 *
 * `status` is NEVER written here — it moves only through
 * WorkflowTransitionService (A.6, ibms-brain/meta/lex/
 * workflow-state-transitions.md). The one status move this backlog item
 * drives (NEEDS_CONFIRMED -> RFQ_ISSUED, when the first RFQ is issued) goes
 * through the engine from `rfq.service.ts`.
 */
@Injectable()
export class OpportunityRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateOpportunityInput): Promise<Opportunity> {
    return this.prisma.client.opportunity.create({ data: input });
  }

  findById(id: string): Promise<Opportunity | null> {
    return this.prisma.client.opportunity.findUnique({ where: { id } });
  }

  findManyByCustomerId(customerId: string): Promise<Opportunity[]> {
    return this.prisma.client.opportunity.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Every Opportunity for one Insurance Program, newest first — feeds the
   * "a live Opportunity already exists" pre-check in OpportunityService. The
   * partial UNIQUE index `Opportunity_one_live_per_insurance_program`
   * (migration 20260828120000) is what actually enforces the invariant
   * (ibms-brain/meta/lex/race-safe-invariants.md); this read only keeps the
   * pre-check message descriptive. */
  findManyByInsuranceProgramId(
    insuranceProgramId: string,
  ): Promise<Opportunity[]> {
    return this.prisma.client.opportunity.findMany({
      where: { insuranceProgramId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

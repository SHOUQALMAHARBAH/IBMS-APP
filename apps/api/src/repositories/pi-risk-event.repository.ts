import { Injectable } from '@nestjs/common';
import type { ProfessionalIndemnityRiskEvent } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreatePiRiskEventInput {
  piPolicyId: string | null;
  description: string;
}

export interface PiRiskEventScope {
  piPolicyId?: string;
  sourcePolicyCheckingId?: string;
}

/**
 * Process 54 — owns `ProfessionalIndemnityRiskEvent`. Two writers exist:
 * `PolicyCheckingRepository.recordChecking` (Process 20/54's automatic
 * discrepancy-to-risk-event link, inside its own `$transaction` — untouched
 * by this repository, which never targets a `sourcePolicyCheckingId`-set
 * row for create) and `PiRiskEventService.logManual` below (a manual entry
 * for an exposure that did not come through a Policy Checking discrepancy —
 * `sourcePolicyCheckingId` stays null; only the internal auto-link ever sets
 * it).
 */
@Injectable()
export class PiRiskEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    input: CreatePiRiskEventInput,
  ): Promise<ProfessionalIndemnityRiskEvent> {
    return this.prisma.client.professionalIndemnityRiskEvent.create({
      data: {
        piPolicyId: input.piPolicyId,
        description: input.description,
      },
    });
  }

  findById(id: string): Promise<ProfessionalIndemnityRiskEvent | null> {
    return this.prisma.client.professionalIndemnityRiskEvent.findUnique({
      where: { id },
    });
  }

  findMany(
    scope: PiRiskEventScope,
    take: number,
  ): Promise<ProfessionalIndemnityRiskEvent[]> {
    return this.prisma.client.professionalIndemnityRiskEvent.findMany({
      where: {
        ...(scope.piPolicyId ? { piPolicyId: scope.piPolicyId } : {}),
        ...(scope.sourcePolicyCheckingId
          ? { sourcePolicyCheckingId: scope.sourcePolicyCheckingId }
          : {}),
      },
      orderBy: { loggedAt: 'desc' },
      take,
    });
  }

  updateMitigation(
    id: string,
    mitigationAction: string,
  ): Promise<ProfessionalIndemnityRiskEvent> {
    return this.prisma.client.professionalIndemnityRiskEvent.update({
      where: { id },
      data: { mitigationAction },
    });
  }
}

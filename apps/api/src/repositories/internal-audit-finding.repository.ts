import { Injectable } from '@nestjs/common';
import type { InternalAuditFinding, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateInternalAuditFindingInput {
  auditPeriodLabel: string;
  finding: string;
  remediationAction: string | null;
  loggedAt: Date;
}

export interface InternalAuditFindingScope {
  status?: string;
}

/**
 * Process 57 — owns `InternalAuditFinding`. `status` is a plain string
 * (`open`/`closed`) — the `RiskRegisterItem`/#46 shape, no richer
 * lifecycle, so `close`/`recordRemediation` are status-conditional
 * `updateMany` calls, not a `WorkflowTransitionService` entity.
 */
@Injectable()
export class InternalAuditFindingRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    input: CreateInternalAuditFindingInput,
  ): Promise<InternalAuditFinding> {
    return this.prisma.client.internalAuditFinding.create({
      data: {
        auditPeriodLabel: input.auditPeriodLabel,
        finding: input.finding,
        remediationAction: input.remediationAction,
        loggedAt: input.loggedAt,
      },
    });
  }

  findById(id: string): Promise<InternalAuditFinding | null> {
    return this.prisma.client.internalAuditFinding.findUnique({
      where: { id },
    });
  }

  findMany(
    scope: InternalAuditFindingScope,
    take: number,
  ): Promise<InternalAuditFinding[]> {
    return this.prisma.client.internalAuditFinding.findMany({
      where: {
        ...(scope.status ? { status: scope.status } : {}),
      },
      orderBy: { loggedAt: 'desc' },
      take,
    });
  }

  /** Legal only while still `open` — the `RiskRegisterItem.recordMitigation`
   * shape. Status-conditional so a concurrent close wins the race
   * (`race-safe-invariants.md`). */
  recordRemediation(
    id: string,
    remediationAction: string,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.internalAuditFinding.updateMany({
      where: { id, status: 'open' },
      data: { remediationAction },
    });
  }

  /** `open -> closed`, status-conditional so a concurrent double-close is a
   * harmless 0-row match, not an error (the `RiskRegisterItem.close`
   * shape). */
  close(id: string, closedAt: Date): Promise<Prisma.BatchPayload> {
    return this.prisma.client.internalAuditFinding.updateMany({
      where: { id, status: 'open' },
      data: { status: 'closed', closedAt },
    });
  }
}

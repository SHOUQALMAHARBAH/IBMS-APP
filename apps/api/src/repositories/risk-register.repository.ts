import { Injectable } from '@nestjs/common';
import type { Prisma, RiskRegisterItem } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateRiskRegisterItemInput {
  riskType: string;
  description: string;
  mitigationAction: string | null;
  loggedAt: Date;
}

export interface RiskRegisterScope {
  riskType?: string;
  status?: string;
}

/**
 * Process 53 — owns `RiskRegisterItem`. `status` is a plain string
 * (`open`/`closed`) — the `RetentionCase`/#46 shape, no richer lifecycle,
 * so `close` and `recordMitigation` are status-conditional `updateMany`
 * calls, not a `WorkflowTransitionService` entity.
 */
@Injectable()
export class RiskRegisterRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateRiskRegisterItemInput): Promise<RiskRegisterItem> {
    return this.prisma.client.riskRegisterItem.create({
      data: {
        riskType: input.riskType,
        description: input.description,
        mitigationAction: input.mitigationAction,
        loggedAt: input.loggedAt,
      },
    });
  }

  findById(id: string): Promise<RiskRegisterItem | null> {
    return this.prisma.client.riskRegisterItem.findUnique({ where: { id } });
  }

  findMany(
    scope: RiskRegisterScope,
    take: number,
  ): Promise<RiskRegisterItem[]> {
    return this.prisma.client.riskRegisterItem.findMany({
      where: {
        ...(scope.riskType ? { riskType: scope.riskType } : {}),
        ...(scope.status ? { status: scope.status } : {}),
      },
      orderBy: { loggedAt: 'desc' },
      take,
    });
  }

  /** Legal only while still `open` — updating the mitigation plan on an
   * already-closed item would silently rewrite what was actually done
   * before closure. Status-conditional so a concurrent close wins the race
   * (`race-safe-invariants.md`). */
  recordMitigation(
    id: string,
    mitigationAction: string,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.riskRegisterItem.updateMany({
      where: { id, status: 'open' },
      data: { mitigationAction },
    });
  }

  /** `open -> closed`, status-conditional so a concurrent double-close is a
   * harmless 0-row match, not an error (the `RetentionCase.close` shape). */
  close(id: string, closedAt: Date): Promise<Prisma.BatchPayload> {
    return this.prisma.client.riskRegisterItem.updateMany({
      where: { id, status: 'open' },
      data: { status: 'closed', closedAt },
    });
  }
}

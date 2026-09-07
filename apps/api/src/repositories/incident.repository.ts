import { Injectable } from '@nestjs/common';
import type { IncidentReport, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateIncidentInput {
  title: string;
  description: string;
  severity: string;
}

export interface IncidentScope {
  status?: string;
  severity?: string;
  classification?: string;
}

/**
 * Process 55 — owns `IncidentReport`. Status moves go through
 * `WorkflowTransitionService` (the `@Global()` `WorkflowModule`), not this
 * repository. The three non-status stamps below (co-sign, senior-management
 * notification, affected-subject notification) are all status-conditional/
 * write-once `updateMany` calls, the `race-safe-invariants.md` shape.
 */
@Injectable()
export class IncidentRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateIncidentInput): Promise<IncidentReport> {
    return this.prisma.client.incidentReport.create({
      data: {
        title: input.title,
        description: input.description,
        severity: input.severity,
      },
    });
  }

  findById(id: string): Promise<IncidentReport | null> {
    return this.prisma.client.incidentReport.findUnique({ where: { id } });
  }

  findMany(scope: IncidentScope, take: number): Promise<IncidentReport[]> {
    return this.prisma.client.incidentReport.findMany({
      where: {
        ...(scope.status ? { status: scope.status as never } : {}),
        ...(scope.severity ? { severity: scope.severity } : {}),
        ...(scope.classification
          ? { classification: scope.classification as never }
          : {}),
      },
      orderBy: { reportedAt: 'desc' },
      take,
    });
  }

  /** The Senior Management co-sign — write-once
   * (`seniorManagementCoSignUserId IS NULL`), legal only for a MATERIAL
   * incident. `assertDifferentActors` is enforced by the caller before this
   * write; the `IncidentReport_classification_maker_checker_distinct` CHECK
   * (migration 20260906120000) is the DB-layer backstop. */
  recordCoSign(
    id: string,
    seniorManagementCoSignUserId: string,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.incidentReport.updateMany({
      where: {
        id,
        classification: 'MATERIAL',
        seniorManagementCoSignUserId: null,
      },
      data: { seniorManagementCoSignUserId },
    });
  }

  /** Write-once — legal only for a MATERIAL incident. */
  recordSeniorManagementNotified(
    id: string,
    notifiedAt: Date,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.incidentReport.updateMany({
      where: {
        id,
        classification: 'MATERIAL',
        seniorManagementNotifiedAt: null,
      },
      data: { seniorManagementNotifiedAt: notifiedAt },
    });
  }

  /** Write-once — legal once a classification decision exists (Material or
   * Non-Material); not before, since a not-yet-classified incident hasn't
   * yet determined whether affected data subjects even need notifying. */
  recordAffectedSubjectsNotified(
    id: string,
    notifiedAt: Date,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.incidentReport.updateMany({
      where: {
        id,
        classification: { not: 'NOT_YET_CLASSIFIED' },
        affectedDataSubjectsNotifiedAt: null,
      },
      data: { affectedDataSubjectsNotifiedAt: notifiedAt },
    });
  }
}

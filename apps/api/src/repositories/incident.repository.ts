import { Injectable } from '@nestjs/common';
import type { IncidentReport, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/** The one terminal state; everything else is still open. */
const CLOSED_INCIDENT_STATUS = 'CLOSED' as IncidentReport['status'];

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
/**
 * The combined-duty act, on every read and write that returns an incident.
 *
 * `IncidentReport_classification_maker_checker_distinct` requires that whoever CLASSIFIES an incident (the
 * DPO's judgement on whether it is a personal-data breach, which is what starts the statutory notification
 * clock) is not whoever co-signs that classification at senior-management level. **A classification is the
 * decision that a regulator and the affected data subjects either do or do not get told** — so whether two
 * people agreed is what the record exists to say, and the co-sign stamp reads as filled either way.
 *
 * Part 4 step 5: on the record, not only in the report at `/internal-controls`.
 */
const INCIDENT_INCLUDE = { classificationCombinedDutyAct: true } as const;

export type IncidentReportWithAct = Prisma.IncidentReportGetPayload<{
  include: typeof INCIDENT_INCLUDE;
}>;

@Injectable()
export class IncidentRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateIncidentInput): Promise<IncidentReportWithAct> {
    return this.prisma.client.incidentReport.create({
      include: INCIDENT_INCLUDE,
      data: {
        title: input.title,
        description: input.description,
        severity: input.severity,
      },
    });
  }

  findById(id: string): Promise<IncidentReportWithAct | null> {
    return this.prisma.client.incidentReport.findUnique({
      include: INCIDENT_INCLUDE,
      where: { id },
    });
  }

  /**
   * The open incident register (Part D §5.1 item #9) — same reasoning as
   * `DsrRepository.findOpenQueue`: filtered in SQL so an old unresolved
   * incident is never evicted by newer ones, ordered oldest first so a cap
   * truncates the least urgent tail rather than the most urgent head.
   */
  findOpenRegister(take: number): Promise<IncidentReportWithAct[]> {
    return this.prisma.client.incidentReport.findMany({
      include: INCIDENT_INCLUDE,
      where: { status: { not: CLOSED_INCIDENT_STATUS } },
      orderBy: { reportedAt: 'asc' },
      take,
    });
  }

  findMany(
    scope: IncidentScope,
    take: number,
  ): Promise<IncidentReportWithAct[]> {
    return this.prisma.client.incidentReport.findMany({
      include: INCIDENT_INCLUDE,
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
    /**
     * Part 4 — the declared combined-duty act, when the checker IS the maker in an office that has declared
     * COMBINED mode. Null on every ordinary two-person act. The column is what this pair's CHECK constraint
     * reads: with it null, a self-approval is refused by the database whatever the application decided.
     */
    combinedDutyActId: string | null = null,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.incidentReport.updateMany({
      where: {
        id,
        classification: 'MATERIAL',
        seniorManagementCoSignUserId: null,
      },
      data: {
        seniorManagementCoSignUserId,
        ...(combinedDutyActId === null
          ? {}
          : { classificationCombinedDutyActId: combinedDutyActId }),
      },
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

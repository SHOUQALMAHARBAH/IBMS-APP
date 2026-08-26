import { Injectable, Logger } from '@nestjs/common';
import type { SlaTimer } from '@ibms/db';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UserRepository } from '../../repositories/user.repository';
import { applyDuration } from '../../common/business-days.util';
import { getSlaRegistryEntry } from './sla-registry.config';

// Kept in sync with packages/db/prisma/seed.ts's SYSTEM_ACCOUNT_EMAIL — same
// convention as AccessRecertificationScheduler: AuditLogEntry.userId is a
// real FK to User, so a scheduled sweep needs a real (login-disabled) row to
// attribute its ESCALATE audit entries to.
const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

export interface StartSlaTimerParams {
  entityType: string;
  entityId: string;
  /** Must match an `SLA_REGISTRY` (sla-registry.config.ts) workflowName. */
  workflowName: string;
  /** The workflow's own SLA due date — the point every escalation stage's
   * `offset` is computed relative to. Callers that already have a
   * domain-specific due-date field (e.g. `DataSubjectRequest.slaDueAt`)
   * should pass that value; callers that don't can derive one with
   * `computeDueAt()` first. */
  dueAt: Date;
  actorUserId: string;
}

export interface ResolveSlaTimerParams {
  entityType: string;
  entityId: string;
  workflowName: string;
  actorUserId: string;
  resolvedAt?: Date;
}

/**
 * The generic, polymorphic SLA timer engine backlog A.8 asks for
 * (ibms-brain/meta/lex/pdpl-sla-timers.md — "Every workflow with a statutory
 * or contractual SLA carries the deadline as a queryable field with an
 * automated escalation job"). Backs the `SlaTimer` model (polymorphic
 * `entityType`/`entityId`, already migrated since the initial domain-model
 * migration — this is its first real consumer) and is driven by
 * `SLA_REGISTRY` (`sla-registry.config.ts`) for all 14 SLA types in that
 * lex table.
 *
 * **One `SlaTimer` row per escalation stage, not per workflow.** A row is
 * "one deadline plus the one target it escalates to if breached" — so a
 * workflow with N stages (only the two DSR types have more than one: an
 * early T-3-business-day DPO warning, then a General-Manager escalation at
 * the SLA due date itself) gets N rows sharing the same `entityType`/
 * `entityId`, distinguished by a `::`-suffixed `workflowName` per stage
 * (`stageWorkflowName()` below) — chosen over adding a stage column to
 * `SlaTimer` so this ships without another schema migration. A single-stage
 * workflow's row keeps the bare registry `workflowName`, unsuffixed.
 *
 * **`escalatedTo` is populated at `startTimer()` time, not at escalation
 * time.** It holds the stage's *planned* target from creation — the
 * `runEscalationSweep()` reaper only ever flips `escalatedAt`, so a still-open
 * timer already shows who it will escalate to before it's actually breached.
 * This is a deliberate reading of the schema comment ("role or user
 * escalated to"): the alternative (leaving it null until the sweep fires)
 * would make `SlaTimer` rows created for a workflow whose sweep hasn't run
 * yet indistinguishable from ones with no escalation target at all.
 *
 * **No domain module calls `startTimer()`/`resolve()` yet for 13 of the 14
 * registry entries** — same root cause as A.6/A.7: no Part C business
 * module (`DataSubjectRequestService`, `IncidentService`, etc.) exists to
 * call it from. The one exception:
 * `AccessRecertificationService.startCycle()` calls `startTimer()` for
 * `quarterly_access_review` — see README.md § Known gaps, A.8, for exactly
 * which workflows still only carry their SLA deadline on their own inline
 * field (`DataSubjectRequest.slaDueAt`, `DisposalBatch.slaDueAt`, etc.)
 * without a matching generic `SlaTimer` row yet.
 */
@Injectable()
export class SlaTimerService {
  private readonly logger = new Logger(SlaTimerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly users: UserRepository,
  ) {}

  /** Applies a registry workflow's `duration` (or, when `regulatoryChannel`
   * is true and the entry defines one, its `regulatoryChannelDuration` —
   * only `data_sharing_decision` does) to `baseDate`. A convenience for
   * callers with no domain-specific due-date rule of their own; callers
   * that do have one (most of the 14) should compute `dueAt` themselves and
   * pass it straight to `startTimer()` instead. */
  computeDueAt(
    workflowName: string,
    baseDate: Date,
    options?: { regulatoryChannel?: boolean },
  ): Date {
    const entry = getSlaRegistryEntry(workflowName);
    const duration =
      options?.regulatoryChannel && entry.regulatoryChannelDuration
        ? entry.regulatoryChannelDuration
        : entry.duration;
    return applyDuration(baseDate, duration);
  }

  /** Creates one `SlaTimer` row per escalation stage defined for
   * `workflowName` in `SLA_REGISTRY`, each due at `dueAt` offset by that
   * stage's (signed) `offset`. Returns the created rows in stage order. */
  async startTimer(params: StartSlaTimerParams): Promise<SlaTimer[]> {
    const { entityType, entityId, workflowName, dueAt, actorUserId } = params;
    const entry = getSlaRegistryEntry(workflowName);
    const stages = entry.escalationStages;
    const created: SlaTimer[] = [];

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      const stageWorkflowName =
        stages.length === 1
          ? workflowName
          : `${workflowName}::${(stage.escalateTo ?? `stage${i}`).toLowerCase()}`;
      const stageDueAt = applyDuration(dueAt, stage.offset);

      const timer = await this.prisma.client.slaTimer.create({
        data: {
          entityType,
          entityId,
          workflowName: stageWorkflowName,
          dueAt: stageDueAt,
          escalatedTo: stage.escalateTo,
        },
      });
      await this.audit.record({
        userId: actorUserId,
        action: 'CREATE',
        entityType,
        entityId,
        afterValue: {
          slaTimerId: timer.id,
          workflowName: stageWorkflowName,
          dueAt: stageDueAt.toISOString(),
          escalateTo: stage.escalateTo,
        },
      });
      created.push(timer);
    }

    return created;
  }

  /** Marks every still-open `SlaTimer` row for this entity+workflow (all
   * stages at once — a stage-suffixed workflowName still matches via
   * `startsWith`) resolved, e.g. because the underlying DSR/DisposalBatch/
   * IncidentReport/etc. reached its closing status. Writes one audit row
   * summarizing the count; writes nothing if there was nothing open. */
  async resolve(params: ResolveSlaTimerParams): Promise<{ count: number }> {
    const resolvedAt = params.resolvedAt ?? new Date();
    const result = await this.prisma.client.slaTimer.updateMany({
      where: {
        entityType: params.entityType,
        entityId: params.entityId,
        workflowName: { startsWith: params.workflowName },
        resolvedAt: null,
      },
      data: { resolvedAt },
    });

    if (result.count > 0) {
      await this.audit.record({
        userId: params.actorUserId,
        action: 'UPDATE',
        entityType: params.entityType,
        entityId: params.entityId,
        afterValue: {
          workflowName: params.workflowName,
          resolvedTimerCount: result.count,
          resolvedAt: resolvedAt.toISOString(),
        },
      });
    }

    return result;
  }

  /** The scheduled sweep (`SlaTimerScheduler`): escalates every unresolved,
   * not-yet-escalated `SlaTimer` row whose `dueAt` has passed. Guards each
   * write on `escalatedAt: null` (the same "guard right at the write"
   * philosophy as `WorkflowTransitionService.transition()` and
   * `maker-checker.util.ts`) so a concurrent sweep run can't double-escalate
   * the same row. Returns the rows this call actually escalated. */
  async runEscalationSweep(): Promise<SlaTimer[]> {
    const now = new Date();
    const due = await this.prisma.client.slaTimer.findMany({
      where: { resolvedAt: null, escalatedAt: null, dueAt: { lte: now } },
    });
    if (due.length === 0) return [];

    const systemUser = await this.users.findByEmail(SYSTEM_ACCOUNT_EMAIL);
    if (!systemUser) {
      this.logger.error(
        `${due.length} SLA timer(s) overdue but cannot escalate — system service account "${SYSTEM_ACCOUNT_EMAIL}" not found (has npm run db:seed been run?)`,
      );
      return [];
    }

    const escalated: SlaTimer[] = [];
    for (const timer of due) {
      const result = await this.prisma.client.slaTimer.updateMany({
        where: { id: timer.id, escalatedAt: null },
        data: { escalatedAt: now },
      });
      if (result.count === 0) continue; // already escalated by a concurrent sweep

      await this.audit.record({
        userId: systemUser.id,
        action: 'SLA_ESCALATED',
        entityType: timer.entityType,
        entityId: timer.entityId,
        afterValue: {
          slaTimerId: timer.id,
          workflowName: timer.workflowName,
          escalatedTo: timer.escalatedTo,
          dueAt: timer.dueAt.toISOString(),
        },
      });
      escalated.push({ ...timer, escalatedAt: now });
    }

    return escalated;
  }
}

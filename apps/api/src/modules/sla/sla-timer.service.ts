import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { SlaTimer } from '@ibms/db';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { UserRepository } from '../../repositories/user.repository';
import { applyDuration } from '../../common/business-days.util';
import type { SlaDurationUnit as SlaDurationUnitName } from '../../common/business-days.util';
import { SlaPolicyRepository } from '../../repositories/sla-policy.repository';
import {
  computePolicyDueAt,
  effectiveDueAt,
  holidaySet,
  remainingMs,
  slaStatus,
  type SlaStatus,
} from './sla-status.config';
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
  /** Only resolve rows created before this instant. For a caller re-basing a
   * deadline (start the new timer(s), then resolve the old ones) where the
   * new and old rows share the same `workflowName` prefix — so `resolve()`'s
   * own `startsWith` match would otherwise also catch rows `startTimer()`
   * just created a moment earlier. Omit for the ordinary case (resolving
   * everything open because the workflow itself concluded). */
  createdBefore?: Date;
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
    private readonly policies: SlaPolicyRepository,
  ) {}

  /** Applies a registry workflow's `duration` (or, when `regulatoryChannel`
   * is true and the entry defines one, its `regulatoryChannelDuration` —
   * only `data_sharing_decision` does) to `baseDate`. A convenience for
   * callers with no domain-specific due-date rule of their own; callers
   * that do have one (most of the 14) should compute `dueAt` themselves and
   * pass it straight to `startTimer()` instead. */
  /**
   * The due date for a workflow, FROM THE CONFIGURED POLICY.
   *
   * This is the integration point that makes SLAs actually configurable:
   * thirteen services already call it, so making it policy-aware makes every
   * one of them read the database instead of a compile-time constant, without
   * changing what any of them decide.
   *
   * ASYNC on purpose. A cached synchronous read was the tempting alternative
   * (`PermissionsService` caches the permission grid for 60s), but a stale
   * permission grid costs someone a retry and a stale SLA silently computes
   * the WRONG STATUTORY DEADLINE for up to the TTL. A compliance deadline is
   * not a good place to trade correctness for a saved round trip.
   *
   * Falls back to `SLA_REGISTRY` when no policy is configured, so an
   * un-seeded database behaves exactly as it did before.
   */
  async computeDueAt(
    workflowName: string,
    baseDate: Date,
    options?: { regulatoryChannel?: boolean; workflowState?: string | null },
  ): Promise<Date> {
    const { dueAt } = await this.resolveDueAt(workflowName, baseDate, options);
    return dueAt;
  }

  /** The registry-only computation, kept synchronous for the fallback path
   * and for callers that genuinely want the compile-time default (the seed
   * baseline, and tests that assert the default has not moved). */
  computeDueAtFromRegistry(
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

  /**
   * Due date from the CONFIGURED policy — the runtime path.
   *
   * Reads the active `SlaPolicy` for this process (and workflow state, where
   * one is configured), applies its duration across its own working calendar
   * including `SlaHoliday` rows, and returns the policy alongside the date so
   * the caller can record WHICH policy set the deadline on the timer.
   *
   * Falls back to the compile-time `SLA_REGISTRY` when no policy is
   * configured, which is what keeps every existing caller working on a
   * database that has not been seeded with policies yet. The fallback is a
   * bridge, not the design: `policy` comes back `null` so a caller (and the
   * timer row) can tell a configured deadline from a defaulted one.
   */
  async resolveDueAt(
    workflowName: string,
    baseDate: Date,
    options?: { regulatoryChannel?: boolean; workflowState?: string | null },
  ): Promise<{
    dueAt: Date;
    policy: Awaited<ReturnType<SlaPolicyRepository['findActiveFor']>>;
  }> {
    const policy = await this.policies.findActiveFor(
      workflowName,
      options?.workflowState ?? null,
      baseDate,
    );
    if (!policy) {
      return {
        dueAt: this.computeDueAtFromRegistry(workflowName, baseDate, options),
        policy: null,
      };
    }

    // M08's regulatory-channel fast track is a REGISTRY concept (a second
    // duration on one entry) that the policy table does not model — a policy
    // is one duration. Until it does, the fast track keeps its registry
    // value rather than silently being served the standard one, which would
    // LENGTHEN a deadline that exists to be shorter.
    if (options?.regulatoryChannel) {
      const entry = getSlaRegistryEntry(workflowName);
      if (entry.regulatoryChannelDuration) {
        return {
          dueAt: applyDuration(baseDate, entry.regulatoryChannelDuration),
          policy,
        };
      }
    }

    const holidays = holidaySet(await this.policies.findHolidays());
    return { dueAt: computePolicyDueAt(policy, baseDate, holidays), policy };
  }

  /** Creates one `SlaTimer` row per escalation stage defined for
   * `workflowName` in `SLA_REGISTRY`, each due at `dueAt` offset by that
   * stage's (signed) `offset`. Returns the created rows in stage order. */
  async startTimer(params: StartSlaTimerParams): Promise<SlaTimer[]> {
    const { entityType, entityId, workflowName, dueAt, actorUserId } = params;

    // Escalation stages come from the CONFIGURED policy when one exists,
    // falling back to the registry otherwise. Without this the stages stayed a
    // compile-time constant even though the table modelled them — the feature
    // would have looked configurable and quietly not been.
    const policy = await this.policies.findActiveFor(workflowName, null);
    const stages: readonly {
      offset: { value: number; unit: SlaDurationUnitName };
      escalateTo: string | null;
    }[] = policy
      ? policyStages(policy)
      : getSlaRegistryEntry(workflowName).escalationStages;

    // `escalationEnabled: false` keeps the DEADLINE tracked (a queryable,
    // sweep-checked row is the whole point of the registry) while suppressing
    // the stages that notify somebody. Turning escalation off must not turn
    // the SLA off.
    const effectiveStages =
      policy && !policy.escalationEnabled
        ? [
            {
              offset: { value: 0, unit: 'calendarDays' as const },
              escalateTo: null,
            },
          ]
        : stages;

    const created: SlaTimer[] = [];

    for (let i = 0; i < effectiveStages.length; i++) {
      const stage = effectiveStages[i];
      const stageWorkflowName =
        effectiveStages.length === 1
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
          // Which policy set this deadline. Recorded per timer so a HISTORICAL
          // one can still answer "was this regulatory or internal?" even after
          // the policy is later edited.
          slaPolicyId: policy?.id ?? null,
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
        ...(params.createdBefore
          ? { createdAt: { lt: params.createdBefore } }
          : {}),
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

  /**
   * PAUSE the clock. `dueAt` is NOT moved — accumulated pause is tracked
   * separately, so "when was this originally due?" and "how long did you
   * actually have?" stay separately answerable, which is the pair a regulator
   * asks about together.
   *
   * Status-conditional: pausing an already-paused or resolved timer matches 0
   * rows and 409s rather than silently restarting the accumulator.
   */
  async pause(
    timerId: string,
    reason: string,
    actorUserId: string,
  ): Promise<SlaTimer> {
    const now = new Date();
    const { count } = await this.prisma.client.slaTimer.updateMany({
      where: { id: timerId, pausedAt: null, resolvedAt: null },
      data: { pausedAt: now, pauseReason: reason },
    });
    if (count === 0) {
      throw new ConflictException(
        `SLA timer ${timerId} is already paused, or already resolved.`,
      );
    }
    const timer = await this.prisma.client.slaTimer.findUniqueOrThrow({
      where: { id: timerId },
    });
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: timer.entityType,
      entityId: timer.entityId,
      afterValue: {
        slaTimerId: timer.id,
        workflowName: timer.workflowName,
        event: 'SLA_PAUSED',
        pausedAt: now.toISOString(),
        // The stated basis is the control — a stopped compliance clock with
        // no reason is indistinguishable from one somebody forgot to restart.
        reason,
      },
    });
    return timer;
  }

  /** RESUME, banking the elapsed pause into `pausedTotalMs`. */
  async resume(timerId: string, actorUserId: string): Promise<SlaTimer> {
    const existing = await this.prisma.client.slaTimer.findUnique({
      where: { id: timerId },
    });
    if (!existing) {
      throw new NotFoundException(`SLA timer ${timerId} not found.`);
    }
    if (!existing.pausedAt) {
      throw new ConflictException(`SLA timer ${timerId} is not paused.`);
    }

    const now = new Date();
    const banked =
      existing.pausedTotalMs +
      Math.max(0, now.getTime() - existing.pausedAt.getTime());

    // Re-assert `pausedAt` so a concurrent resume cannot bank the same pause
    // twice (race-safe-invariants.md — the write re-asserts what was read).
    const { count } = await this.prisma.client.slaTimer.updateMany({
      where: { id: timerId, pausedAt: existing.pausedAt },
      data: { pausedAt: null, pausedTotalMs: banked, pauseReason: null },
    });
    if (count === 0) {
      throw new ConflictException(
        `SLA timer ${timerId} was resumed concurrently by another request.`,
      );
    }

    const timer = await this.prisma.client.slaTimer.findUniqueOrThrow({
      where: { id: timerId },
    });
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: timer.entityType,
      entityId: timer.entityId,
      afterValue: {
        slaTimerId: timer.id,
        workflowName: timer.workflowName,
        event: 'SLA_RESUMED',
        resumedAt: now.toISOString(),
        pausedTotalMs: banked,
      },
    });
    return timer;
  }

  /**
   * Where a timer stands right now, with the provenance of the deadline
   * attached.
   *
   * `isRegulatory` travels with the status on purpose: a screen showing
   * "BREACHED" needs to say whether what was breached is the law or an
   * internal target, and it must not have to guess.
   */
  async checkSlaStatus(timerId: string): Promise<{
    timerId: string;
    workflowName: string;
    status: SlaStatus;
    dueAt: string;
    effectiveDueAt: string;
    remainingMs: number | null;
    pausedTotalMs: number;
    isRegulatory: boolean;
    sourceType: string | null;
    policyCode: string | null;
  }> {
    const timer = await this.prisma.client.slaTimer.findUnique({
      where: { id: timerId },
      include: { slaPolicy: true },
    });
    if (!timer) throw new NotFoundException(`SLA timer ${timerId} not found.`);

    const now = new Date();
    const warning = timer.slaPolicy?.warningThreshold ?? 0.8;
    return {
      timerId: timer.id,
      workflowName: timer.workflowName,
      status: slaStatus(timer, now, warning),
      dueAt: timer.dueAt.toISOString(),
      effectiveDueAt: effectiveDueAt(timer, now).toISOString(),
      remainingMs: remainingMs(timer, now),
      pausedTotalMs: timer.pausedTotalMs,
      isRegulatory: timer.slaPolicy?.sourceType === 'REGULATORY',
      sourceType: timer.slaPolicy?.sourceType ?? null,
      policyCode: timer.slaPolicy?.policyCode ?? null,
    };
  }

  /**
   * Stamp `breachedAt` on everything now past its PAUSE-ADJUSTED deadline.
   *
   * Separate from `runEscalationSweep`, which fires on raw `dueAt`: a paused
   * timer is not breached, and recording a breach is a different fact from
   * notifying somebody about it. Conditional on `breachedAt: null` so a
   * re-run cannot re-stamp a breach with a later time.
   */
  async recordBreaches(): Promise<number> {
    const now = new Date();
    const open = await this.prisma.client.slaTimer.findMany({
      where: { resolvedAt: null, breachedAt: null, pausedAt: null },
      select: { id: true, dueAt: true, pausedTotalMs: true },
    });
    const overdue = open.filter(
      (t) => now.getTime() > t.dueAt.getTime() + t.pausedTotalMs,
    );
    if (overdue.length === 0) return 0;

    const { count } = await this.prisma.client.slaTimer.updateMany({
      where: { id: { in: overdue.map((t) => t.id) }, breachedAt: null },
      data: { breachedAt: now },
    });
    if (count > 0) {
      this.logger.warn(`Recorded ${count} SLA breach(es).`);
    }
    return count;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `SLA timer audit failed after the write committed: ${(err as Error).message}`,
      );
    }
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

/** Projects a policy's escalation rows into the shape `applyDuration` wants.
 * The DB spells units `BUSINESS_DAYS`; the date util spells them
 * `businessDays`, and the two vocabularies exist because the util predates the
 * table and serves callers that never touch a policy. */
function policyStages(policy: {
  escalations: {
    stageOrder: number;
    offsetValue: number;
    offsetUnit: string;
    escalateTo: string | null;
  }[];
}): {
  offset: { value: number; unit: SlaDurationUnitName };
  escalateTo: string | null;
}[] {
  const UNIT: Record<string, SlaDurationUnitName> = {
    MINUTES: 'minutes',
    HOURS: 'hours',
    BUSINESS_DAYS: 'businessDays',
    CALENDAR_DAYS: 'calendarDays',
    MONTHS: 'months',
  };
  return [...policy.escalations]
    .sort((a, b) => a.stageOrder - b.stageOrder)
    .map((e) => ({
      offset: {
        value: e.offsetValue,
        unit: UNIT[e.offsetUnit] ?? 'calendarDays',
      },
      escalateTo: e.escalateTo,
    }));
}

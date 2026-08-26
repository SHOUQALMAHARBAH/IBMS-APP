import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  getWorkflowDelegate,
  isWorkflowTransitionAllowed,
  allowedNextStatuses,
  WorkflowEntityType,
  WorkflowStatusMap,
} from './workflow-transitions.config';

export interface TransitionParams<E extends WorkflowEntityType> {
  entityType: E;
  entityId: string;
  toStatus: WorkflowStatusMap[E];
  /** The user driving this transition — recorded as the TRANSITION audit row's actor. */
  actorUserId: string;
  /** Extra columns to persist alongside the status change in the same write
   *  (e.g. `closedAt`, `approvedAt`). Must not include `status` itself. */
  data?: Record<string, unknown>;
  /** Runs after the status is persisted and the TRANSITION audit row is
   *  written — the extension point for a linked SLA timer, notification, or
   *  KPI recompute (ibms-brain/meta/lex/workflow-state-transitions.md
   *  rationale #2). Runs outside the status write; a failure here is logged,
   *  not thrown, so a notification/timer bug never rolls back — or hides —
   *  an already-committed, already-audited state change. */
  sideEffect?: (record: { id: string; status: string }) => Promise<void>;
}

/**
 * The one legal path to changing a workflow entity's `status` column
 * (ibms-brain/meta/lex/workflow-state-transitions.md — "Never assign a
 * workflow status field directly"). Validates the move against
 * `WORKFLOW_TRANSITIONS`, writes it, and records the TRANSITION
 * AuditLogEntry every direct write would silently skip.
 *
 * No domain module calls this yet — Policy/Claim/Opportunity/etc. services
 * don't exist in this repo yet (see CLAUDE.md "What's here today"). This is
 * the engine backlog item A.6 asks for, ready for those services to depend
 * on the moment they're built, instead of each reinventing (or skipping)
 * this validation independently.
 */
@Injectable()
export class WorkflowTransitionService {
  private readonly logger = new Logger(WorkflowTransitionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async transition<E extends WorkflowEntityType>(
    params: TransitionParams<E>,
  ): Promise<{ id: string; status: string }> {
    const { entityType, entityId, toStatus, actorUserId, data, sideEffect } =
      params;
    const delegate = getWorkflowDelegate(this.prisma.client, entityType);

    const current = await delegate.findUnique({ where: { id: entityId } });
    if (!current) {
      throw new NotFoundException(`${entityType} ${entityId} not found`);
    }
    const fromStatus = current.status as WorkflowStatusMap[E];

    if (fromStatus === (toStatus as unknown as WorkflowStatusMap[E])) {
      throw new UnprocessableEntityException(
        `${entityType} ${entityId}: already in status ${String(toStatus)}`,
      );
    }

    if (!isWorkflowTransitionAllowed(entityType, fromStatus, toStatus)) {
      const allowed = allowedNextStatuses(entityType, fromStatus);
      throw new UnprocessableEntityException(
        `${entityType} ${entityId}: cannot transition from ${String(fromStatus)} to ${String(toStatus)}. Allowed: ${
          allowed.length ? allowed.join(', ') : '(terminal state)'
        }`,
      );
    }

    // Conditional on the status observed above so a concurrent transition
    // landing between that read and this write loses the race explicitly
    // (count 0 below) instead of being silently overwritten — this
    // codebase has no established $transaction wrapper to serialize the
    // read+write as one unit instead (see maker-checker.util.ts for the
    // same "guard right at the write" philosophy applied elsewhere).
    const result = await delegate.updateMany({
      where: { id: entityId, status: fromStatus },
      data: { status: toStatus, ...data },
    });
    if (result.count === 0) {
      throw new ConflictException(
        `${entityType} ${entityId}: status changed concurrently — expected ${String(fromStatus)}`,
      );
    }

    const updated = await delegate.findUnique({ where: { id: entityId } });
    if (!updated) {
      // Deleted between the update above and this read — vanishingly
      // unlikely for these entities (none of the eleven support hard
      // delete), but fail loudly rather than return a fabricated record.
      throw new NotFoundException(
        `${entityType} ${entityId} not found immediately after transition`,
      );
    }

    await this.audit.record({
      userId: actorUserId,
      action: 'TRANSITION',
      entityType,
      entityId,
      beforeValue: { status: fromStatus },
      afterValue: { status: toStatus },
    });

    if (sideEffect) {
      try {
        await sideEffect(updated);
      } catch (err) {
        this.logger.error(
          `${entityType} ${entityId}: transition side effect failed after ${String(fromStatus)} -> ${String(toStatus)} (status change and audit row already committed)`,
          err as Error,
        );
      }
    }

    return updated;
  }
}

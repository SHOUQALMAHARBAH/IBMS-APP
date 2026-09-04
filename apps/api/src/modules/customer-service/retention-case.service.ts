import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { RetentionCaseRepository } from '../../repositories/retention-case.repository';
import {
  classifyRenewalCaseForRetention,
  deriveRetentionCaseView,
  retentionCaseAuditSnapshot,
  RETENTION_CASE_READ_LIMIT,
  type RetentionCaseView,
} from './retention-case.config';
import type { CreateRetentionCaseDto } from './dto/create-retention-case.dto';
import type { ListRetentionCasesQueryDto } from './dto/list-retention-cases-query.dto';

export interface RetentionSweepResult {
  scanned: number;
  openedRenewalInactivity: number;
  openedLapseRisk: number;
  failed: number;
}

/**
 * Process 46 — Customer Retention (backlog Part C #46, Domain E — closes the
 * domain). Opens a `RetentionCase` when a `RenewalCase` shows renewal
 * inactivity or lapse risk (`runSweep`, nightly + on-demand — backlog Part C
 * #46's one checkbox), and lets Sales / Manager also open one manually, read
 * the book, and close a resolved case.
 *
 * `RetentionCase.status` is a plain string (`open`/`closed`) — NOT a
 * `WorkflowTransitionService` entity, no maker/checker, no `SlaTimer` (a
 * retention nudge is not a PDPL deadline). `retention-case.manage`
 * (`[SALES_RELATIONSHIP_OFFICER, BRANCH_DEPARTMENT_MANAGER]`) is the sole
 * gate on every route — book-wide reads, the #41 / #42 / #44 / #45 shape.
 */
@Injectable()
export class RetentionCaseService {
  private readonly logger = new Logger(RetentionCaseService.name);

  constructor(
    private readonly repo: RetentionCaseRepository,
    private readonly audit: AuditService,
  ) {}

  // --- 1. manual open -------------------------------------------------

  async create(
    dto: CreateRetentionCaseDto,
    actorUserId: string,
  ): Promise<RetentionCaseView> {
    if (!(await this.repo.customerExists(dto.customerId))) {
      throw new NotFoundException(`Customer ${dto.customerId} not found.`);
    }

    const row = await this.repo.create({
      customerId: dto.customerId,
      reason: dto.reason,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'RetentionCase',
      entityId: row.id,
      afterValue: retentionCaseAuditSnapshot({
        retentionCaseId: row.id,
        customerId: row.customerId,
        reason: row.reason,
        status: row.status,
      }),
    });

    return deriveRetentionCaseView(row);
  }

  // --- 2. the detection sweep (backlog Part C #46's automatic-open) --

  /**
   * Shared by the nightly `RetentionSweepScheduler` and the on-demand
   * `POST /retention-cases/sweep`. For each `RenewalCase` not yet escalated
   * whose renewal cycle has not concluded: classify it (pure,
   * `classifyRenewalCaseForRetention`); if it is due, race-safe stamp
   * `RenewalCase.retentionEscalatedAt` (conditional on it still being null —
   * `ibms-brain/meta/lex/race-safe-invariants.md`) and, only if this run won
   * that stamp, create the `RetentionCase`. Per-row isolation — one bad row
   * must not abandon the rest of the sweep (the #9 / #12 / #27 shape).
   */
  async runSweep(actorUserId: string): Promise<RetentionSweepResult> {
    const now = new Date();
    const candidates = await this.repo.findRenewalCasesForSweep();

    let openedRenewalInactivity = 0;
    let openedLapseRisk = 0;
    let failed = 0;

    for (const renewalCase of candidates) {
      const reason = classifyRenewalCaseForRetention(
        { status: renewalCase.status, triggeredAt: renewalCase.triggeredAt },
        now,
      );
      if (reason === null) continue;

      try {
        const stamped = await this.repo.stampRetentionEscalation(
          renewalCase.id,
          now,
        );
        if (stamped.count === 0) continue; // a concurrent / prior run already escalated this case

        const row = await this.repo.create({
          customerId: renewalCase.policy.customerId,
          reason,
        });
        if (reason === 'renewal_inactivity') openedRenewalInactivity += 1;
        else openedLapseRisk += 1;

        await this.safeAudit({
          userId: actorUserId,
          action: 'CREATE',
          entityType: 'RetentionCase',
          entityId: row.id,
          afterValue: retentionCaseAuditSnapshot({
            retentionCaseId: row.id,
            customerId: row.customerId,
            reason: row.reason,
            status: row.status,
          }),
        });
      } catch (err) {
        failed += 1;
        this.logger.error(
          `Retention sweep: RenewalCase ${renewalCase.id} failed (${(err as Error).message}) — continuing; next run will retry.`,
        );
      }
    }

    return {
      scanned: candidates.length,
      openedRenewalInactivity,
      openedLapseRisk,
      failed,
    };
  }

  // --- 3. close --------------------------------------------------------

  async close(id: string, actorUserId: string): Promise<RetentionCaseView> {
    const existing = await this.mustFind(id);
    if (existing.status === 'closed') {
      return deriveRetentionCaseView(existing); // idempotent
    }
    if (existing.status !== 'open') {
      throw new UnprocessableEntityException(
        `Retention case ${id} is ${existing.status} — it cannot be closed.`,
      );
    }

    const closedAt = new Date();
    const res = await this.repo.recordClosure(id, closedAt);
    if (res.count === 0) {
      const now = await this.mustFind(id);
      return deriveRetentionCaseView(now); // already closed concurrently
    }

    const after = await this.mustFind(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'RetentionCase',
      entityId: after.id,
      afterValue: retentionCaseAuditSnapshot({
        retentionCaseId: after.id,
        customerId: after.customerId,
        reason: after.reason,
        status: after.status,
      }),
    });
    return deriveRetentionCaseView(after);
  }

  // --- reads -----------------------------------------------------

  async get(id: string): Promise<RetentionCaseView> {
    return deriveRetentionCaseView(await this.mustFind(id));
  }

  async list(query: ListRetentionCasesQueryDto): Promise<RetentionCaseView[]> {
    const rows = await this.repo.findMany(
      {
        customerId: query.customerId,
        status: query.status,
        reason: query.reason,
      },
      RETENTION_CASE_READ_LIMIT,
    );
    if (rows.length >= RETENTION_CASE_READ_LIMIT) {
      this.logger.warn(
        `Retention-case list truncated at ${RETENTION_CASE_READ_LIMIT} rows — narrow with customerId / status / reason.`,
      );
    }
    return rows.map((r) => deriveRetentionCaseView(r));
  }

  // --- helpers -------------------------------------------------

  private async mustFind(id: string) {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(`Retention case ${id} not found.`);
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Retention-case audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}

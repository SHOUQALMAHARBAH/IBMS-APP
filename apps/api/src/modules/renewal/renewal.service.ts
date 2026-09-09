import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type RenewalCase, type RenewalStatus } from '@ibms/db';
import { RenewalCaseRepository } from '../../repositories/renewal-case.repository';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { SlaTimerService } from '../sla/sla-timer.service';
import { LossRatioService } from '../loss-ratio/loss-ratio.service';
import {
  DEFAULT_RENEWAL_LEAD_TIME_DAYS,
  deriveRenewalCaseView,
  isOpenRenewalStatus,
  renewalCaseAuditSnapshot,
  renewalDueAt,
  type RenewalCaseView,
} from './renewal.config';

export interface RenewalSweepResult {
  scanned: number;
  opened: number;
  skippedAlreadyOpen: number;
  failed: number;
}

/**
 * Part 3.9 — Renewal Management. The module `IMPROVEMENTS.md` §3.6 records as
 * "not existing now blocks THREE things":
 *
 *  1. `LossRatioService.recomputeForPolicy` upserts a `LossRatio` per
 *     `RenewalCase` and was a logged no-op in every environment, because no
 *     policy had one. Opening a case here gives it a parent, and the case
 *     opening triggers the first recompute.
 *  2. `RetentionCaseService.runSweep` (Process 46) reads
 *     `RenewalCase.status`/`.triggeredAt` to auto-open a retention case on
 *     lapse risk or renewal inactivity — entirely inert without a producer.
 *  3. `renewal_workflow_start` was one of only two `SLA_REGISTRY` entries
 *     with no caller anywhere, which Part G's "every SLA timer has an actual
 *     escalation job, not a text note" gate fails on.
 *
 * SCOPE — deliberately the TRIGGER and the LIFECYCLE, not a second copy of
 * Domain B. A renewal that goes to market re-uses the existing
 * Opportunity → RFQ → Quotation → Comparison → Recommendation chain
 * (`RenewalCase.opportunity` is already in the schema for exactly that); this
 * module opens the case, walks its status, and carries the two re-marketing
 * trigger flags. Building a parallel renewal-quotation stack would be the
 * two-sources-of-truth mistake `IMPROVEMENTS.md` §3.1 already records once.
 *
 * `RenewalCase` IS a `WorkflowTransitionService` entity — its map has existed
 * in `WORKFLOW_TRANSITIONS` since A.6 with no caller. Status moves ONLY
 * through the engine. No maker/checker: opening and progressing a renewal is
 * single-actor Sales/Placement work (`maker-checker-segregation.md` § "what
 * does NOT trigger this rule"); the approval gate on a renewal that goes to
 * market is the existing Broker Recommendation (#16).
 */
@Injectable()
export class RenewalService {
  private readonly logger = new Logger(RenewalService.name);

  constructor(
    private readonly cases: RenewalCaseRepository,
    private readonly workflow: WorkflowTransitionService,
    private readonly sla: SlaTimerService,
    private readonly lossRatio: LossRatioService,
    private readonly audit: AuditService,
  ) {}

  // --- 1. detection sweep ------------------------------------------------

  /**
   * Open a `RenewalCase` for every ACTIVE policy inside the lead-time window
   * that has none. Per-row isolated (the `CrossSellDetectionScheduler` /
   * `ClaimFollowUpScheduler` shape) — one bad row never aborts the sweep.
   */
  async runSweep(
    actorUserId: string,
    leadTimeDays = DEFAULT_RENEWAL_LEAD_TIME_DAYS,
  ): Promise<RenewalSweepResult> {
    const windowEnd = new Date();
    windowEnd.setUTCDate(windowEnd.getUTCDate() + leadTimeDays);

    const candidates = await this.cases.findRenewalCandidates(windowEnd);
    const result: RenewalSweepResult = {
      scanned: candidates.length,
      opened: 0,
      skippedAlreadyOpen: 0,
      failed: 0,
    };

    for (const candidate of candidates) {
      try {
        const opened = await this.openCase(
          candidate.id,
          leadTimeDays,
          actorUserId,
        );
        if (opened) result.opened += 1;
        else result.skippedAlreadyOpen += 1;
      } catch (err) {
        result.failed += 1;
        this.logger.error(
          `Renewal sweep: policy ${candidate.id} failed — ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Renewal sweep: scanned=${result.scanned} opened=${result.opened} skipped=${result.skippedAlreadyOpen} failed=${result.failed}`,
    );
    return result;
  }

  /**
   * Create the case. Returns false when one already existed — `P2002` on
   * `RenewalCase.policyId @unique` is the race gate, so a concurrent sweep
   * counts a skip rather than failing (`race-safe-invariants.md`).
   */
  private async openCase(
    policyId: string,
    leadTimeDays: number,
    actorUserId: string,
  ): Promise<boolean> {
    let created: RenewalCase;
    try {
      created = await this.cases.create({ policyId, leadTimeDays });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return false;
      }
      throw err;
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'RenewalCase',
      entityId: created.id,
      afterValue: renewalCaseAuditSnapshot(created),
    });

    // Both of the following are best-effort: the case row is the
    // authoritative record and has already committed, so neither a timer nor
    // a loss-ratio failure may turn a successful open into a reported error
    // (the #29 `lossRatio.recomputeForPolicy` precedent).
    await this.startRenewalTimer(
      created.id,
      policyId,
      leadTimeDays,
      actorUserId,
    );
    await this.recomputeLossRatio(policyId, actorUserId);
    return true;
  }

  private async startRenewalTimer(
    renewalCaseId: string,
    policyId: string,
    leadTimeDays: number,
    actorUserId: string,
  ): Promise<void> {
    try {
      const withPolicy = await this.cases.findByPolicyId(policyId);
      // The SLA is "the renewal workflow must have STARTED by `leadTimeDays`
      // before expiry" — a point counted BACK from expiry, not forward from
      // now, which is why `computeSlaDueAt()` (forward-from-now) is not used
      // here. The registry entry's own comment says a caller with a
      // non-default lead time passes its own `dueAt`; this one always does.
      const dueAt = renewalDueAt(
        withPolicy?.policy.expiryDate ?? null,
        leadTimeDays,
      );
      if (!dueAt) {
        this.logger.warn(
          `Renewal case ${renewalCaseId}: policy ${policyId} has no expiry date — no renewal_workflow_start timer started.`,
        );
        return;
      }
      await this.sla.startTimer({
        entityType: 'RenewalCase',
        entityId: renewalCaseId,
        workflowName: 'renewal_workflow_start',
        dueAt,
        actorUserId,
      });
    } catch (err) {
      this.logger.error(
        `Renewal case ${renewalCaseId}: renewal_workflow_start timer did not start — ${(err as Error).message}`,
      );
    }
  }

  private async recomputeLossRatio(
    policyId: string,
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.lossRatio.recomputeForPolicy(
        policyId,
        { reason: 'renewal-case-opened' },
        actorUserId,
      );
    } catch (err) {
      this.logger.error(
        `Renewal case for policy ${policyId}: loss-ratio recompute failed — ${(err as Error).message}`,
      );
    }
  }

  // --- 2. reads ----------------------------------------------------------

  async list(filter: {
    customerId?: string;
    policyId?: string;
  }): Promise<RenewalCaseView[]> {
    const rows = await this.cases.findMany(filter);
    return rows.map(deriveRenewalCaseView);
  }

  async get(id: string): Promise<RenewalCaseView> {
    const row = await this.cases.findById(id);
    if (!row) throw new NotFoundException(`Renewal case ${id} not found.`);
    return deriveRenewalCaseView(row);
  }

  // --- 3. lifecycle ------------------------------------------------------

  async transition(
    id: string,
    toStatus: RenewalStatus,
    actorUserId: string,
  ): Promise<RenewalCaseView> {
    const row = await this.cases.findById(id);
    if (!row) throw new NotFoundException(`Renewal case ${id} not found.`);
    if (row.status === toStatus) return deriveRenewalCaseView(row); // idempotent

    // The engine validates the move against WORKFLOW_TRANSITIONS.RenewalCase
    // and writes the TRANSITION audit row; its status-conditional updateMany
    // is the race gate. Loud, never best-effort — a renewal that silently
    // fails to advance is a renewal nobody works.
    await this.workflow.transition({
      entityType: 'RenewalCase',
      entityId: id,
      toStatus,
      actorUserId,
    });

    // Terminal — the workflow concluded, so its SLA timer is resolved. Both
    // LAPSED and CANCELLED count: the deadline was "start the renewal
    // workflow", and a case that reached a terminal state was worked.
    if (!isOpenRenewalStatus(toStatus)) {
      try {
        await this.sla.resolve({
          entityType: 'RenewalCase',
          entityId: id,
          workflowName: 'renewal_workflow_start',
          actorUserId,
        });
      } catch (err) {
        this.logger.error(
          `Renewal case ${id}: renewal_workflow_start timer did not resolve — ${(err as Error).message}`,
        );
      }
    }

    return this.get(id);
  }

  async setFlags(
    id: string,
    flags: {
      riskChangedSinceLastRenewal?: boolean;
      insurerTermsWorsened?: boolean;
    },
    actorUserId: string,
  ): Promise<RenewalCaseView> {
    const row = await this.cases.findById(id);
    if (!row) throw new NotFoundException(`Renewal case ${id} not found.`);
    if (
      flags.riskChangedSinceLastRenewal === undefined &&
      flags.insurerTermsWorsened === undefined
    ) {
      throw new UnprocessableEntityException(
        'Supply at least one of riskChangedSinceLastRenewal / insurerTermsWorsened.',
      );
    }
    if (!isOpenRenewalStatus(row.status)) {
      throw new UnprocessableEntityException(
        `Renewal case ${id} is ${row.status}; the re-marketing triggers are set while the case is still open.`,
      );
    }

    const updated = await this.cases.updateFlags(id, flags);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'RenewalCase',
      entityId: id,
      beforeValue: renewalCaseAuditSnapshot(row),
      afterValue: renewalCaseAuditSnapshot(updated),
    });
    return this.get(id);
  }

  /** Audit failures never fail the request — the write has already committed
   * (the `safeAudit` pattern used across this codebase). */
  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Renewal audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed: ${(err as Error).message}`,
      );
    }
  }
}

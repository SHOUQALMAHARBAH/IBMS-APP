import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import { LossRatioRepository } from '../../repositories/loss-ratio.repository';
import { computeLossRatio, lossRatioAuditSnapshot } from './loss-ratio.config';

export interface LossRatioRecomputeResult {
  recomputed: boolean;
  /** why a recompute was skipped, when `recomputed` is false */
  reason?: 'policy-not-found' | 'no-renewal-case';
  /** the recomputed ratio, 4 dp, when `recomputed` is true */
  ratio?: string;
  /** true when `ratio` was clamped to fit `LossRatio.ratio @db.Decimal(7, 4)` */
  ratioCapped?: boolean;
}

/**
 * Process 29 — the Loss Ratio recompute a claim closure triggers
 * (`ibms-brain/meta/context/claims-lifecycle.md` — Loss Ratio is an input the
 * renewal workflow depends on, computed and surfaced BEFORE the renewal
 * recommendation is drafted).
 *
 * `LossRatio` is **renewal-case-scoped** (`renewalCaseId @unique`, 1:1 with the
 * `Policy`), so this recomputes and upserts the `LossRatio` row for the
 * policy's `RenewalCase` — and if the policy has no `RenewalCase` yet (the
 * renewal module is not built), it is a logged no-op. A standalone per-claim /
 * per-policy loss ratio is deliberately NOT created off to the side.
 *
 * TODO(renewal): the renewal module owns whether a `RenewalCase` in a terminal
 * status (`RENEWED` / `LAPSED` / `CANCELLED`) should still receive recomputes —
 * `loadPolicyForRecompute` selects the `RenewalCase` with no status filter today.
 */
@Injectable()
export class LossRatioService {
  private readonly logger = new Logger(LossRatioService.name);

  constructor(
    private readonly repo: LossRatioRepository,
    private readonly audit: AuditService,
  ) {}

  async recomputeForPolicy(
    policyId: string,
    trigger: { reason: string; claimId?: string },
    actorUserId: string,
  ): Promise<LossRatioRecomputeResult> {
    const policy = await this.repo.loadPolicyForRecompute(policyId);

    if (!policy) {
      this.logger.warn(
        `Loss Ratio recompute skipped — policy ${policyId} not found (${trigger.reason})`,
      );
      return { recomputed: false, reason: 'policy-not-found' };
    }

    if (policy.renewalCaseId == null) {
      // Expected today — the renewal module (Part 3.9) is not built, so no
      // policy has a RenewalCase yet. The closed claim's own CLOSED
      // ClaimStatusHistory row is the durable trigger record; the renewal
      // workflow will recompute from it when it lands.
      this.logger.log(
        `Loss Ratio recompute for policy ${policyId} deferred — no renewal case (${trigger.reason})`,
      );
      return { recomputed: false, reason: 'no-renewal-case' };
    }

    const figures = computeLossRatio({
      claimNetSettlements: policy.claimNetSettlements,
      periodPremium: policy.premium,
    });

    const row = await this.repo.upsertLossRatio(policy.renewalCaseId, figures);

    // The LossRatio row has already committed — an audit failure here must NOT
    // rethrow (it would surface at the caller as "the recompute did not run",
    // which is false). Same "the real write already happened" shape as
    // ClaimService.safeAudit.
    await this.recordAuditBestEffort({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'LossRatio',
      entityId: row.id,
      afterValue: lossRatioAuditSnapshot({
        lossRatioId: row.id,
        renewalCaseId: policy.renewalCaseId,
        policyId,
        trigger: trigger.reason,
        claimId: trigger.claimId ?? null,
        figures,
      }),
    });

    const ratioStr = figures.ratio.toFixed(4);
    if (figures.ratioCapped) {
      this.logger.warn(
        `Loss Ratio for policy ${policyId} exceeded the column maximum and was capped at ${ratioStr} (${trigger.reason}) — claims ${figures.periodClaims.toFixed(
          3,
        )} vs premium ${figures.periodPremium.toFixed(3)}`,
      );
    } else {
      this.logger.log(
        `Loss Ratio recomputed for policy ${policyId}: ${ratioStr} (${trigger.reason})`,
      );
    }
    return {
      recomputed: true,
      ratio: ratioStr,
      ratioCapped: figures.ratioCapped,
    };
  }

  private async recordAuditBestEffort(input: {
    userId: string;
    action: 'UPDATE';
    entityType: string;
    entityId: string;
    afterValue: Prisma.InputJsonObject;
  }): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Loss Ratio ${input.entityId} recomputed but its ${input.action} audit row did not write: ${(err as Error).message}`,
      );
    }
  }
}

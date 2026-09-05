import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { PolicyStatus } from '@ibms/db';
import { PolicyRepository } from '../../repositories/policy.repository';
import type { PolicyWithContext } from '../../repositories/policy.repository';
import { PolicyCheckingRepository } from '../../repositories/policy-checking.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { assertDifferentActors } from '../../common/maker-checker.util';
import { assertCoverageFigures } from './policy.config';
import {
  diffCoverage,
  piRiskEventDescription,
  policyCheckingAuditSnapshot,
  type CoverageSnapshot,
} from './policy-checking.config';
import { PolicyService, type PolicyView } from './policy.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { RecordPolicyCheckingDto } from './dto/record-policy-checking.dto';

/** Statuses a check can start from: the first check off `ISSUED`, a re-check
 * off `DISCREPANCY`, or a resumed walk that stalled at `CHECKING_IN_PROGRESS`
 * (best-effort transitions — see `driveCheckingOutcome`). */
const CHECKABLE_FROM: readonly PolicyStatus[] = [
  'ISSUED',
  'DISCREPANCY',
  'CHECKING_IN_PROGRESS',
];

/**
 * Process 20 — Policy Checking / Quality Control (backlog Part C #20, Domain
 * B).
 *
 *  - `check` — the **mandatory maker/checker** line-by-line comparison of
 *    Requested Coverage vs the issued `PolicySchedule` (`limits` /
 *    `sumsInsured` / `namedPerils` / `extensions`). The checker is never the
 *    officer who placed the cover (`assertDifferentActors` +
 *    the `PolicyChecking_maker_checker_distinct` DB CHECK). `diffCoverage`
 *    (pure) derives `discrepancyFound` — the caller does not assert it. On a
 *    discrepancy the check records `PolicyChecking.discrepancyFound = true`,
 *    auto-logs a linked `ProfessionalIndemnityRiskEvent` (in the same
 *    transaction as the checking row — Process 54), and drives the `Policy`
 *    to `DISCREPANCY`; a clean check drives it to `VERIFIED`. Delivery
 *    (Process 21) is blocked from `DISCREPANCY` **structurally** — the
 *    `WORKFLOW_TRANSITIONS.Policy` map only allows `DISCREPANCY ->
 *    CHECKING_IN_PROGRESS`, never `-> DELIVERED`.
 *
 * `PolicyChecking` is NOT a `WorkflowTransitionService` entity (no `status`
 * column — its lifecycle is the parent `Policy`'s status). The status walk
 * `(ISSUED | DISCREPANCY) -> CHECKING_IN_PROGRESS -> (VERIFIED | DISCREPANCY)`
 * goes through the engine and is best-effort (logged, never thrown — the
 * `PolicyChecking` row + `diffCoverage` is the authoritative QC record); a
 * re-call from a stalled `CHECKING_IN_PROGRESS` self-heals.
 */
@Injectable()
export class PolicyCheckingService {
  private readonly logger = new Logger(PolicyCheckingService.name);

  constructor(
    private readonly checkings: PolicyCheckingRepository,
    private readonly policies: PolicyRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
    private readonly policyService: PolicyService,
  ) {}

  /** Logged, not thrown — the real write already committed. */
  private async safeAudit(
    input: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `PolicyChecking audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed`,
        err as Error,
      );
    }
  }

  /** The current open coverage schedule (`effectiveTo` null) — what the
   * insurer actually issued (#19). */
  private currentSchedule(policy: PolicyWithContext) {
    return policy.schedules.find((s) => s.effectiveTo === null) ?? null;
  }

  /**
   * Walk the `Policy` to the check's outcome: `(ISSUED | DISCREPANCY) ->
   * CHECKING_IN_PROGRESS -> (VERIFIED | DISCREPANCY)`. Re-reads the live
   * status before every hop (self-healing under a concurrent move / a stalled
   * prior walk); best-effort per hop (logged, never thrown — the
   * `PolicyChecking` row is the authoritative record). Bounded loop.
   *
   * The ONE exception: a **discrepancy** outcome that can no longer be applied
   * (a concurrent divergent check verified the policy first, and the map has
   * no `VERIFIED -> ...` edge back onto the checking path) is a hard
   * `ConflictException`, not a swallowed warn — otherwise a policy could sit
   * at `VERIFIED` with `discrepancyFound = true` and its PI risk event logged,
   * yet Delivery unblocked: the exact failure mode Process 20 exists to catch.
   * The `PolicyChecking` row + PI event stay on record; the 409 forces manual
   * resolution. (`/brain-gap` filed — the residual is a concurrent-divergent
   * `recordChecking` last-write-wins race on `discrepancyFound` itself, which
   * per-policy serialisation would need to fully close.)
   */
  private async driveCheckingOutcome(
    policyId: string,
    discrepancyFound: boolean,
    actorUserId: string,
  ): Promise<void> {
    const outcome: PolicyStatus = discrepancyFound ? 'DISCREPANCY' : 'VERIFIED';
    for (let hop = 0; hop <= 2; hop += 1) {
      const policy = await this.policies.findStatus(policyId);
      if (!policy || policy.status === outcome) return;

      let next: PolicyStatus;
      if (policy.status === 'ISSUED' || policy.status === 'DISCREPANCY') {
        next = 'CHECKING_IN_PROGRESS';
      } else if (policy.status === 'CHECKING_IN_PROGRESS') {
        next = outcome;
      } else if (discrepancyFound) {
        throw new ConflictException(
          `Policy ${policyId} is ${policy.status} and can no longer be moved to DISCREPANCY — it was concurrently verified while this check found a discrepancy. The check and its PI risk event are on record; resolve the conflict manually.`,
        );
      } else {
        this.logger.warn(
          `Policy ${policyId}: status ${policy.status} is not on the checking path — not advancing.`,
        );
        return;
      }

      try {
        await this.workflow.transition({
          entityType: 'Policy',
          entityId: policyId,
          toStatus: next,
          actorUserId,
        });
      } catch (err) {
        this.logger.warn(
          `Policy ${policyId}: checking step -> ${next} did not apply: ${(err as Error).message}`,
        );
        return;
      }
    }
  }

  async check(
    policyId: string,
    dto: RecordPolicyCheckingDto,
    actor: AuthenticatedUser,
  ): Promise<PolicyView> {
    const policy = await this.policyService.loadVisible(policyId, actor);

    if (policy.placedByUserId === null) {
      throw new UnprocessableEntityException(
        `Policy ${policyId} has no recorded placing officer — maker/checker on the policy check cannot be enforced.`,
      );
    }
    // Maker/checker (Part 5.2 — "Policy Checking must be performed by someone
    // other than whoever requested/placed the cover"). The DB CHECK
    // `PolicyChecking_maker_checker_distinct` is the structural backstop for
    // the placer pairing. `assertDifferentActors` also rejects the officer who
    // recorded the issuance (#19) — they transcribed the "issued" side this
    // check compares against; `maker-checker-segregation.md` maps only the
    // placer today, so this is a stricter-than-lex belt (`/brain-gap` filed to
    // decide whether the DB CHECK should extend to `issuedByUserId` too).
    assertDifferentActors(
      policy.placedByUserId,
      actor.id,
      'PolicyChecking.check (placing officer)',
    );
    if (policy.issuedByUserId !== null) {
      assertDifferentActors(
        policy.issuedByUserId,
        actor.id,
        'PolicyChecking.check (issuing officer)',
      );
    }

    if (!CHECKABLE_FROM.includes(policy.status)) {
      throw new UnprocessableEntityException(
        `Policy ${policyId} is ${policy.status}; a policy is checked from ISSUED (or re-checked from DISCREPANCY).`,
      );
    }

    const schedule = this.currentSchedule(policy);
    if (!schedule) {
      throw new UnprocessableEntityException(
        `Policy ${policyId} has no issued coverage schedule to check against.`,
      );
    }

    const requested: CoverageSnapshot = {
      limits: assertCoverageFigures(
        dto.requestedCoverage.limits,
        'requestedCoverage.limits',
      ),
      sumsInsured: assertCoverageFigures(
        dto.requestedCoverage.sumsInsured,
        'requestedCoverage.sumsInsured',
      ),
      namedPerils: dto.requestedCoverage.namedPerils ?? [],
      extensions: dto.requestedCoverage.extensions ?? [],
    };
    const issued: CoverageSnapshot = {
      limits: (schedule.limits ?? {}) as Record<string, unknown>,
      sumsInsured: (schedule.sumsInsured ?? {}) as Record<string, unknown>,
      namedPerils: schedule.namedPerils,
      extensions: schedule.extensions,
    };
    const diff = diffCoverage(requested, issued);

    const piPolicyId = diff.discrepancyFound
      ? await this.checkings.findLatestPiPolicyId()
      : null;

    let checking: Awaited<
      ReturnType<PolicyCheckingRepository['recordChecking']>
    >;
    try {
      checking = await this.checkings.recordChecking({
        policyId,
        placedByUserId: policy.placedByUserId,
        checkedByUserId: actor.id,
        checklist: diff.checklist,
        discrepancyFound: diff.discrepancyFound,
        discrepancyDetail: diff.discrepancyFound ? diff.summary : null,
        piRiskEvent: diff.discrepancyFound
          ? {
              description: piRiskEventDescription(
                policy.policyNumber,
                policyId,
                diff.summary,
              ),
              piPolicyId,
            }
          : null,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Two simultaneous first checks on one policy — `policyId @unique` on
        // `PolicyChecking` rejected the loser. Map to 409, like
        // `PolicyService.place`.
        throw new ConflictException(
          `Policy ${policyId} is being checked concurrently — retry.`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actor.id,
      action: diff.discrepancyFound ? 'REJECT' : 'APPROVE',
      entityType: 'PolicyChecking',
      entityId: checking.id,
      afterValue: policyCheckingAuditSnapshot({
        policyId,
        placedByUserId: policy.placedByUserId,
        checkedByUserId: actor.id,
        discrepancyFound: diff.discrepancyFound,
        mismatchCount: diff.mismatchCount,
        discrepancyLoggedAsPiRiskEvent: checking.discrepancyLoggedAsPiRiskEvent,
      }),
    });

    await this.driveCheckingOutcome(policyId, diff.discrepancyFound, actor.id);

    return this.policyService.get(policyId, actor);
  }
}

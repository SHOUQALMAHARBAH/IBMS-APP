import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { EndorsementStatus, PolicyStatus } from '@ibms/db';
import {
  EndorsementRepository,
  type EndorsementWithContext,
} from '../../repositories/endorsement.repository';
import { PolicyRepository } from '../../repositories/policy.repository';
import { RecommendationRepository } from '../../repositories/recommendation.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { CommissionLedgerService } from '../commission/commission-ledger.service';
import { CUSTOMER_FILE_CROSS_OWNER_ROLES } from '../../common/rbac-visibility.util';
import { assertDifferentActors } from '../../common/maker-checker.util';
import {
  compareMoney,
  formatMoney,
  quantizeMoney,
} from '../../common/money.util';
import {
  assertCoverageFigures,
  parseCalendarDate,
} from '../policy/policy.config';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import {
  CANCELLATION_CHANGE_TYPE,
  cancellationAuditSnapshot,
  cancellationReturnPremium,
  commissionReversalAmount,
  commissionReversalAuditSnapshot,
  endorsementAuditSnapshot,
  refundAuditSnapshot,
  refundNeedsApproval,
  signedPremiumAdjustment,
} from './endorsement.config';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateEndorsementDto } from './dto/create-endorsement.dto';
import type { CreateCancellationDto } from './dto/create-cancellation.dto';
import type {
  AdvanceEndorsementDto,
  CalculateAdjustmentDto,
} from './dto/endorsement-step.dto';

const CROSS_OWNER_ROLES: readonly string[] = [
  ...CUSTOMER_FILE_CROSS_OWNER_ROLES,
  'FINANCE_COLLECTIONS_OFFICER',
];

export interface EndorsementView {
  id: string;
  policyId: string;
  customerId: string;
  type: string;
  changeType: string;
  status: EndorsementStatus;
  premiumAdjustment: string;
  requestedByUserId: string;
  submittedToInsurerAt: Date | null;
  insurerConfirmedAt: Date | null;
  financialAdjustmentCalculatedAt: Date | null;
  appliedAt: Date | null;
  clientNotifiedAt: Date | null;
  cancellation: {
    reason: string;
    basis: string;
    returnPremium: string;
    clientNotifiedAt: Date | null;
  } | null;
  refund: {
    id: string;
    amount: string;
    reason: string;
    raisedByUserId: string;
    approvedByUserId: string | null;
    approvalThresholdMatrixLevel: string | null;
    paidAt: Date | null;
    needsApproval: boolean;
  } | null;
  commissionReversal: { amount: string } | null;
  scheduleVersioned: boolean;
  createdAt: Date;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * Process 22 — Endorsement Management (backlog Part C #22, Domain B).
 *
 * `Endorsement` IS a `WorkflowTransitionService` entity — `status` moves only
 * through the engine along `REQUESTED → SUBMITTED_TO_INSURER → INSURER_CONFIRMED
 * → FINANCIAL_ADJUSTMENT_CALCULATED → (REFUND_APPROVAL_PENDING →) APPLIED →
 * CLIENT_NOTIFIED`. The child `Cancellation` / `Refund` / `CommissionReversal`
 * have no `status` (their lifecycle is the parent endorsement's). `Refund`
 * approval is maker/checker (`assertDifferentActors` + the
 * `Refund_maker_checker_distinct` CHECK). The commission reversal is created
 * **automatically** in the same step as the refund from the same return
 * premium — never a separate hand calculation (`policy-lifecycle.md`).
 */
@Injectable()
export class EndorsementService {
  private readonly logger = new Logger(EndorsementService.name);

  constructor(
    private readonly endorsements: EndorsementRepository,
    private readonly policies: PolicyRepository,
    private readonly recommendations: RecommendationRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
    private readonly commissionLedger: CommissionLedgerService,
  ) {}

  private canReachAnyPolicy(actor: AuthenticatedUser): boolean {
    return actor.roles.some((r) => CROSS_OWNER_ROLES.includes(r));
  }

  private async safeAudit(
    input: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Endorsement audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed`,
        err as Error,
      );
    }
  }

  /** Load the parent policy and enforce the caller's visibility on its
   * Customer; every miss collapses to one NotFoundException. */
  private async loadVisiblePolicy(
    policyId: string,
    actor: AuthenticatedUser,
  ): Promise<{
    id: string;
    customerId: string;
    status: PolicyStatus;
    opportunityId: string;
    issuedPremium: Prisma.Decimal | null;
    inceptionDate: Date | null;
    expiryDate: Date | null;
    openScheduleFrom: Date | null;
  }> {
    const policy = await this.policies.findById(policyId);
    if (!policy) throw new NotFoundException('Policy not found');
    const customer = await this.customers.findById(policy.customerId);
    if (
      !customer ||
      (!this.canReachAnyPolicy(actor) && customer.ownerUserId !== actor.id)
    ) {
      throw new NotFoundException('Policy not found');
    }
    return {
      id: policy.id,
      customerId: policy.customerId,
      status: policy.status,
      opportunityId: policy.opportunityId,
      issuedPremium: policy.issuedPremium,
      inceptionDate: policy.inceptionDate,
      expiryDate: policy.expiryDate,
      openScheduleFrom:
        policy.schedules.find((s) => s.effectiveTo === null)?.effectiveFrom ??
        null,
    };
  }

  /** An endorsement / cancellation `effectiveFrom` must fall inside the cover
   * period and no earlier than the current open coverage-schedule version —
   * a backdated value would close that schedule with `effectiveTo <
   * effectiveFrom` and open a successor that starts before its predecessor,
   * corrupting the "coverage in force at the loss date" resolution a `Claim`
   * relies on. */
  private assertEffectiveWithinCover(
    label: string,
    effectiveFrom: Date,
    policy: {
      inceptionDate: Date | null;
      expiryDate: Date | null;
      openScheduleFrom: Date | null;
    },
  ): void {
    const floor = policy.openScheduleFrom ?? policy.inceptionDate;
    if (floor && effectiveFrom.getTime() < floor.getTime()) {
      throw new UnprocessableEntityException(
        `${label} ${effectiveFrom.toISOString()} is before the current coverage-schedule version began (${floor.toISOString()}).`,
      );
    }
    if (
      policy.expiryDate &&
      effectiveFrom.getTime() > policy.expiryDate.getTime()
    ) {
      throw new UnprocessableEntityException(
        `${label} ${effectiveFrom.toISOString()} is after the policy expires (${policy.expiryDate.toISOString()}).`,
      );
    }
  }

  private async loadVisibleEndorsement(
    id: string,
    actor: AuthenticatedUser,
    label = 'Endorsement not found',
  ): Promise<EndorsementWithContext> {
    const endorsement = await this.endorsements.findById(id);
    if (!endorsement) throw new NotFoundException(label);
    const customer = await this.customers.findById(
      endorsement.policy.customerId,
    );
    if (
      !customer ||
      (!this.canReachAnyPolicy(actor) && customer.ownerUserId !== actor.id)
    ) {
      throw new NotFoundException(label);
    }
    return endorsement;
  }

  private async commissionRateFor(
    opportunityId: string,
  ): Promise<Prisma.Decimal> {
    const recommendation =
      await this.recommendations.findByOpportunityId(opportunityId);
    const rate = recommendation?.recommendedQuotation.commissionRatePercent;
    if (rate === null || rate === undefined) {
      throw new UnprocessableEntityException(
        "The policy's quotation captured no commission rate — a commission reversal cannot be auto-computed. Capture the rate on the quotation first (Process 13).",
      );
    }
    return rate;
  }

  private toView(e: EndorsementWithContext): EndorsementView {
    return {
      id: e.id,
      policyId: e.policyId,
      customerId: e.policy.customerId,
      type: e.type,
      changeType: e.changeType,
      status: e.status,
      premiumAdjustment: formatMoney(e.premiumAdjustment),
      requestedByUserId: e.requestedByUserId,
      submittedToInsurerAt: e.submittedToInsurerAt,
      insurerConfirmedAt: e.insurerConfirmedAt,
      financialAdjustmentCalculatedAt: e.financialAdjustmentCalculatedAt,
      appliedAt: e.appliedAt,
      clientNotifiedAt: e.clientNotifiedAt,
      cancellation: e.cancellation
        ? {
            reason: e.cancellation.reason,
            basis: e.cancellation.basis,
            returnPremium: formatMoney(e.cancellation.returnPremium),
            clientNotifiedAt: e.cancellation.clientNotifiedAt,
          }
        : null,
      refund: e.refund
        ? {
            id: e.refund.id,
            amount: formatMoney(e.refund.amount),
            reason: e.refund.reason,
            raisedByUserId: e.refund.raisedByUserId,
            approvedByUserId: e.refund.approvedByUserId,
            approvalThresholdMatrixLevel: e.refund.approvalThresholdMatrixLevel,
            paidAt: e.refund.paidAt,
            needsApproval: refundNeedsApproval(e.refund.amount),
          }
        : null,
      commissionReversal: e.commissionReversal
        ? { amount: formatMoney(e.commissionReversal.amount) }
        : null,
      scheduleVersioned: e.schedule !== null,
      createdAt: e.createdAt,
    };
  }

  // ---- request -----------------------------------------------------------

  async requestEndorsement(
    policyId: string,
    dto: CreateEndorsementDto,
    actor: AuthenticatedUser,
  ): Promise<EndorsementView> {
    const policy = await this.loadVisiblePolicy(policyId, actor);
    if (policy.status !== 'ACTIVE') {
      throw new UnprocessableEntityException(
        `Policy ${policyId} is ${policy.status}; a mid-term endorsement is raised on an ACTIVE policy.`,
      );
    }

    const effectiveFrom = parseCalendarDate(dto.effectiveFrom, 'effectiveFrom');
    this.assertEffectiveWithinCover('effectiveFrom', effectiveFrom, policy);
    let targetCoverage: Prisma.InputJsonValue | null = null;
    if (dto.targetCoverage) {
      targetCoverage = {
        limits: assertCoverageFigures(
          dto.targetCoverage.limits,
          'targetCoverage.limits',
        ),
        sumsInsured: assertCoverageFigures(
          dto.targetCoverage.sumsInsured,
          'targetCoverage.sumsInsured',
        ),
        namedPerils: dto.targetCoverage.namedPerils ?? [],
        extensions: dto.targetCoverage.extensions ?? [],
      };
    }

    const created = await this.endorsements.create({
      policyId,
      type: dto.type,
      changeType: dto.changeType,
      premiumAdjustment: signedPremiumAdjustment(dto.type, dto.premiumAmount),
      effectiveFrom,
      requestedByUserId: actor.id,
      targetCoverage,
    });

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Endorsement',
      entityId: created.id,
      afterValue: endorsementAuditSnapshot(created),
    });

    return this.toView(await this.loadVisibleEndorsement(created.id, actor));
  }

  async requestCancellation(
    policyId: string,
    dto: CreateCancellationDto,
    actor: AuthenticatedUser,
  ): Promise<EndorsementView> {
    const policy = await this.loadVisiblePolicy(policyId, actor);
    if (policy.status !== 'ACTIVE') {
      throw new UnprocessableEntityException(
        `Policy ${policyId} is ${policy.status}; a cancellation is raised on an ACTIVE policy.`,
      );
    }
    if (
      policy.issuedPremium === null ||
      policy.inceptionDate === null ||
      policy.expiryDate === null
    ) {
      throw new UnprocessableEntityException(
        `Policy ${policyId} has no issued premium / period on record — a cancellation return premium cannot be computed.`,
      );
    }

    // At most one in-flight cancellation per policy (the policy stays ACTIVE
    // until the first one is APPLIED, so the plain status check above is not
    // enough — a second cancellation would mint a second Refund +
    // CommissionReversal). Pre-check for a friendly 409; the partial UNIQUE
    // index `Endorsement_one_live_cancellation_per_policy` is the real race
    // backstop (ibms-brain/meta/lex/race-safe-invariants.md).
    const liveCancellation =
      await this.endorsements.findLiveCancellation(policyId);
    if (liveCancellation) {
      throw new ConflictException(
        `Policy ${policyId} already has an in-flight cancellation endorsement (${liveCancellation.id}).`,
      );
    }

    const cancellationDate = parseCalendarDate(
      dto.effectiveFrom,
      'effectiveFrom',
    );
    this.assertEffectiveWithinCover('effectiveFrom', cancellationDate, policy);
    const { returnPremium } = cancellationReturnPremium({
      issuedPremium: policy.issuedPremium,
      inceptionDate: policy.inceptionDate,
      expiryDate: policy.expiryDate,
      cancellationDate,
      basis: dto.basis,
    });

    let created: Awaited<
      ReturnType<EndorsementRepository['createCancellationEndorsement']>
    >;
    try {
      created = await this.endorsements.createCancellationEndorsement(
        {
          policyId,
          type: 'NEGATIVE',
          changeType: CANCELLATION_CHANGE_TYPE,
          premiumAdjustment: signedPremiumAdjustment('NEGATIVE', returnPremium),
          effectiveFrom: cancellationDate,
          requestedByUserId: actor.id,
          targetCoverage: null,
        },
        {
          reason: dto.reason,
          basis: dto.basis,
          returnPremium: quantizeMoney(returnPremium),
        },
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Policy ${policyId} already has an in-flight cancellation endorsement.`,
        );
      }
      throw err;
    }
    const { endorsement, cancellation } = created;

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Endorsement',
      entityId: endorsement.id,
      afterValue: endorsementAuditSnapshot(endorsement),
    });
    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Cancellation',
      entityId: cancellation.id,
      afterValue: cancellationAuditSnapshot(cancellation),
    });

    return this.toView(
      await this.loadVisibleEndorsement(endorsement.id, actor),
    );
  }

  // ---- lifecycle -------------------------------------------------------

  private async transition(
    id: string,
    to: EndorsementStatus,
    actorUserId: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.workflow.transition({
      entityType: 'Endorsement',
      entityId: id,
      toStatus: to,
      actorUserId,
      data,
    });
  }

  async advance(
    id: string,
    dto: AdvanceEndorsementDto,
    actor: AuthenticatedUser,
  ): Promise<EndorsementView> {
    const e = await this.loadVisibleEndorsement(id, actor);
    const at = dto.occurredAt
      ? parseHistoricalInstant(dto.occurredAt, 'occurredAt')
      : new Date();

    if (e.status === 'REQUESTED') {
      await this.transition(id, 'SUBMITTED_TO_INSURER', actor.id, {
        submittedToInsurerAt: at,
      });
    } else if (e.status === 'SUBMITTED_TO_INSURER') {
      if (
        e.submittedToInsurerAt &&
        at.getTime() < e.submittedToInsurerAt.getTime()
      ) {
        throw new UnprocessableEntityException(
          `occurredAt ${at.toISOString()} is before the submission to the insurer (${e.submittedToInsurerAt.toISOString()}).`,
        );
      }
      await this.transition(id, 'INSURER_CONFIRMED', actor.id, {
        insurerConfirmedAt: at,
      });
    } else {
      throw new UnprocessableEntityException(
        `Endorsement ${id} is ${e.status}; \`advance\` walks REQUESTED → SUBMITTED_TO_INSURER → INSURER_CONFIRMED only.`,
      );
    }

    return this.toView(await this.loadVisibleEndorsement(id, actor));
  }

  async calculateAdjustment(
    id: string,
    dto: CalculateAdjustmentDto,
    actor: AuthenticatedUser,
  ): Promise<EndorsementView> {
    const e = await this.loadVisibleEndorsement(id, actor);

    if (
      e.status !== 'INSURER_CONFIRMED' &&
      e.status !== 'FINANCIAL_ADJUSTMENT_CALCULATED'
    ) {
      throw new UnprocessableEntityException(
        `Endorsement ${id} is ${e.status}; the financial adjustment is calculated from INSURER_CONFIRMED.`,
      );
    }

    const isCancellation = e.changeType === CANCELLATION_CHANGE_TYPE;

    // A premium override applies only to a non-cancellation and only on the
    // FIRST calculate-adjustment call (INSURER_CONFIRMED). A cancellation's
    // return premium was computed from the basis at request; and once the
    // Refund + CommissionReversal are minted from a figure, re-basing that
    // figure silently would decouple them — so a late, materially different
    // override is a loud 422, not a silent no-op.
    let premiumAdjustment = e.premiumAdjustment;
    if (dto.premiumAmount && !isCancellation) {
      const overridden = signedPremiumAdjustment(e.type, dto.premiumAmount);
      if (e.status === 'INSURER_CONFIRMED') {
        premiumAdjustment = overridden;
        await this.endorsements.updatePremiumAdjustment(id, premiumAdjustment);
      } else if (compareMoney(overridden, e.premiumAdjustment) !== 0) {
        throw new UnprocessableEntityException(
          `Endorsement ${id} adjustment is already calculated at ${formatMoney(e.premiumAdjustment)}; a premium override must be supplied on the first calculate-adjustment call.`,
        );
      }
    }

    // Negative endorsement (incl. cancellation) → the auto-tied Refund +
    // CommissionReversal, created TOGETHER in one $transaction from the SAME
    // premium adjustment so "a return premium is recorded" ⟺ "a commission
    // reversal exists" (policy-lifecycle.md: "the two numbers must move
    // together", "never computed separately by hand"). `e.refund === null`
    // implies `e.commissionReversal === null` (they are atomic), so one check
    // guards both and a crash-recovery re-call is a clean no-op once they
    // exist.
    const refundExistedBefore = e.refund !== null;
    if (e.type === 'NEGATIVE' && !refundExistedBefore) {
      const returnAmount = premiumAdjustment.abs();
      const rate = await this.commissionRateFor(e.policy.opportunityId);
      const reversal = commissionReversalAmount(returnAmount, rate);
      const needsApproval = refundNeedsApproval(returnAmount);
      try {
        await this.endorsements.createRefundAndReversal(
          {
            endorsementId: id,
            amount: quantizeMoney(returnAmount),
            reason: isCancellation ? 'cancellation' : 'premium_reduction',
            raisedByUserId: actor.id,
            approvalThresholdMatrixLevel: needsApproval
              ? 'requires_manager_approval'
              : 'below_threshold_auto',
          },
          { endorsementId: id, amount: reversal },
        );
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException(
            `Endorsement ${id} financial artefacts were recorded concurrently.`,
          );
        }
        throw err;
      }
    }

    if (e.status === 'INSURER_CONFIRMED') {
      await this.transition(id, 'FINANCIAL_ADJUSTMENT_CALCULATED', actor.id, {
        financialAdjustmentCalculatedAt: new Date(),
      });
    }

    // Reload for the up-to-date refund flag + the newly-created artefact ids.
    const after = await this.endorsements.findById(id);
    if (after?.refund && !refundExistedBefore) {
      await this.safeAudit({
        userId: actor.id,
        action: 'CREATE',
        entityType: 'Refund',
        entityId: after.refund.id,
        afterValue: refundAuditSnapshot(after.refund),
      });
    }
    if (after?.commissionReversal && !refundExistedBefore) {
      await this.safeAudit({
        userId: actor.id,
        action: 'CREATE',
        entityType: 'CommissionReversal',
        entityId: after.commissionReversal.id,
        afterValue: commissionReversalAuditSnapshot(after.commissionReversal),
      });
      // Process 36 — reflect the reversal onto the policy's CommissionLedgerEntry
      // (accumulate `reversedAmount`; flip `-> reversed` once fully clawed
      // back). Best-effort, like the #29 lossRatio.recomputeForPolicy call: it
      // must never fail the endorsement flow, the ledger entry may not exist
      // (Finance may not have run `commission.calculate` yet), and it recomputes
      // from live rows so a missed call self-heals on the next endorsement and
      // `settle` re-checks the same gate.
      try {
        await this.commissionLedger.reconcileReversalForPolicy(
          e.policy.id,
          actor.id,
        );
      } catch (err) {
        this.logger.error(
          `Endorsement ${id}: reflecting the commission reversal onto the ledger entry failed (non-fatal): ${(err as Error).message}`,
        );
      }
    }
    if (
      after &&
      after.type === 'NEGATIVE' &&
      after.refund !== null &&
      refundNeedsApproval(after.refund.amount) &&
      after.refund.approvedByUserId === null &&
      after.status === 'FINANCIAL_ADJUSTMENT_CALCULATED'
    ) {
      await this.transition(id, 'REFUND_APPROVAL_PENDING', actor.id);
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'Endorsement',
      entityId: id,
      afterValue: {
        premiumAdjustment: formatMoney(premiumAdjustment),
        type: e.type,
        changeType: e.changeType,
        hasRefund: e.type === 'NEGATIVE',
      },
    });

    return this.toView(await this.loadVisibleEndorsement(id, actor));
  }

  /** Shared "apply" — transition to APPLIED (stamping `appliedAt` in the same
   * write), version the schedule, then cancel the policy for a cancellation.
   * Re-entrant: if already APPLIED with no versioned schedule it just does the
   * schedule. Refuses outright if an at/above-threshold `Refund` is still
   * unapproved (the maker/checker gate — structurally enforced HERE, not only
   * by the `REFUND_APPROVAL_PENDING` status, because a crash or a concurrent
   * call can strand the endorsement at `FINANCIAL_ADJUSTMENT_CALCULATED` with
   * an unapproved refund; `maker-checker-segregation.md`). */
  private async applyCore(
    e: EndorsementWithContext,
    actor: AuthenticatedUser,
  ): Promise<void> {
    if (
      e.refund !== null &&
      refundNeedsApproval(e.refund.amount) &&
      e.refund.approvedByUserId === null
    ) {
      throw new UnprocessableEntityException(
        `Endorsement ${e.id} has a return-premium refund of ${formatMoney(e.refund.amount)} at or above the approval threshold that has not been approved — approve it via \`POST /refunds/${e.refund.id}/approve\`.`,
      );
    }

    if (e.status !== 'APPLIED') {
      await this.transition(e.id, 'APPLIED', actor.id, {
        appliedAt: new Date(),
      });
    }

    const isCancellation = e.changeType === CANCELLATION_CHANGE_TYPE;
    const existing = await this.policies.scheduleForEndorsement(e.id);
    if (existing === null) {
      const tc = e.targetCoverage as {
        limits: Prisma.InputJsonValue;
        sumsInsured: Prisma.InputJsonValue;
        namedPerils: string[];
        extensions: string[];
      } | null;
      try {
        const schedule = await this.policies.versionScheduleForEndorsement({
          policyId: e.policyId,
          endorsementId: e.id,
          effectiveFrom: e.effectiveFrom ?? e.createdAt,
          isCancellation,
          targetCoverage: tc,
        });
        if (schedule) {
          await this.safeAudit({
            userId: actor.id,
            action: 'CREATE',
            entityType: 'PolicySchedule',
            entityId: schedule.id,
            afterValue: {
              policyId: e.policyId,
              sourceEndorsementId: e.id,
              effectiveFrom: schedule.effectiveFrom.toISOString(),
            },
          });
        }
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException(
            `Endorsement ${e.id} schedule version was written concurrently.`,
          );
        }
        throw err;
      }
    }

    if (isCancellation) {
      // A cancellation's terminal state IS a safety gate — a policy left
      // ACTIVE after its cover was cancelled would be picked up by renewal /
      // cross-sell sweeps and would accept claims. Per the #20 generalisation
      // in `policy-lifecycle.md` ("a best-effort status walk whose terminal
      // state is a safety gate must fail loudly"), an unappliable outcome is a
      // hard 409, not a swallowed warn. Already-CANCELLED (a concurrent apply
      // won) is success. The endorsement is already APPLIED + the schedule
      // closed, so a retry of `POST /endorsements/:id/apply` is re-entrant and
      // just re-attempts this step.
      try {
        await this.workflow.transition({
          entityType: 'Policy',
          entityId: e.policyId,
          toStatus: 'CANCELLED',
          actorUserId: actor.id,
        });
      } catch (err) {
        const policyNow = await this.policies.findStatus(e.policyId);
        if (policyNow?.status === 'CANCELLED') {
          return;
        }
        throw new ConflictException(
          `Endorsement ${e.id} applied but Policy ${e.policyId} could not be moved to CANCELLED (now ${policyNow?.status ?? 'unknown'}): ${(err as Error).message}. Retry \`POST /endorsements/${e.id}/apply\`.`,
        );
      }
    }
  }

  async apply(id: string, actor: AuthenticatedUser): Promise<EndorsementView> {
    const e = await this.loadVisibleEndorsement(id, actor);
    if (e.status === 'REFUND_APPROVAL_PENDING') {
      throw new UnprocessableEntityException(
        `Endorsement ${id} is pending refund approval — apply it via \`POST /refunds/:id/approve\`.`,
      );
    }
    if (
      e.status !== 'FINANCIAL_ADJUSTMENT_CALCULATED' &&
      e.status !== 'APPLIED'
    ) {
      throw new UnprocessableEntityException(
        `Endorsement ${id} is ${e.status}; it is applied once the financial adjustment is calculated.`,
      );
    }
    await this.applyCore(e, actor);
    await this.safeAudit({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'Endorsement',
      entityId: id,
      afterValue: { status: 'APPLIED', changeType: e.changeType },
    });
    return this.toView(await this.loadVisibleEndorsement(id, actor));
  }

  async approveRefund(
    refundId: string,
    actor: AuthenticatedUser,
  ): Promise<EndorsementView> {
    const refund = await this.endorsements.findRefundById(refundId);
    if (!refund) throw new NotFoundException('Refund not found');
    const customer = await this.customers.findById(
      refund.endorsement.policy.customerId,
    );
    if (
      !customer ||
      (!this.canReachAnyPolicy(actor) && customer.ownerUserId !== actor.id)
    ) {
      throw new NotFoundException('Refund not found');
    }

    const e = refund.endorsement;
    if (e.status !== 'REFUND_APPROVAL_PENDING') {
      throw new UnprocessableEntityException(
        `Endorsement ${e.id} is ${e.status}; there is no refund approval pending.`,
      );
    }
    if (refund.approvedByUserId !== null) {
      throw new ConflictException(
        `Refund ${refundId} has already been approved.`,
      );
    }
    assertDifferentActors(refund.raisedByUserId, actor.id, 'Refund.approve');

    const updated = await this.endorsements.recordRefundApproval(
      refundId,
      actor.id,
    );
    if (updated === null) {
      throw new ConflictException(
        `Refund ${refundId} was approved concurrently.`,
      );
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'APPROVE',
      entityType: 'Refund',
      entityId: refundId,
      afterValue: refundAuditSnapshot(updated),
    });

    const reloaded = await this.endorsements.findById(e.id);
    if (reloaded) {
      await this.applyCore(reloaded, actor);
    }

    return this.toView(await this.loadVisibleEndorsement(e.id, actor));
  }

  async notifyClient(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<EndorsementView> {
    const e = await this.loadVisibleEndorsement(id, actor);
    if (e.status !== 'APPLIED') {
      throw new UnprocessableEntityException(
        `Endorsement ${id} is ${e.status}; the client is notified once it is APPLIED.`,
      );
    }
    await this.transition(id, 'CLIENT_NOTIFIED', actor.id, {
      clientNotifiedAt: new Date(),
    });
    if (e.cancellation && e.cancellation.clientNotifiedAt === null) {
      await this.endorsements.stampCancellationClientNotified(
        e.cancellation.id,
      );
    }
    await this.safeAudit({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'Endorsement',
      entityId: id,
      afterValue: { status: 'CLIENT_NOTIFIED' },
    });
    return this.toView(await this.loadVisibleEndorsement(id, actor));
  }

  // ---- reads --------------------------------------------------------------

  async list(
    policyId: string,
    actor: AuthenticatedUser,
  ): Promise<EndorsementView[]> {
    await this.loadVisiblePolicy(policyId, actor);
    const rows = await this.endorsements.findManyByPolicyId(policyId);
    return rows.map((r) => this.toView(r));
  }

  async get(id: string, actor: AuthenticatedUser): Promise<EndorsementView> {
    return this.toView(await this.loadVisibleEndorsement(id, actor));
  }
}

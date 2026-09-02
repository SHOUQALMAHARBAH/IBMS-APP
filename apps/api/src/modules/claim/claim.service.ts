import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ClaimStatus, Prisma } from '@ibms/db';
import {
  ClaimRepository,
  type ClaimWithContext,
  type CreateThirdPartyClaimantInput,
} from '../../repositories/claim.repository';
import { PolicyRepository } from '../../repositories/policy.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../security/encryption.service';
import { encryptEntityFields } from '../security/encrypted-fields';
import { CLAIM_CROSS_OWNER_ROLES } from '../../common/rbac-visibility.util';
import { formatMoney, quantizeMoney } from '../../common/money.util';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import {
  claimNotificationAuditSnapshot,
  coverageGapMessage,
  isLargeClaim,
  resolveCoverageAtLossDate,
  thirdPartyClaimantAuditSnapshot,
} from './claim.config';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { NotifyClaimDto } from './dto/notify-claim.dto';
import type { ListClaimsQueryDto } from './dto/list-claims-query.dto';

const CROSS_OWNER_ROLES: readonly string[] = CLAIM_CROSS_OWNER_ROLES;

interface ClaimStatusHistoryView {
  fromStatus: ClaimStatus | null;
  toStatus: ClaimStatus;
  changedByUserId: string;
  changedAt: Date;
}

/** A claim as the API returns it. `coverage` is the `PolicySchedule` version
 * in force at the loss date, re-resolved on every read (see
 * `coverageResolvedAtLossDate`); `causeOfLoss` / `lossLocation` are returned
 * to authorised `claim.read` holders (in-app coverage data, not a logged
 * channel) but the third-party contact details never are — that is
 * `-- ENCRYPT` PII behind a deliberate reveal. */
export interface ClaimView {
  id: string;
  policyId: string;
  customerId: string;
  policyNumber: string | null;
  insuranceLine: string;
  claimNumber: string | null;
  status: ClaimStatus;
  lossDate: Date;
  lossLocation: string | null;
  causeOfLoss: string | null;
  estimatedLoss: string;
  isThirdPartyInvolved: boolean;
  isLargeClaim: boolean;
  classification: string;
  followUpAlertThresholdDays: number;
  thirdParty: {
    fullName: string | null;
    subrogationRecoveryFlag: boolean;
  } | null;
  coverage: {
    scheduleId: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  } | null;
  /** False when the loss date no longer resolves to any coverage window —
   * e.g. the policy was cancelled forward after the claim was notified. The
   * claim row stands; this just flags that the window can't be shown. */
  coverageResolvedAtLossDate: boolean;
  statusHistory: ClaimStatusHistoryView[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Process 23 — Claim Notification (backlog Part C #23, Domain C).
 *
 *  - `notify` — record a reported loss against a Policy: loss
 *    date/location/cause, the estimated loss, third-party involvement. The
 *    `Claim` takes the schema `@default(NOTIFIED)` (initial creation — no
 *    engine transition, same as a `Policy` created at `PLACEMENT_CONFIRMED`);
 *    the `NOTIFIED → REGISTERED` move is Process 24. Coverage in force **at
 *    the exact loss date** is validated against the policy's `PolicySchedule`
 *    version windows — NOT the current schedule alone — so a loss under a
 *    policy that was endorsed after the loss resolves to the version that
 *    actually applied then (`claims-lifecycle.md` / `data-model.md`).
 *  - `list` / `get` — read, scoped to exactly one of `policyId` /
 *    `customerId`.
 *
 * `Claim` IS a `WorkflowTransitionService` entity. Recording a notification is
 * single-actor Sales / Claims work — no maker/checker at this stage (the
 * mandatory second approver is at settlement, Process 28,
 * `maker-checker-segregation.md`). Visibility mirrors `PolicyService`: a claim
 * inherits its Customer's visibility, and a Claims Officer reaches any claim
 * (cross-book operational role).
 */
@Injectable()
export class ClaimService {
  private readonly logger = new Logger(ClaimService.name);

  constructor(
    private readonly claims: ClaimRepository,
    private readonly policies: PolicyRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
  ) {}

  private canReachAnyClaim(actor: AuthenticatedUser): boolean {
    return actor.roles.some((r) => CROSS_OWNER_ROLES.includes(r));
  }

  /** Logged, not thrown — the real write already committed. */
  private async safeAudit(
    input: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Claim audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed`,
        err as Error,
      );
    }
  }

  private async assertCustomerVisible(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const customer = await this.customers.findById(customerId);
    if (
      !customer ||
      (!this.canReachAnyClaim(actor) && customer.ownerUserId !== actor.id)
    ) {
      throw new NotFoundException('Customer not found');
    }
  }

  /** Load the parent policy (with every coverage-schedule window) and enforce
   * the caller's visibility on its Customer; every miss collapses to one
   * NotFoundException (no existence oracle). */
  private async loadVisiblePolicy(
    policyId: string,
    actor: AuthenticatedUser,
  ): Promise<{
    id: string;
    customerId: string;
    expiryDate: Date | null;
    schedules: { id: string; effectiveFrom: Date; effectiveTo: Date | null }[];
  }> {
    const policy = await this.policies.findById(policyId);
    if (!policy) throw new NotFoundException('Policy not found');
    try {
      await this.assertCustomerVisible(policy.customerId, actor);
    } catch {
      throw new NotFoundException('Policy not found');
    }
    return {
      id: policy.id,
      customerId: policy.customerId,
      expiryDate: policy.expiryDate,
      schedules: policy.schedules.map((s) => ({
        id: s.id,
        effectiveFrom: s.effectiveFrom,
        effectiveTo: s.effectiveTo,
      })),
    };
  }

  private async loadVisibleClaim(
    id: string,
    actor: AuthenticatedUser,
    label = 'Claim not found',
  ): Promise<ClaimWithContext> {
    const claim = await this.claims.findById(id);
    if (!claim) throw new NotFoundException(label);
    try {
      await this.assertCustomerVisible(claim.customerId, actor);
    } catch {
      throw new NotFoundException(label);
    }
    return claim;
  }

  private toView(claim: ClaimWithContext): ClaimView {
    const resolution = resolveCoverageAtLossDate({
      schedules: claim.policy.schedules,
      expiryDate: claim.policy.expiryDate,
      lossDate: claim.lossDate,
    });
    return {
      id: claim.id,
      policyId: claim.policyId,
      customerId: claim.customerId,
      policyNumber: claim.policy.policyNumber,
      insuranceLine: claim.policy.insuranceLine,
      claimNumber: claim.claimNumber,
      status: claim.status,
      lossDate: claim.lossDate,
      lossLocation: claim.lossLocation,
      causeOfLoss: claim.causeOfLoss,
      estimatedLoss: formatMoney(claim.estimatedLoss),
      isThirdPartyInvolved: claim.isThirdPartyInvolved,
      isLargeClaim: claim.isLargeClaim,
      classification: claim.classification,
      followUpAlertThresholdDays: claim.followUpAlertThresholdDays,
      thirdParty: claim.thirdParty
        ? {
            fullName: claim.thirdParty.fullName,
            subrogationRecoveryFlag: claim.thirdParty.subrogationRecoveryFlag,
          }
        : null,
      coverage: resolution.ok
        ? {
            scheduleId: resolution.scheduleId,
            effectiveFrom: resolution.effectiveFrom,
            effectiveTo: resolution.effectiveTo,
          }
        : null,
      coverageResolvedAtLossDate: resolution.ok,
      statusHistory: claim.statusHistory.map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        changedByUserId: h.changedByUserId,
        changedAt: h.changedAt,
      })),
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt,
    };
  }

  async notify(
    dto: NotifyClaimDto,
    actor: AuthenticatedUser,
  ): Promise<ClaimView> {
    const policy = await this.loadVisiblePolicy(dto.policyId, actor);

    const lossDate = parseHistoricalInstant(dto.lossDate, 'lossDate');

    const estimatedLoss = quantizeMoney(dto.estimatedLoss);
    if (estimatedLoss.lessThanOrEqualTo(0)) {
      throw new UnprocessableEntityException(
        'estimatedLoss must be greater than zero.',
      );
    }

    // Coverage in force AT THE LOSS DATE — resolved against every
    // PolicySchedule version window (the materialised endorsement history),
    // not the current open schedule alone.
    const coverage = resolveCoverageAtLossDate({
      schedules: policy.schedules,
      expiryDate: policy.expiryDate,
      lossDate,
    });
    if (!coverage.ok) {
      throw new UnprocessableEntityException(
        coverageGapMessage(coverage.reason, {
          lossDate,
          expiryDate: policy.expiryDate,
        }),
      );
    }

    const thirdPartyInvolved = dto.isThirdPartyInvolved === true;
    if (dto.thirdParty && !thirdPartyInvolved) {
      throw new UnprocessableEntityException(
        'thirdParty details were supplied but isThirdPartyInvolved is not set — set the flag or omit the details.',
      );
    }

    let thirdPartyInput: CreateThirdPartyClaimantInput | null = null;
    if (thirdPartyInvolved) {
      const thirdPartyId = randomUUID();
      const encrypted = await encryptEntityFields(
        this.encryption,
        'ThirdPartyClaimant',
        { contactDetailsEnc: dto.thirdParty?.contactDetails },
        {
          userId: actor.id,
          entityType: 'ThirdPartyClaimant',
          entityId: thirdPartyId,
        },
      );
      thirdPartyInput = {
        id: thirdPartyId,
        fullName: dto.thirdParty?.fullName ?? null,
        contactDetailsEnc: encrypted.contactDetailsEnc ?? null,
        subrogationRecoveryFlag:
          dto.thirdParty?.subrogationRecoveryFlag ?? false,
      };
    }

    const largeClaim = isLargeClaim(estimatedLoss);

    const { claim, thirdParty } = await this.claims.createNotification(
      {
        policyId: policy.id,
        customerId: policy.customerId,
        lossDate,
        lossLocation: dto.lossLocation ?? null,
        causeOfLoss: dto.causeOfLoss,
        estimatedLoss,
        isThirdPartyInvolved: thirdPartyInvolved,
        isLargeClaim: largeClaim,
        notifiedByUserId: actor.id,
      },
      thirdPartyInput,
    );

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Claim',
      entityId: claim.id,
      afterValue: claimNotificationAuditSnapshot({
        id: claim.id,
        policyId: claim.policyId,
        customerId: claim.customerId,
        status: claim.status,
        lossDate: claim.lossDate,
        estimatedLoss: claim.estimatedLoss,
        isThirdPartyInvolved: claim.isThirdPartyInvolved,
        isLargeClaim: claim.isLargeClaim,
        hasLossLocation: claim.lossLocation !== null,
        coverageScheduleId: coverage.scheduleId,
        coverageEffectiveFrom: coverage.effectiveFrom,
        coverageEffectiveTo: coverage.effectiveTo,
      }),
    });
    if (thirdParty) {
      await this.safeAudit({
        userId: actor.id,
        action: 'CREATE',
        entityType: 'ThirdPartyClaimant',
        entityId: thirdParty.id,
        afterValue: thirdPartyClaimantAuditSnapshot({
          id: thirdParty.id,
          claimId: claim.id,
          hasFullName: thirdParty.fullName !== null,
          hasContactDetails: thirdParty.contactDetailsEnc !== null,
          subrogationRecoveryFlag: thirdParty.subrogationRecoveryFlag,
        }),
      });
    }

    return this.toView(await this.loadVisibleClaim(claim.id, actor));
  }

  async list(
    query: ListClaimsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<ClaimView[]> {
    const scopes = [query.policyId, query.customerId].filter((v) => v != null);
    if (scopes.length !== 1) {
      throw new UnprocessableEntityException(
        'Provide exactly one of policyId or customerId.',
      );
    }

    let rows: ClaimWithContext[];
    let scopeType: 'Policy' | 'Customer';
    let scopeId: string;
    if (query.policyId) {
      await this.loadVisiblePolicy(query.policyId, actor);
      rows = await this.claims.findManyByPolicyId(query.policyId);
      scopeType = 'Policy';
      scopeId = query.policyId;
    } else {
      scopeId = query.customerId as string;
      await this.assertCustomerVisible(scopeId, actor);
      rows = await this.claims.findManyByCustomerId(scopeId);
      scopeType = 'Customer';
    }

    await this.auditSensitiveRead(actor, scopeType, scopeId, rows.length > 0, {
      view: 'claims-list',
      count: rows.length,
      claimIds: rows.map((r) => r.id),
    });

    return rows.map((r) => this.toView(r));
  }

  async get(id: string, actor: AuthenticatedUser): Promise<ClaimView> {
    const claim = await this.loadVisibleClaim(id, actor);
    await this.auditSensitiveRead(actor, 'Claim', claim.id, true, {
      claimId: claim.id,
      policyId: claim.policyId,
      customerId: claim.customerId,
    });
    return this.toView(claim);
  }

  /**
   * Part 10.3 / `ibms-brain/meta/lex/sensitive-data-handling.md` — a `Claim`
   * is `HIGHLY_CONFIDENTIAL` and a read returns `causeOfLoss` / `lossLocation`
   * free text (which may name an injured person or describe a medical event)
   * plus the third-party claimant name. Record every read — ids / counts
   * only, never claim content — and flag it `isSensitiveDataAccess` so the
   * audit anomaly detector (bulk / repeated sensitive reads) can see it.
   * Mirrors `CrmService.get360View`.
   */
  private async auditSensitiveRead(
    actor: AuthenticatedUser,
    entityType: 'Claim' | 'Policy' | 'Customer',
    entityId: string,
    sensitive: boolean,
    afterValue: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.safeAudit({
      userId: actor.id,
      action: 'READ',
      entityType,
      entityId,
      isSensitiveDataAccess: sensitive,
      afterValue,
    });
  }
}

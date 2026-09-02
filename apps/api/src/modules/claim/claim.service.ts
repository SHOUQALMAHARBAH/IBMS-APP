import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { Adjuster, ClaimStatus } from '@ibms/db';
import {
  ClaimRepository,
  type ClaimDocumentInput,
  type ClaimWithContext,
  type CreateThirdPartyClaimantInput,
} from '../../repositories/claim.repository';
import { PolicyRepository } from '../../repositories/policy.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { EncryptionService } from '../security/encryption.service';
import { encryptEntityFields } from '../security/encrypted-fields';
import { CLAIM_CROSS_OWNER_ROLES } from '../../common/rbac-visibility.util';
import { formatMoney, quantizeMoney } from '../../common/money.util';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import {
  MEDICAL_REPORT_DOC_TYPE,
  adjusterAssessmentAuditSnapshot,
  adjusterAuditSnapshot,
  buildDocumentChecklist,
  claimDocumentAuditSnapshot,
  claimFollowUpAlertAuditSnapshot,
  claimNotificationAuditSnapshot,
  claimRegistrationAuditSnapshot,
  coverageGapMessage,
  deriveAssessmentView,
  deriveFollowUpView,
  followUpThresholdDaysFor,
  isAssessmentConcluded,
  isClaimFollowUpDue,
  isLargeClaim,
  mandatoryDocTypesFor,
  resolveCoverageAtLossDate,
  thirdPartyClaimantAuditSnapshot,
  type AssessmentView,
  type ClaimAssessmentOutcome,
  type ClaimDocChecklistItem,
  type ClaimDocType,
  type ClaimFollowUpView,
} from './claim.config';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { NotifyClaimDto } from './dto/notify-claim.dto';
import type { RegisterClaimDto } from './dto/register-claim.dto';
import type { AttachClaimDocumentsDto } from './dto/attach-claim-documents.dto';
import type { RecordAdjusterProgressDto } from './dto/record-adjuster-progress.dto';
import type { DecideClaimAssessmentDto } from './dto/decide-claim-assessment.dto';
import type { ListClaimsQueryDto } from './dto/list-claims-query.dto';

const CROSS_OWNER_ROLES: readonly string[] = CLAIM_CROSS_OWNER_ROLES;

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

interface ClaimStatusHistoryView {
  fromStatus: ClaimStatus | null;
  toStatus: ClaimStatus;
  changedByUserId: string;
  changedAt: Date;
}

/** Process 25 — one attached claim-documentation file. `storageRef` (the
 * internal object-storage key) is never returned; `fileName` is (in-app claim
 * data to an authorised `claim.read` holder — the read itself is audited as a
 * sensitive-data access). */
interface ClaimDocumentView {
  id: string;
  docType: string;
  category: string;
  classification: string;
  fileName: string;
  versionNumber: number;
  uploadedByUserId: string;
  createdAt: Date;
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
  insurerClaimReference: string | null;
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
  /** Process 24 — the assigned loss adjuster, or null until registration. */
  adjuster: {
    name: string;
    firm: string | null;
    assignedAt: Date;
    surveyCompletedAt: Date | null;
    investigationCompletedAt: Date | null;
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
  /** Process 25 — the attached documentation files, and the mandatory
   * checklist derived from the claim's line family + third-party involvement.
   * `documentationComplete` = every `required` checklist item is `present`. */
  documents: ClaimDocumentView[];
  documentChecklist: ClaimDocChecklistItem[];
  documentationComplete: boolean;
  missingMandatoryDocuments: ClaimDocType[];
  /** Process 26 — the assessment sub-view: the adjuster's survey /
   * investigation completion, whether the `→ UNDER_ASSESSMENT` move is
   * unblocked, and the recorded verdict (null until decided). */
  assessment: AssessmentView;
  /** Process 27 — the insurer non-response follow-up sub-view: the alerts,
   * whether one is open, the per-line threshold and the clock start. */
  followUp: ClaimFollowUpView;
  statusHistory: ClaimStatusHistoryView[];
  createdAt: Date;
  updatedAt: Date;
}

/** Counts returned by the Process 27 follow-up sweep. */
export interface ClaimFollowUpScanResult {
  /** claims scanned (pre-verdict statuses) */
  awaiting: number;
  /** of those, past their threshold */
  due: number;
  /** new `ClaimFollowUpAlert` rows created this run */
  raised: number;
  /** due claims that already had an open alert (incl. a concurrent-sweep loss) */
  skippedAlreadyAlerted: number;
  /** open alerts closed because the claim has since progressed */
  autoResolved: number;
  /** rows that threw and were skipped (retried next run) */
  failed: number;
}

/**
 * Process 23-27 — Claim Notification + Registration + Documentation +
 * Assessment + Follow-up (backlog Part C #23-27, Domain C).
 *
 *  - `notify` (#23) — record a reported loss against a Policy: loss
 *    date/location/cause, the estimated loss, third-party involvement. The
 *    `Claim` takes the schema `@default(NOTIFIED)` (initial creation — no
 *    engine transition, same as a `Policy` created at `PLACEMENT_CONFIRMED`).
 *    Coverage in force **at the exact loss date** is validated against the
 *    policy's `PolicySchedule` version windows — NOT the current schedule
 *    alone — so a loss under a policy that was endorsed after the loss
 *    resolves to the version that actually applied then (`claims-lifecycle.md`
 *    / `data-model.md`).
 *  - `register` (#24) — register the claim with the insurer (recording its
 *    `insurerClaimReference`) and assign the loss `Adjuster`, driving `Claim
 *    NOTIFIED → REGISTERED` through the workflow engine.
 *  - `attachDocuments` (#25) — file `ClaimDocument` / `Document` rows and
 *    surface the mandatory-document checklist per claim type; the first
 *    attach best-effort advances `REGISTERED → DOCUMENTATION_IN_PROGRESS`.
 *  - `recordAdjusterProgress` (#26) — stamp the loss adjuster's survey /
 *    investigation completion (write-once per field).
 *  - `submitForAssessment` (#26) — drive `Claim DOCUMENTATION_IN_PROGRESS →
 *    UNDER_ASSESSMENT` through the engine, **gated on the live
 *    mandatory-document checklist** (`claims-lifecycle.md` — "the checklist is
 *    what gates the move to insurer assessment"; a real safety gate, not
 *    best-effort — recomputed from the loaded rows, never a snapshot).
 *  - `decideAssessment` (#26) — drive `Claim UNDER_ASSESSMENT → APPROVED |
 *    PARTIALLY_APPROVED | DECLINED` through the engine, recording the
 *    insurer's verdict. The four settlement figures are Process 28.
 *  - `runFollowUpScan` (#27) — the insurer non-response sweep: raise a
 *    `ClaimFollowUpAlert` on every pre-verdict claim past its per-line
 *    business-day threshold (clock from `REGISTERED`), and auto-resolve alerts
 *    whose claim has since progressed. `resolveFollowUpAlert` (#27) — a manual
 *    resolve. NOT a `Claim` status change — an alert is an accountability
 *    nudge, not a lifecycle state.
 *  - `list` / `get` — read, scoped to exactly one of `policyId` /
 *    `customerId`.
 *
 * `Claim` IS a `WorkflowTransitionService` entity — `status` moves ONLY
 * through the engine; every move also writes a domain `ClaimStatusHistory`
 * row (it feeds Loss Ratio / Claims Analytics; the engine's generic
 * `TRANSITION` audit row does not). Notification, registration, documentation
 * and assessment are all single-actor Claims work — no maker/checker at any
 * of these stages (the mandatory second approver is at settlement, Process
 * 28, `maker-checker-segregation.md` § "what does NOT trigger this rule" —
 * recording the insurer's verdict is not the broker approving a payment).
 * Visibility mirrors `PolicyService`: a claim inherits its Customer's
 * visibility, and a Claims Officer reaches any claim (cross-book operational
 * role).
 */
@Injectable()
export class ClaimService {
  private readonly logger = new Logger(ClaimService.name);

  constructor(
    private readonly claims: ClaimRepository,
    private readonly policies: PolicyRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
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
    insuranceLine: string;
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
      insuranceLine: policy.insuranceLine,
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
      insurerClaimReference: claim.insurerClaimReference,
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
      adjuster: claim.adjuster
        ? {
            name: claim.adjuster.name,
            firm: claim.adjuster.firm,
            assignedAt: claim.adjuster.assignedAt,
            surveyCompletedAt: claim.adjuster.surveyCompletedAt,
            investigationCompletedAt: claim.adjuster.investigationCompletedAt,
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
      ...this.assessmentAndDocumentationView(claim),
      followUp: this.followUpView(claim),
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

  /** Process 25-26 — the attached files + the mandatory checklist derived from
   * the claim's line family (`Policy.insuranceLine`) and third-party
   * involvement, plus the Process 26 assessment sub-view (adjuster survey /
   * investigation completion, readiness, recorded verdict). `storageRef` is
   * dropped; `fileName` is kept (in-app claim data — the read is audited as a
   * sensitive-data access). */
  private assessmentAndDocumentationView(
    claim: ClaimWithContext,
  ): Pick<
    ClaimView,
    | 'documents'
    | 'documentChecklist'
    | 'documentationComplete'
    | 'missingMandatoryDocuments'
    | 'assessment'
  > {
    const documents: ClaimDocumentView[] = claim.documents.map((d) => ({
      id: d.id,
      docType: d.docType,
      category: d.document.category,
      classification: d.document.classification,
      fileName: d.document.fileName,
      versionNumber: d.document.versionNumber,
      uploadedByUserId: d.document.uploadedByUserId,
      createdAt: d.document.createdAt,
    }));
    const mandatory = mandatoryDocTypesFor({
      insuranceLine: claim.policy.insuranceLine,
      isThirdPartyInvolved: claim.isThirdPartyInvolved,
    });
    const { checklist, documentationComplete, missing } =
      buildDocumentChecklist(
        mandatory,
        documents.map((d) => d.docType),
      );
    return {
      documents,
      documentChecklist: checklist,
      documentationComplete,
      missingMandatoryDocuments: missing,
      assessment: deriveAssessmentView({
        status: claim.status,
        documentationComplete,
        surveyCompletedAt: claim.adjuster?.surveyCompletedAt ?? null,
        investigationCompletedAt:
          claim.adjuster?.investigationCompletedAt ?? null,
      }),
    };
  }

  /** Process 27 — the follow-up sub-view. The clock start is the `REGISTERED`
   * `ClaimStatusHistory.changedAt` (registration = submission to the insurer);
   * `null` before registration. */
  private followUpView(claim: ClaimWithContext): ClaimFollowUpView {
    const registeredAt =
      claim.statusHistory.find((h) => h.toStatus === 'REGISTERED')?.changedAt ??
      null;
    return deriveFollowUpView({
      status: claim.status,
      followUpAlertThresholdDays: claim.followUpAlertThresholdDays,
      registeredAt,
      alerts: claim.followUpAlerts,
    });
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
        // Process 27 — snapshot the per-line-family insurer non-response
        // threshold at notification (a later taxonomy change must not shift
        // live claims; the sweep reads this column).
        followUpAlertThresholdDays: followUpThresholdDaysFor(
          policy.insuranceLine,
        ),
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

  /**
   * Process 24 — register the claim with the insurer and assign the loss
   * adjuster. Drives `Claim NOTIFIED → REGISTERED` through
   * `WorkflowTransitionService.transition`, persisting the insurer reference
   * (and an optional broker claim number) as the transition `data` so the
   * status flip and the scalar write are one atomic, engine-audited write (its
   * status-conditional `updateMany` is the race gate). The `REGISTERED`
   * `ClaimStatusHistory` row and the `Adjuster` are then written in one
   * `$transaction`.
   *
   *  - A concurrent register that lost the `NOTIFIED → REGISTERED` race (the
   *    engine either matched 0 rows or its pre-read already saw `REGISTERED`)
   *    is normalised — reload and treat it as an already-registered claim.
   *  - A crash-recovery re-entry (status already `REGISTERED`, no adjuster)
   *    does only the artefact write, without re-transitioning.
   *  - An identical re-call of a completed registration is an idempotent no-op;
   *    a different insurer ref / adjuster on a registered claim is a 409.
   *  - Any other non-`NOTIFIED` state is a 422.
   *
   * No maker/checker — registering a claim and assigning the adjuster is
   * single-actor Claims work (`maker-checker-segregation.md` § "what does NOT
   * trigger this rule"); the mandatory second approver is at settlement
   * (Process 28).
   */
  async register(
    id: string,
    dto: RegisterClaimDto,
    actor: AuthenticatedUser,
  ): Promise<ClaimView> {
    const claim = await this.loadVisibleClaim(id, actor);

    if (claim.status === 'NOTIFIED') {
      const data: Record<string, unknown> = {
        insurerClaimReference: dto.insurerClaimReference,
      };
      if (dto.claimNumber) data.claimNumber = dto.claimNumber;
      try {
        await this.workflow.transition({
          entityType: 'Claim',
          entityId: id,
          toStatus: 'REGISTERED',
          actorUserId: actor.id,
          data,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException(
            `Claim number "${dto.claimNumber ?? ''}" is already in use by another claim.`,
          );
        }
        // `NOTIFIED → REGISTERED` is a legal edge and the claim was NOTIFIED a
        // moment ago, so the only failures here are a concurrent register
        // winning the race (0-rows ConflictException, or the engine's
        // "already in status REGISTERED" from its pre-read). Reload and handle
        // it as an already-registered claim.
        //
        // If BOTH callers race with DIFFERENT payloads, the exact winner/loser
        // outcome is timing-dependent (whichever transitions first wins the
        // status; whichever reaches `recordRegistration` first wins the
        // `Adjuster.claimId @unique`). Either way the end state is a single
        // consistent registration and exactly one caller gets a clean 409 —
        // never a partial or duplicate. A truly serialised "register exactly
        // once, first request wins" would need per-claim locking; not built.
        const now = await this.loadVisibleClaim(id, actor);
        if (now.status === 'REGISTERED') {
          return this.completeRegistration(now, dto, actor, false);
        }
        throw err;
      }
      return this.completeRegistration(
        await this.loadVisibleClaim(id, actor),
        dto,
        actor,
        true,
      );
    }

    return this.completeRegistration(claim, dto, actor, false);
  }

  /**
   * Post-transition: write the `Adjuster` + the `REGISTERED` history row and
   * the audit rows. `transitionedNow` is true only on the call that actually
   * drove `NOTIFIED → REGISTERED` (so the `UPDATE Claim` scalar-audit row is
   * written once). A `claim` that is not `REGISTERED` here is a 422.
   */
  private async completeRegistration(
    claim: ClaimWithContext,
    dto: RegisterClaimDto,
    actor: AuthenticatedUser,
    transitionedNow: boolean,
  ): Promise<ClaimView> {
    if (claim.status !== 'REGISTERED') {
      throw new UnprocessableEntityException(
        `Claim ${claim.id} is ${claim.status}; registration moves a claim from NOTIFIED.`,
      );
    }

    if (claim.adjuster) {
      // Already fully registered. A byte-identical re-call (network retry) is
      // an idempotent no-op; ANY difference in the registration detail —
      // insurer ref, adjuster name/firm, or broker claim number — is a 409:
      // these fields are write-once at this stage, so a correction must not be
      // silently swallowed as a no-op (a dedicated amend path is not built).
      const sameRef =
        (claim.insurerClaimReference ?? '') === dto.insurerClaimReference;
      const sameName = claim.adjuster.name === dto.adjuster.name;
      const sameFirm =
        (claim.adjuster.firm ?? '') === (dto.adjuster.firm ?? '');
      const sameNumber = (claim.claimNumber ?? '') === (dto.claimNumber ?? '');
      if (sameRef && sameName && sameFirm && sameNumber) {
        return this.toViewAudited(claim.id, actor, 'claim-registration');
      }
      throw new ConflictException(
        `Claim ${claim.id} is already registered (insurer ref "${claim.insurerClaimReference ?? '—'}", adjuster "${claim.adjuster.name}"). Registration details are recorded once — a correction is not yet supported.`,
      );
    }

    if (!transitionedNow) {
      this.logger.warn(
        `Claim ${claim.id}: resuming a partially-completed registration (status REGISTERED, no adjuster).`,
      );
    }

    let adjuster: Adjuster;
    try {
      adjuster = await this.claims.recordRegistration({
        claimId: claim.id,
        changedByUserId: actor.id,
        adjuster: { name: dto.adjuster.name, firm: dto.adjuster.firm ?? null },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Either the Adjuster.claimId @unique or the
        // ClaimStatusHistory(claimId, toStatus) UNIQUE fired — a concurrent
        // register got there first. Both mean the same thing to the caller.
        throw new ConflictException(
          `Claim ${claim.id} has already been registered concurrently.`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Adjuster',
      entityId: adjuster.id,
      afterValue: adjusterAuditSnapshot(adjuster),
    });
    if (transitionedNow) {
      // The engine's TRANSITION row captures before/after `status` only — the
      // registration scalars it wrote atomically are recorded here.
      await this.safeAudit({
        userId: actor.id,
        action: 'UPDATE',
        entityType: 'Claim',
        entityId: claim.id,
        afterValue: claimRegistrationAuditSnapshot({
          claimId: claim.id,
          insurerClaimReference: dto.insurerClaimReference,
          claimNumber: dto.claimNumber ?? null,
        }),
      });
    }

    return this.toViewAudited(claim.id, actor, 'claim-registration');
  }

  /**
   * Process 25 — attach one or more documentation files to a claim's
   * electronic file (Part 4.2). Valid from `REGISTERED` onward (the claim must
   * be registered with the insurer first — a `NOTIFIED` claim has no insurer
   * reference to file against). Each file is a `Document` (`storageRef`
   * pointer, never the bytes) + a `ClaimDocument` join carrying the
   * claim-specific `docType`, written in one `$transaction`. A `medical_report`
   * MUST be `HIGHLY_CONFIDENTIAL` (`claims-lifecycle.md` — health data is
   * classification-driven from first contact). The FIRST attach best-effort
   * advances `Claim REGISTERED → DOCUMENTATION_IN_PROGRESS` (logged, never
   * thrown — the documents are the authoritative artefact, and
   * `DOCUMENTATION_IN_PROGRESS` is a forward-progress marker, not a safety
   * gate; a resume re-tries on the next attach). No maker/checker — filing
   * documents is single-actor Claims work.
   */
  async attachDocuments(
    id: string,
    dto: AttachClaimDocumentsDto,
    actor: AuthenticatedUser,
  ): Promise<ClaimView> {
    const claim = await this.loadVisibleClaim(id, actor);
    if (claim.status === 'NOTIFIED') {
      throw new UnprocessableEntityException(
        `Claim ${id} is NOTIFIED; register it with the insurer (POST /claims/${id}/registration) before attaching documentation.`,
      );
    }

    for (const doc of dto.documents) {
      if (
        doc.docType === MEDICAL_REPORT_DOC_TYPE &&
        doc.classification !== 'HIGHLY_CONFIDENTIAL'
      ) {
        throw new UnprocessableEntityException(
          `A ${MEDICAL_REPORT_DOC_TYPE} is Sensitive Personal Data under PDPL and must be classified HIGHLY_CONFIDENTIAL (got ${doc.classification}).`,
        );
      }
    }

    const inputs: ClaimDocumentInput[] = dto.documents.map((d) => ({
      docType: d.docType,
      classification: d.classification,
      fileName: d.fileName,
      storageRef: d.storageRef,
      uploadedByUserId: actor.id,
    }));
    const created = await this.claims.attachDocuments(id, inputs);

    for (const link of created) {
      await this.safeAudit({
        userId: actor.id,
        action: 'CREATE',
        entityType: 'ClaimDocument',
        entityId: link.id,
        afterValue: claimDocumentAuditSnapshot({
          claimDocumentId: link.id,
          documentId: link.document.id,
          claimId: id,
          docType: link.docType,
          category: link.document.category,
          classification: link.document.classification,
          uploadedByUserId: link.document.uploadedByUserId,
        }),
      });
    }

    // Ensure the claim is advanced to DOCUMENTATION_IN_PROGRESS with its domain
    // history row — best-effort (logged, never thrown: the documents are the
    // authoritative artefact and DOCUMENTATION_IN_PROGRESS is a forward-progress
    // marker, not a #20-style safety gate). Keyed off the history row being
    // ABSENT (not off `status === REGISTERED`) so a transition that committed
    // but whose separate history write then threw is still backfilled on a
    // later attach.
    const advanced = await this.loadVisibleClaim(id, actor);
    const needsAdvance =
      (advanced.status === 'REGISTERED' ||
        advanced.status === 'DOCUMENTATION_IN_PROGRESS') &&
      !advanced.statusHistory.some(
        (h) => h.toStatus === 'DOCUMENTATION_IN_PROGRESS',
      );
    if (needsAdvance) {
      try {
        if (advanced.status === 'REGISTERED') {
          await this.workflow.transition({
            entityType: 'Claim',
            entityId: id,
            toStatus: 'DOCUMENTATION_IN_PROGRESS',
            actorUserId: actor.id,
          });
        }
        await this.claims.recordStatusHistory({
          claimId: id,
          fromStatus: 'REGISTERED',
          toStatus: 'DOCUMENTATION_IN_PROGRESS',
          changedByUserId: actor.id,
        });
      } catch (err) {
        this.logger.warn(
          `Claim ${id}: the best-effort REGISTERED -> DOCUMENTATION_IN_PROGRESS advance did not complete on this attempt (will retry on the next attach): ${(err as Error).message}`,
        );
      }
    }

    const view = this.toView(await this.loadVisibleClaim(id, actor));
    // The response echoes the whole ClaimView — `documents[].fileName` for
    // EVERY file on the claim (incl. ones another officer attached) plus the
    // `causeOfLoss` / `lossLocation` / third-party name — so log it as a
    // sensitive-data access, the same as `get` / `list`
    // (sensitive-data-handling.md; the #23 MAJOR fix).
    await this.auditSensitiveRead(actor, 'Claim', id, true, {
      view: 'claim-attach-documents',
      claimId: id,
      documentsFiled: created.length,
    });
    return view;
  }

  /**
   * Process 26 — stamp the loss adjuster's survey and / or investigation
   * completion. Valid while the claim is `REGISTERED` .. `UNDER_ASSESSMENT`
   * (the adjuster exists from registration; once a verdict is recorded the
   * assessment phase is closed). Each timestamp is a past-only instant
   * (`parseHistoricalInstant`) no earlier than the loss date, and is
   * **write-once** — re-sending the identical value is a no-op, a different
   * value is a 409 (there is no amend path). No maker/checker — recording
   * adjuster progress is single-actor Claims work.
   */
  async recordAdjusterProgress(
    id: string,
    dto: RecordAdjusterProgressDto,
    actor: AuthenticatedUser,
  ): Promise<ClaimView> {
    const claim = await this.loadVisibleClaim(id, actor);
    if (!claim.adjuster) {
      throw new UnprocessableEntityException(
        `Claim ${id} has no loss adjuster yet — register it with the insurer (POST /claims/${id}/registration) first.`,
      );
    }
    if (isAssessmentConcluded(claim.status)) {
      throw new UnprocessableEntityException(
        `Claim ${id} is ${claim.status}; the assessment phase is closed — adjuster progress can no longer be recorded.`,
      );
    }

    if (
      dto.surveyCompletedAt === undefined &&
      dto.investigationCompletedAt === undefined
    ) {
      throw new UnprocessableEntityException(
        'Provide surveyCompletedAt and/or investigationCompletedAt.',
      );
    }

    const lossAt = claim.lossDate.getTime();
    const patch: { surveyCompletedAt?: Date; investigationCompletedAt?: Date } =
      {};

    for (const field of [
      'surveyCompletedAt',
      'investigationCompletedAt',
    ] as const) {
      const raw = dto[field];
      if (raw === undefined) continue;
      const parsed = parseHistoricalInstant(raw, field);
      if (parsed.getTime() < lossAt) {
        throw new UnprocessableEntityException(
          `${field} (${parsed.toISOString()}) is before the loss date (${claim.lossDate.toISOString()}) — the adjuster cannot have surveyed a loss that had not happened.`,
        );
      }
      const existing = claim.adjuster[field];
      if (existing) {
        // Write-once: an identical re-send is fine, a different value is a 409.
        if (existing.getTime() !== parsed.getTime()) {
          throw new ConflictException(
            `${field} is already recorded as ${existing.toISOString()} — it is set once and there is no correction path.`,
          );
        }
        continue;
      }
      patch[field] = parsed;
    }

    if (Object.keys(patch).length > 0) {
      const { adjuster, wrote } = await this.claims.recordAdjusterProgress(
        id,
        patch,
      );
      // A field this call meant to set but did NOT write (`wrote.* === false`)
      // means a concurrent caller stamped it first, between our pre-check
      // above and the guarded `updateMany`. If their value differs from ours,
      // the loser gets a 409 (not a feigned success); if it matches, it is an
      // idempotent no-op.
      for (const field of Object.keys(patch) as (keyof typeof patch)[]) {
        if (wrote[field]) continue;
        const landed = adjuster[field];
        if (landed && landed.getTime() !== patch[field]!.getTime()) {
          throw new ConflictException(
            `${field} was recorded concurrently as ${landed.toISOString()} — it is set once and there is no correction path.`,
          );
        }
      }
      await this.safeAudit({
        userId: actor.id,
        action: 'UPDATE',
        entityType: 'Adjuster',
        entityId: adjuster.id,
        afterValue: adjusterAssessmentAuditSnapshot({
          adjusterId: adjuster.id,
          claimId: id,
          surveyCompletedAt: adjuster.surveyCompletedAt,
          investigationCompletedAt: adjuster.investigationCompletedAt,
        }),
      });
    }

    const view = this.toView(await this.loadVisibleClaim(id, actor));
    await this.auditSensitiveRead(actor, 'Claim', id, true, {
      view: 'claim-adjuster-progress',
      claimId: id,
    });
    return view;
  }

  /**
   * Process 26 — submit the claim to the insurer for assessment: drives
   * `Claim DOCUMENTATION_IN_PROGRESS → UNDER_ASSESSMENT` through the workflow
   * engine. **Gated on the mandatory-document checklist being complete**
   * (`claims-lifecycle.md` — "the checklist is what gates the move to insurer
   * assessment"): this is a real safety gate, so a failed / illegal transition
   * is surfaced (409 / 422), never swallowed. The gate is **recomputed from
   * the loaded document rows**, never trusted from a snapshot (the #16
   * generalisation). The `UNDER_ASSESSMENT` `ClaimStatusHistory` row is
   * written after the transition (idempotent); a re-call once the claim is
   * already `UNDER_ASSESSMENT` backfills a missing history row without
   * re-transitioning. No maker/checker — single-actor Claims work.
   */
  async submitForAssessment(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<ClaimView> {
    const claim = await this.loadVisibleClaim(id, actor);

    if (claim.status === 'UNDER_ASSESSMENT') {
      await this.backfillStatusHistory(
        id,
        'DOCUMENTATION_IN_PROGRESS',
        'UNDER_ASSESSMENT',
        claim.statusHistory,
        actor,
      );
      return this.toViewAudited(id, actor, 'claim-submit-for-assessment');
    }

    if (claim.status !== 'DOCUMENTATION_IN_PROGRESS') {
      throw new UnprocessableEntityException(
        isAssessmentConcluded(claim.status)
          ? `Claim ${id} is ${claim.status}; the assessment is already concluded.`
          : `Claim ${id} is ${claim.status}; it must be DOCUMENTATION_IN_PROGRESS (register it and file the mandatory documents) before it can be submitted for assessment.`,
      );
    }

    // Recompute the checklist from the loaded rows — the safety gate.
    const mandatory = mandatoryDocTypesFor({
      insuranceLine: claim.policy.insuranceLine,
      isThirdPartyInvolved: claim.isThirdPartyInvolved,
    });
    const { documentationComplete, missing } = buildDocumentChecklist(
      mandatory,
      claim.documents.map((d) => d.docType),
    );
    if (!documentationComplete) {
      throw new UnprocessableEntityException(
        `Claim ${id} cannot be submitted for assessment — the mandatory documentation is incomplete. Missing: ${missing.join(', ')}.`,
      );
    }

    try {
      await this.workflow.transition({
        entityType: 'Claim',
        entityId: id,
        toStatus: 'UNDER_ASSESSMENT',
        actorUserId: actor.id,
      });
    } catch (err) {
      // A concurrent submit won the DOCUMENTATION_IN_PROGRESS -> UNDER_ASSESSMENT
      // race (engine 0-rows ConflictException, or its pre-read already saw
      // UNDER_ASSESSMENT). Reload and treat as already-submitted; anything else
      // rethrows (the gate above already passed, so this is the only expected
      // failure).
      const now = await this.loadVisibleClaim(id, actor);
      if (now.status === 'UNDER_ASSESSMENT') {
        await this.backfillStatusHistory(
          id,
          'DOCUMENTATION_IN_PROGRESS',
          'UNDER_ASSESSMENT',
          now.statusHistory,
          actor,
        );
        return this.toViewAudited(id, actor, 'claim-submit-for-assessment');
      }
      throw err;
    }

    await this.recordHistoryBestEffort(
      id,
      'DOCUMENTATION_IN_PROGRESS',
      'UNDER_ASSESSMENT',
      actor,
    );
    return this.toViewAudited(id, actor, 'claim-submit-for-assessment');
  }

  /**
   * Process 26 — record the insurer's assessment verdict: drives
   * `Claim UNDER_ASSESSMENT → APPROVED | PARTIALLY_APPROVED | DECLINED`
   * through the workflow engine and writes the `ClaimStatusHistory` row. The
   * four settlement figures (estimated / approved / deductible / net) are
   * Process 28 — this endpoint records only the decision.
   *
   * Gated on the loss adjuster having completed **both** the survey and the
   * investigation (`Adjuster.surveyCompletedAt` and `investigationCompletedAt`
   * set) — an `ibms-app` product rule, drafted / unsourced (filed via
   * `/brain-gap`; same status as `CLAIM_LARGE_THRESHOLD_JOD` (#23), the #25
   * checklist matrix, #16's 10 % / 2 pp).
   *
   * Idempotent: re-sending the recorded verdict is a no-op; a *different*
   * verdict once one is recorded is a 409 (write-once — a dispute routes to
   * Complaint Management, Process 42). A concurrent `decideAssessment` that
   * lost the engine race is normalised the same way (idempotent for the same
   * outcome, 409 for a different one) rather than surfacing the engine's raw
   * conflict. No maker/checker — recording the insurer's decision is
   * single-actor Claims work, not the broker approving a payment
   * (`maker-checker-segregation.md` § "what does NOT trigger this rule").
   */
  async decideAssessment(
    id: string,
    dto: DecideClaimAssessmentDto,
    actor: AuthenticatedUser,
  ): Promise<ClaimView> {
    const outcome: ClaimAssessmentOutcome = dto.outcome;
    const claim = await this.loadVisibleClaim(id, actor);

    if (claim.status === outcome) {
      return this.concludeIdempotently(id, outcome, claim.statusHistory, actor);
    }

    if (isAssessmentConcluded(claim.status)) {
      throw new ConflictException(
        `Claim ${id} assessment is already recorded as ${claim.status} — the verdict is set once (a client dispute routes to Complaint Management).`,
      );
    }

    if (claim.status !== 'UNDER_ASSESSMENT') {
      throw new UnprocessableEntityException(
        `Claim ${id} is ${claim.status}; submit it for assessment (POST /claims/${id}/assessment/submit) before recording a verdict.`,
      );
    }

    if (
      !claim.adjuster?.surveyCompletedAt ||
      !claim.adjuster?.investigationCompletedAt
    ) {
      throw new UnprocessableEntityException(
        `Claim ${id}: the loss adjuster has not completed the survey and investigation — record those (POST /claims/${id}/assessment/adjuster-progress) before the assessment verdict.`,
      );
    }

    // Reconcile a possibly-missing UNDER_ASSESSMENT trail row — `submit` may
    // have transitioned but had its best-effort history write fail, and the
    // caller came straight here without re-calling `submit`.
    await this.backfillStatusHistory(
      id,
      'DOCUMENTATION_IN_PROGRESS',
      'UNDER_ASSESSMENT',
      claim.statusHistory,
      actor,
    );

    try {
      await this.workflow.transition({
        entityType: 'Claim',
        entityId: id,
        toStatus: outcome,
        actorUserId: actor.id,
      });
    } catch (err) {
      // A concurrent `decideAssessment` won the UNDER_ASSESSMENT -> verdict
      // race (engine 0-rows ConflictException, or its pre-read already saw a
      // verdict). Reload: if the winner recorded THIS outcome it is an
      // idempotent no-op; a DIFFERENT verdict (or a move past it) is the same
      // 409 the sequential path gives; anything else rethrows.
      const now = await this.loadVisibleClaim(id, actor);
      if (now.status === outcome) {
        return this.concludeIdempotently(id, outcome, now.statusHistory, actor);
      }
      if (isAssessmentConcluded(now.status)) {
        throw new ConflictException(
          `Claim ${id} assessment was recorded concurrently as ${now.status} — the verdict is set once (a client dispute routes to Complaint Management).`,
        );
      }
      throw err;
    }
    await this.recordHistoryBestEffort(id, 'UNDER_ASSESSMENT', outcome, actor);
    return this.toViewAudited(id, actor, 'claim-assessment-decision');
  }

  /** The verdict is already recorded (idempotent re-call, or a concurrent
   * winner). Reconcile BOTH trail rows that may be missing — the intermediate
   * `UNDER_ASSESSMENT` (if `submit`'s best-effort write failed) and the verdict
   * itself — then return the view. */
  private async concludeIdempotently(
    id: string,
    outcome: ClaimAssessmentOutcome,
    history: readonly { toStatus: ClaimStatus }[],
    actor: AuthenticatedUser,
  ): Promise<ClaimView> {
    await this.backfillStatusHistory(
      id,
      'DOCUMENTATION_IN_PROGRESS',
      'UNDER_ASSESSMENT',
      history,
      actor,
    );
    await this.backfillStatusHistory(
      id,
      'UNDER_ASSESSMENT',
      outcome,
      history,
      actor,
    );
    return this.toViewAudited(id, actor, 'claim-assessment-decision');
  }

  /** Write the domain `ClaimStatusHistory` row for a status the engine has
   * JUST moved through — best-effort (logged, never thrown). The engine
   * transition is the loud safety gate; this is the Analytics-feeding trail
   * write that follows it, and the #24 / #25 seam applies: a crash between the
   * two leaves the status ahead of its history row, which the next call's
   * `backfillStatusHistory` reconciles. */
  private async recordHistoryBestEffort(
    claimId: string,
    fromStatus: ClaimStatus,
    toStatus: ClaimStatus,
    actor: AuthenticatedUser,
  ): Promise<void> {
    try {
      await this.claims.recordStatusHistory({
        claimId,
        fromStatus,
        toStatus,
        changedByUserId: actor.id,
      });
    } catch (err) {
      this.logger.warn(
        `Claim ${claimId}: status moved to ${toStatus} but the domain ClaimStatusHistory write did not land (will be backfilled on the next call): ${(err as Error).message}`,
      );
    }
  }

  /** Write the domain `ClaimStatusHistory` row for a status the engine has
   * already moved through, if it is not already present (a resume path: the
   * transition committed but its separate history write then threw). Goes
   * through {@link recordHistoryBestEffort} so a concurrent backfill that trips
   * the `@@unique([claimId, toStatus])` is swallowed as "already reconciled"
   * rather than surfacing a raw `P2002` — the row landing is all that
   * matters. */
  private async backfillStatusHistory(
    claimId: string,
    fromStatus: ClaimStatus,
    toStatus: ClaimStatus,
    history: readonly { toStatus: ClaimStatus }[],
    actor: AuthenticatedUser,
  ): Promise<void> {
    if (history.some((h) => h.toStatus === toStatus)) return;
    await this.recordHistoryBestEffort(claimId, fromStatus, toStatus, actor);
  }

  /** Reload the claim, build the view, and log the sensitive-data READ (the
   * view echoes `causeOfLoss` / `lossLocation` / `documents[].fileName` / the
   * third-party name — same rule as `get` / `list`). */
  private async toViewAudited(
    id: string,
    actor: AuthenticatedUser,
    view: string,
  ): Promise<ClaimView> {
    const result = this.toView(await this.loadVisibleClaim(id, actor));
    await this.auditSensitiveRead(actor, 'Claim', id, true, {
      view,
      claimId: id,
    });
    return result;
  }

  /**
   * Process 27 — the insurer non-response follow-up sweep (the nightly
   * `ClaimFollowUpScheduler`, and an on-demand `POST /claims/follow-up-sweep`
   * for ops). Two passes, per-row isolated so one bad row does not abandon the
   * run (the `CrossSellDetectionScheduler` shape):
   *
   *  1. **Raise** — for every claim still awaiting an insurer response
   *     (pre-verdict statuses) whose business-day `followUpAlertThresholdDays`
   *     has elapsed since it was `REGISTERED` (falling back to the claim's
   *     earliest known instant + a warn if the #24 seam left the `REGISTERED`
   *     history row missing), and which has no open alert, create one
   *     `ClaimFollowUpAlert`. The partial `UNIQUE ("claimId") WHERE
   *     "resolvedAt" IS NULL` is the race gate — a concurrent sweep's `P2002`
   *     is counted as `skippedAlreadyAlerted`, not `failed`.
   *  2. **Resolve** — for every open alert whose claim has since moved past
   *     the pre-verdict stage (the insurer responded), stamp `resolvedAt`.
   *
   * Each candidate query is capped at `FOLLOWUP_SWEEP_LIMIT`; a run that hits
   * the cap logs a warn (no pagination yet). `actorUserId` is the system
   * service account (resolved by the scheduler) or the ops user who triggered
   * the on-demand run.
   */
  async runFollowUpScan(actorUserId: string): Promise<ClaimFollowUpScanResult> {
    const now = new Date();
    const awaiting = await this.claims.findClaimsAwaitingInsurerResponse();
    if (awaiting.length === ClaimRepository.FOLLOWUP_SWEEP_LIMIT) {
      // Ordered oldest-first, so the NEWEST pre-verdict claims are the ones
      // being dropped — they go un-chased run after run until the backlog
      // clears. Surface it rather than silently truncate a compliance sweep.
      this.logger.warn(
        `Claim follow-up sweep: the awaiting-response candidate set hit the ${ClaimRepository.FOLLOWUP_SWEEP_LIMIT}-row cap — the newest pre-verdict claims are not being scanned. Pagination is needed.`,
      );
    }

    let due = 0;
    let raised = 0;
    let skippedAlreadyAlerted = 0;
    let autoResolved = 0;
    let failed = 0;

    for (const claim of awaiting) {
      try {
        // The clock start is the REGISTERED history row (registration =
        // submission to the insurer). A pre-verdict claim should always have
        // one; if the #24 transition-then-history-row seam left it missing and
        // nothing has re-entered `register`, fall back to the claim's earliest
        // known instant (fires EARLIER — the safe direction for a chase nudge)
        // and warn so ops can see the gap.
        const registeredAt =
          claim.statusHistory.find((h) => h.toStatus === 'REGISTERED')
            ?.changedAt ?? null;
        let clockStart: Date;
        if (registeredAt) {
          clockStart = registeredAt;
        } else {
          const earliest = claim.statusHistory
            .map((h) => h.changedAt)
            .sort((a, b) => a.getTime() - b.getTime())[0];
          clockStart = earliest ?? claim.createdAt;
          this.logger.warn(
            `Claim follow-up sweep: claim ${claim.id} is ${claim.status} with no REGISTERED ClaimStatusHistory row — chasing from ${clockStart.toISOString()} instead (the #24 seam; a later register call would backfill it).`,
          );
        }
        if (
          !isClaimFollowUpDue(clockStart, claim.followUpAlertThresholdDays, now)
        ) {
          continue;
        }
        due += 1;
        if (claim.followUpAlerts.length > 0) {
          skippedAlreadyAlerted += 1;
          continue;
        }
        const { created, alert } = await this.claims.raiseFollowUpAlert(
          claim.id,
          now,
        );
        if (created && alert) {
          raised += 1;
          await this.safeAudit({
            userId: actorUserId,
            action: 'CREATE',
            entityType: 'ClaimFollowUpAlert',
            entityId: alert.id,
            afterValue: claimFollowUpAlertAuditSnapshot({
              claimFollowUpAlertId: alert.id,
              claimId: claim.id,
              triggeredAt: alert.triggeredAt,
              resolvedAt: null,
              thresholdDays: claim.followUpAlertThresholdDays,
              registeredAt: clockStart,
            }),
          });
        } else {
          // A concurrent sweep created the open alert between our
          // findMany and the insert.
          skippedAlreadyAlerted += 1;
        }
      } catch (err) {
        failed += 1;
        this.logger.error(
          `Claim follow-up sweep: claim ${claim.id} failed (${(err as Error).message}) — continuing; next run will retry.`,
        );
      }
    }

    const responded =
      await this.claims.findOpenFollowUpAlertsForRespondedClaims();
    if (responded.length === ClaimRepository.FOLLOWUP_SWEEP_LIMIT) {
      this.logger.warn(
        `Claim follow-up sweep: the resolvable-alert set hit the ${ClaimRepository.FOLLOWUP_SWEEP_LIMIT}-row cap — the rest resolve on the next run.`,
      );
    }
    for (const alert of responded) {
      try {
        const n = await this.claims.resolveFollowUpAlert(alert.id, now);
        if (n === 1) {
          autoResolved += 1;
          await this.safeAudit({
            userId: actorUserId,
            action: 'UPDATE',
            entityType: 'ClaimFollowUpAlert',
            entityId: alert.id,
            afterValue: claimFollowUpAlertAuditSnapshot({
              claimFollowUpAlertId: alert.id,
              claimId: alert.claim.id,
              triggeredAt: alert.triggeredAt,
              resolvedAt: now,
              resolvedBy: 'sweep',
            }),
          });
        }
      } catch (err) {
        failed += 1;
        this.logger.error(
          `Claim follow-up sweep: resolving alert ${alert.id} failed (${(err as Error).message}) — continuing; next run will retry.`,
        );
      }
    }

    return {
      awaiting: awaiting.length,
      due,
      raised,
      skippedAlreadyAlerted,
      autoResolved,
      failed,
    };
  }

  /**
   * Process 27 — a Claims Officer manually resolves an open follow-up alert
   * (they chased the insurer and have a commitment; the claim's own status is
   * not touched). Idempotent: an already-resolved alert is a no-op; a
   * concurrent resolve (`updateMany` 0 rows) is treated the same. An alert id
   * that is not on this claim is a 404 (no cross-claim resolve).
   */
  async resolveFollowUpAlert(
    id: string,
    alertId: string,
    actor: AuthenticatedUser,
  ): Promise<ClaimView> {
    const claim = await this.loadVisibleClaim(id, actor);
    const alert = claim.followUpAlerts.find((a) => a.id === alertId);
    if (!alert) {
      throw new NotFoundException('Follow-up alert not found');
    }
    if (!alert.resolvedAt) {
      const now = new Date();
      const n = await this.claims.resolveFollowUpAlert(alertId, now);
      if (n === 1) {
        await this.safeAudit({
          userId: actor.id,
          action: 'UPDATE',
          entityType: 'ClaimFollowUpAlert',
          entityId: alertId,
          afterValue: claimFollowUpAlertAuditSnapshot({
            claimFollowUpAlertId: alertId,
            claimId: id,
            triggeredAt: alert.triggeredAt,
            resolvedAt: now,
            resolvedBy: 'manual',
          }),
        });
      }
    }
    return this.toViewAudited(id, actor, 'claim-followup-resolve');
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

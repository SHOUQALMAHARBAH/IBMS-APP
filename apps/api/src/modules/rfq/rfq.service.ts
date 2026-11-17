import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type {
  Article15DPremiumAlert,
  CommunicationLog,
  InteractionChannel,
  OpportunityStatus,
  RfqArticle15DExemption,
} from '@ibms/db';
import {
  RfqRepository,
  type RfqCommunicationRow,
  type RfqInsurerWithInsurer,
  type RfqInsurerWithParents,
  type RfqWithSubmissions,
  type SelectableInsurer,
} from '../../repositories/rfq.repository';
import { insurerIdentity } from '../../repositories/insurer-identity';
import { insuranceLineNameAr } from '../../repositories/insurance-line-names';
import { OpportunityRepository } from '../../repositories/opportunity.repository';
import { InsuranceProgramRepository } from '../../repositories/insurance-program.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { canReadAllCustomerFileOwners } from '../../common/rbac-visibility.util';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import { isFollowUpDue } from './rfq.config';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateRfqDto } from './dto/create-rfq.dto';
import type { AddRfqInsurersDto } from './dto/add-rfq-insurers.dto';
import type { TransitionRfqInsurerDto } from './dto/transition-rfq-insurer.dto';
import type { LogRfqCommunicationDto } from './dto/log-rfq-communication.dto';
import type { AttachArticle15DEvidenceDto } from './dto/attach-article-15-d-evidence.dto';
import type { ListRfqsQueryDto } from './dto/list-rfqs-query.dto';
import { assertWithinRoleScope } from '../../common/role-scope';
import { InsuranceLineRepository } from '../../repositories/insurance-line.repository';
import {
  CustomerFileAnchorService,
  type CustomerFileAnchor,
} from './customer-file-anchor.service';
import { LicenseGateService } from '../compliance-risk/license-gate.service';
import { exemptionLacksEvidence } from '../compliance-risk/article-15-d.config';
import type { IssuanceStamp } from '../compliance-risk/license-gate.service';
import { Article15DService } from '../compliance-risk/article-15-d.service';
import { PermissionsService } from '../rbac/services/permissions.service';
import type { Article15DOptions } from '../compliance-risk/article-15-d.service';
import type { Article15DOptionsQueryDto } from './dto/article-15-d-options-query.dto';

/**
 * 🔴 THE INSURER'S NAME, RESOLVED BEFORE THE RFQ LEAVES THIS SERVICE — AND IT WAS A LIVE DEFECT.
 *
 * ## What was measured, on the owner's demo-path walk of 2026-11-17 (§W3)
 *
 * The submissions table on `/rfqs/[id]` showed **three rows with an empty insurer column**, while
 * the quotations block further down the same page named the same insurers. The cell reads
 * `submission.insurer.name`, and the web's `SelectableInsurer` type declares `{ id, name, nameAr,
 * … }`.
 *
 * ⟶ **The API side is the wrong one.** `INSURER_IDENTITY_SELECT` returns the RAW identity row —
 *   `legalName`, `legalNameAr`, and the `insuranceCompany` / `insurerMaster` sources behind them —
 *   and `insurerIdentity()` is what collapses those into the `{ name, nameAr }` pair the wire has
 *   always been documented to carry. `findSelectableInsurers` calls it, which is why the PICKER on
 *   `/rfqs/new` renders names correctly; the three RFQ reads did not, so the same web type met two
 *   different shapes and `.name` was `undefined`.
 *
 * ⚠️ `undefined` renders as NOTHING in React. The screen did not fail, it printed an empty cell —
 * the same silent shape as the `DocumentCategory` labels message 44 found, and for the same
 * reason: TypeScript believed a declared type that the runtime did not supply.
 *
 * ## Why it is resolved HERE and not in the repository
 *
 * `RfqWithSubmissions` is consumed INTERNALLY by the comparison and quotation services, which want
 * the identity row. Resolving in the repository would change what those callers see in order to
 * fix what the web sees. This is the wire boundary: the four methods that hand an RFQ to a
 * controller map through it, and nothing else does.
 *
 * ⛔ And the precedence is NOT re-implemented here. `insurerIdentity` picks ONE source (registered
 * company, then the global catalogue, then the office's own row) and reads BOTH names from it —
 * its own comment records the drift a per-field `??` caused once. One home, called.
 *
 * ⚠️ AND THESE TYPES ARE DELIBERATELY NOT GENERIC. The first version took
 * `<T extends { insurerSubmissions: … }>` and mapped `Omit` over `T` — which is more general and
 * cost the whole `apps/api` typecheck: `tsc` died with exit 134, `JavaScript heap out of memory`,
 * distributing that conditional across the Prisma payload types. Two concrete aliases compile in
 * seconds and say exactly the same thing about the only two shapes that exist.
 */
type ResolvedInsurer = ReturnType<typeof insurerIdentity>;

/** One submission as it leaves this service. */
export type RfqInsurerForWire = Omit<RfqInsurerWithInsurer, 'insurer'> & {
  insurer: ResolvedInsurer;
};

/**
 * An RFQ as it leaves this service: every submission's insurer resolved to its name pair, and
 * the insurance line carrying its own Arabic name.
 *
 * 🔴 `insuranceLineAr` IS SENT RATHER THAN LOOKED UP ON THE SCREEN, and the reason is a
 * permission the web cannot have: `GET /insurance-lines` is gated on five codes and `policy.read`
 * is not one of them, so two roles that may read these records could not resolve a line name.
 * See `insurance-line-names.ts` for the measurement. ⛔ Widening that gate was not the answer.
 */
export type RfqForWire = Omit<
  RfqWithSubmissions,
  'insurerSubmissions' | 'insuranceLine_managed' | 'officeInsuranceLine'
> & {
  insurerSubmissions: RfqInsurerForWire[];
  insuranceLineAr: string | null;
};

function rfqForWire(rfq: RfqWithSubmissions): RfqForWire {
  /*
   * ⛔ THE TWO JOINED ROWS ARE STRIPPED, NOT MERELY SUPPLEMENTED — and this batch's own new
   * assertion caught its author not doing it. Spreading `...rfq` put `insuranceLine_managed`
   * and `officeInsuranceLine` on the wire beside the resolved `insuranceLineAr`: two ways to
   * answer one question, which is the raw-join-as-payload shape that left the insurer column
   * blank in the first place.
   */
  const { insuranceLine_managed, officeInsuranceLine, ...rest } = rfq;
  // `void` because this project's eslint has no `varsIgnorePattern`, so an `_`-prefixed binding
  // is still an unused variable. Naming them plainly and discarding them says what is happening
  // more clearly than a prefix convention the linter does not share.
  void insuranceLine_managed;
  void officeInsuranceLine;
  return {
    ...rest,
    insuranceLineAr: insuranceLineNameAr(rfq),
    /*
     * `s` is ANNOTATED, and it has to be: `RfqWithSubmissions` is an INTERSECTION of the plain
     * Prisma payload with `{ insurerSubmissions: RfqInsurerWithInsurer[] }`, so the inferred
     * element type is the plain row — which has `insurerId` and no `insurer` at all.
     */
    insurerSubmissions: rfq.insurerSubmissions.map(
      (s: RfqInsurerWithInsurer) => ({
        ...s,
        insurer: insurerIdentity(s.insurer),
      }),
    ),
  };
}

/** Result of one follow-up sweep run — logged by the scheduler. Only
 * `candidates` and `due` are row counts; the tallies below are per-step and
 * **overlap** — one due row can bump `alerted` *and* `autoNoResponse`, or
 * `alerted` *and* `failed`, in the same iteration. `due` is not their sum.
 * `skippedQuoted` does NOT overlap the rest — such a row is dropped before
 * the threshold check, so it is not in `due`. */
export interface FollowUpScanResult {
  /** Open submissions (SENT / VIEWED) examined. */
  candidates: number;
  /** Of those, how many cleared the business-day threshold this run. */
  due: number;
  /** Of the due ones, how many this run newly stamped `followUpAlertSentAt`
   * (a concurrent sweep, or a prior alert-only run, may have stamped some
   * first — `stampFollowUpAlert` returns 0). */
  alerted: number;
  /** Of the due ones, how many this run moved SENT/VIEWED -> NO_RESPONSE
   * through the workflow engine. */
  autoNoResponse: number;
  /** Due rows whose NO_RESPONSE transition was a no-op because the insurer
   * responded concurrently (engine ConflictException / illegal-move 422) —
   * expected, not an error. */
  transitionSkipped: number;
  /** Open submissions dropped because their `(rfqId, insurerId)` already has
   * a current `Quotation` (backlog Part C #13) — an insurer that quoted is
   * not "silent" even if its best-effort `RFQInsurer -> QUOTED` move failed
   * on capture. Skipped before the threshold check, so NOT counted in `due`.
   * See ibms-brain/meta/context/policy-lifecycle.md § RFQ follow-up. */
  skippedQuoted: number;
  /** Rows that threw unexpectedly and were skipped — the next run retries. */
  failed: number;
}

const P2002 = 'P2002';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === P2002
  );
}

/**
 * Process 11 — RFQ / Market Submission (backlog Part C #11) + Process 12 —
 * Market Placement (backlog Part C #12), Domain B.
 *
 *  - `createRfq` — one RFQ per insurance line under an Opportunity, sent to a
 *    shortlist of insurers (each a SENT `RFQInsurer` row). One RFQ per
 *    `(opportunity, insuranceLine)` is a real DB invariant
 *    (`@@unique`, ibms-brain/meta/lex/race-safe-invariants.md); the first
 *    RFQ moves the Opportunity NEEDS_CONFIRMED -> RFQ_ISSUED via
 *    WorkflowTransitionService (A.6).
 *  - `addInsurers` — broaden a shortlist later (skips insurers already on it,
 *    the `@@unique([rfqId, insurerId])` being the backstop).
 *  - `transitionInsurer` — record an insurer's response status
 *    (viewed/quoted/declined/no-response) through the workflow engine;
 *    QUOTED / DECLINED stamp `respondedAt`.
 *  - `logCommunication` / `listCommunications` (#12) — the broker<->insurer
 *    correspondence log for an RFQ ("answer insurer queries and supply
 *    additional information"). Rows live on the shared `CommunicationLog`
 *    table; a factual log — no workflow status, no maker/checker. The CREATE
 *    audit row carries metadata only, never the free-text `body`
 *    (Confidential — loss history, sums insured;
 *    ibms-brain/meta/lex/sensitive-data-handling.md).
 *  - `runFollowUpScan` — the nightly sweep: on every still-open submission
 *    past its RFQ's business-day `followUpThresholdDays`, stamps
 *    `followUpAlertSentAt` + writes an audit row AND (#12) moves it
 *    SENT/VIEWED -> NO_RESPONSE through the workflow engine. Race-safe: a
 *    concurrent manual QUOTED/DECLINED makes the transition a no-op (engine
 *    ConflictException / illegal-move 422), caught and counted as skipped.
 *    A submission whose insurer already has a current `Quotation` (#13) is
 *    dropped before the threshold check — it responded, whatever its status
 *    column says.
 *
 * No maker/checker: issuing an RFQ, recording insurer responses, and logging
 * correspondence is single-actor Placement work, and the coverage set was
 * maker/checker-approved at the Needs Assessment stage (A.5).
 *
 * Visibility mirrors InsuranceProgramService / OpportunityService: an RFQ
 * inherits its Opportunity's Customer's visibility — the owning
 * Sales/Relationship Officer, or a `customer-file.all-owners.read` holder
 * (Placement/Manager/Executive) working the whole book.
 */
@Injectable()
export class RfqService {
  private readonly logger = new Logger(RfqService.name);

  constructor(
    private readonly rfqs: RfqRepository,
    private readonly opportunities: OpportunityRepository,
    private readonly programs: InsuranceProgramRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
    // Module 0 item (h). A REPOSITORY across the module boundary — this codebase's one
    // established cross-module shape — for the line's own `category`, which the role-scope
    // decision needs and this module has no other way to know.
    private readonly lines: InsuranceLineRepository,
    /* DOOR FOUR. Local to this module on purpose — see that service's header: if it lived in
     * `common/` the next service wanting cross-owner reach would import it, and the widening
     * this design refused would arrive one import at a time. */
    private readonly anchors: CustomerFileAnchorService,
    private readonly licenseGate: LicenseGateService,
    /* ART. 15/d. A SERVICE across the module boundary rather than a repository, which is the
     * same shape `licenseGate` above already takes — and for the same reason: what is needed
     * here is not rows but a RULE, and reimplementing "how many insurers is enough, and what
     * exempts a request from it" inside this module would be the second answer to a legal
     * question. One gate, two callers, exactly as the licence gate is. */
    private readonly article15D: Article15DService,
    /* The caller's granted codes, for the declaration's own permission. ⛔ Checked in the
     * BRANCH rather than by a route decorator: the route is `POST /rfqs` and its code is
     * `rfq.create`, so a decorator would demand the declaration permission of every quote
     * request — including the 84.3% that never meet art. 15/d. */
    private readonly permissions: PermissionsService,
  ) {}

  private canReachAnyCustomer(actor: AuthenticatedUser): boolean {
    return canReadAllCustomerFileOwners(actor);
  }

  /** Logged, not thrown — the real write already committed. */
  private async safeAudit(
    input: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `RFQ audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed`,
        err as Error,
      );
    }
  }

  /** NotFoundException whether the customer is missing or just not visible —
   * no existence oracle (same pattern as OpportunityService). */
  private async assertCustomerVisible(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const customer = await this.customers.findById(customerId);
    if (
      !customer ||
      (!this.canReachAnyCustomer(actor) && customer.ownerUserId !== actor.id)
    ) {
      throw new NotFoundException('Customer not found');
    }
  }

  /** Loads an Opportunity and enforces the caller's visibility on its
   * Customer; every failure mode collapses to one NotFoundException with the
   * given label. */
  private async assertOpportunityVisible(
    opportunityId: string,
    actor: AuthenticatedUser,
    label: string,
  ): Promise<{
    id: string;
    customerId: string;
    status: OpportunityStatus;
    insuranceProgramId: string | null;
  }> {
    const opportunity = await this.opportunities.findById(opportunityId);
    if (!opportunity) {
      throw new NotFoundException(label);
    }
    try {
      await this.assertCustomerVisible(opportunity.customerId, actor);
    } catch {
      throw new NotFoundException(label);
    }
    return {
      id: opportunity.id,
      customerId: opportunity.customerId,
      status: opportunity.status,
      insuranceProgramId: opportunity.insuranceProgramId,
    };
  }

  /** An RFQ can only be worked (shortlist broadened, responses recorded)
   * while its Opportunity is still in the market phase. Modelled ahead of
   * #16-17, which add the CLOSED_LOST / PLACEMENT moves that make this
   * meaningful. */
  private assertOpportunityInMarketPhase(status: OpportunityStatus): void {
    if (status !== 'NEEDS_CONFIRMED' && status !== 'RFQ_ISSUED') {
      throw new UnprocessableEntityException(
        `The parent Opportunity is ${status}; its RFQs can no longer be changed.`,
      );
    }
  }

  private async findVisibleRfq(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{
    rfq: RfqWithSubmissions;
    opportunityStatus: OpportunityStatus;
    opportunityCustomerId: string;
  }> {
    const rfq = await this.rfqs.findRfqById(id);
    if (!rfq) {
      throw new NotFoundException('RFQ not found');
    }
    const opportunity = await this.assertOpportunityVisible(
      rfq.opportunityId,
      actor,
      'RFQ not found',
    );
    return {
      rfq,
      opportunityStatus: opportunity.status,
      opportunityCustomerId: opportunity.customerId,
    };
  }

  /**
   * DOOR FOUR — the READ path, and the only place an anchor is consulted.
   *
   * Everything `findVisibleRfq` admits, this admits. It additionally admits a caller who owns no
   * part of this customer's file but holds an OPEN piece of work on that customer assigned to them
   * — an open DSR they are handling, or an open screening case assigned to them. See
   * `customer-file-anchor.service.ts` for why that is not a permission code.
   *
   * IT IS A SEPARATE METHOD RATHER THAN A FLAG, deliberately. `findVisibleRfq` has four callers and
   * THREE of them are writes (`addInsurers`, `logCommunication`, `attachArticle15DEvidence`); the
   * fourth is OWNER DECISION 143's evidence picker, a read that takes the strict policy because it
   * feeds one of those writes. ⚠️ CORRECTED 2026-11-16: this said «two of them are writes» and
   * named two, which stopped being true when decision 139's attach landed on 2026-11-15 — a count
   * in prose is a count that goes stale silently, which is why the spec beside it pins the figure.
   * A boolean parameter defaulting to
   * "no anchors" is precisely how a write path acquires cross-owner reach from somebody being
   * helpful. Writes keep the owner-only policy by construction, not by remembering.
   *
   * The returned `anchor` is non-null ONLY when the ownership filter would have refused — which is
   * exactly the condition the audit rule keys on, so the caller cannot get that wrong either.
   */
  private async findReadableRfq(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{
    rfq: RfqWithSubmissions;
    opportunityCustomerId: string;
    anchor: CustomerFileAnchor | null;
  }> {
    const rfq = await this.rfqs.findRfqById(id);
    if (!rfq) {
      throw new NotFoundException('RFQ not found');
    }
    const opportunity = await this.opportunities.findById(rfq.opportunityId);
    if (!opportunity) {
      throw new NotFoundException('RFQ not found');
    }
    /*
     * ONE DECISION FOR THE LIST AND THE DETAIL. `resolveCustomerReadAccess` is the only place that
     * compares an actor against a customer file and falls back to an anchor; two copies would be
     * two answers to one question, and the list is the copy that would drift.
     *
     * The sentence is re-thrown as "RFQ not found" rather than "Customer not found" because that
     * is what the caller asked for — and both are the same refusal, deliberately: a 403 here would
     * confirm that another officer's record exists.
     */
    let anchor: CustomerFileAnchor | null;
    try {
      anchor = await this.resolveCustomerReadAccess(
        opportunity.customerId,
        actor,
      );
    } catch {
      throw new NotFoundException('RFQ not found');
    }
    return { rfq, opportunityCustomerId: opportunity.customerId, anchor };
  }

  /**
   * THE AUDIT ROW IS HALF OF DOOR FOUR, NOT A DECORATION ON IT.
   *
   * An anchored visibility can be abused by opening a sham DSR or a sham screening case. Nothing
   * prevents that. What makes it better than a blanket grant is that the read is tied to a NAMED
   * record at a NAMED time, so five cases opened in a day on unconnected customers are VISIBLE —
   * and a blanket grant leaves no trace at all.
   *
   * SO IT IS NOT `safeAudit`. If the row cannot be written the read fails, and the blast radius of
   * that is bounded to anchored reads alone: the owner of a file and a whole-book reader never
   * reach this method, so an audit outage cannot break ordinary work.
   *
   * ONLY WHEN THE OWNERSHIP FILTER WOULD HAVE REFUSED. A one-person office owns every customer
   * file, so it produces ZERO of these rows — which is the point, and why the rule is keyed on the
   * anchor rather than on the role: logging every page an owner opens on his own files is noise,
   * and under the retention decision its volume is the office's own cost.
   */
  private async auditAnchoredRead(
    actor: AuthenticatedUser,
    entity: { type: 'RFQ' | 'Customer'; id: string },
    customerId: string,
    view: 'rfq' | 'communications' | 'rfq-list',
    anchor: CustomerFileAnchor,
    extra: Record<string, string | number> = {},
  ): Promise<void> {
    await this.audit.record({
      userId: actor.id,
      action: 'READ',
      entityType: entity.type,
      /*
       * THE ENTITY IS THE THING READ, and for the LIST that is the CUSTOMER rather than any one
       * RFQ. A list read is not a read of an RFQ, and recording it against one id would make the
       * audit trail answer "who read RFQ X" with somebody who read a chain X happened to be in.
       * The count goes in `afterValue` instead — a count is not a set, and copying the ids of what
       * was read into the log duplicates the thing being searched (the `/internal-controls`
       * precedent).
       */
      entityId: entity.id,
      // A cross-owner read of a customer's commercial file. The RFQ header names which customer is
      // in the market for what cover; the correspondence carries loss history and sums insured.
      isSensitiveDataAccess: true,
      afterValue: {
        view,
        // THE ANCHOR, by type and id — so "why was this allowed" is answerable from the log alone
        // rather than by re-running a query whose answer has since changed.
        anchorType: anchor.type,
        anchorId: anchor.id,
        customerId,
        ...extra,
      },
    });
    // The ROLE the read came under is on the row already: `AuditService.record` stamps
    // `actorRoleNames` from the request's own resolved roles, so it is not restated here. A second
    // copy would be a second answer to one question.
  }

  private async mustFindRfq(id: string): Promise<RfqWithSubmissions> {
    const rfq = await this.rfqs.findRfqById(id);
    if (!rfq) {
      throw new NotFoundException(`RFQ ${id} not found`);
    }
    return rfq;
  }

  /**
   * Every shortlisted insurer must be one this office still deals with.
   *
   * Two refusals, not one, because they mean different things to whoever hits
   * them. An unknown id is a client bug. A DEACTIVATED insurer is a decision the
   * office made deliberately and can undo, so the message names the insurers and
   * says what to do — refusing with "does not exist" for a company sitting in the
   * office's own list would send someone hunting for a bug that is not there.
   *
   * This is the chokepoint for starting new business with an insurer: a quotation
   * must be on an RFQ's shortlist, and a policy is placed from a quotation. So
   * guarding the shortlist is what stops a deactivated insurer being taken to
   * market at all.
   */
  private async assertInsurersSelectable(insurerIds: string[]): Promise<void> {
    if (insurerIds.length === 0) {
      throw new UnprocessableEntityException(
        'Select at least one insurer for the shortlist.',
      );
    }
    const { inactiveIds, unknownIds } =
      await this.rfqs.classifyInsurersByIds(insurerIds);
    if (unknownIds.length > 0) {
      throw new UnprocessableEntityException(
        'One or more shortlisted insurers do not exist.',
      );
    }
    if (inactiveIds.length > 0) {
      throw new UnprocessableEntityException(
        `Cannot shortlist a deactivated insurer (${inactiveIds.join(', ')}). Reactivate it from the insurer screen, or choose another — its existing policies, claims and invoices are unaffected either way.`,
      );
    }
  }

  /** The RFQ line must be one of the canonical `insuranceLine` strings on the
   * designed Insurance Program (Process 7) the Opportunity was taken to
   * market from — a typo or an off-programme line would otherwise seed a
   * first-class RFQ that #13 (Quotation) / #14 (Comparison) / #16
   * (Recommendation) all key off. Skipped only when the Opportunity has no
   * programme (not reachable in this backlog item — `POST /opportunities`
   * always sets one — but modelled ahead of new-business Opportunities). */
  private async assertLineInProgramme(
    insuranceProgramId: string | null,
    insuranceLine: string,
  ): Promise<{
    insuranceLineId: string | null;
    officeInsuranceLineId: string | null;
  }> {
    // RETURNS the matched programme line's managed-line reference rather than void, and that is
    // the change: the RFQ INHERITS its line identity from the programme line it was taken to
    // market from. "A programme line becomes an RFQ" then means the same line by construction,
    // instead of two independent lookups from the same string that have to agree forever.
    //
    // No programme, or no programme found: no identity to inherit. Reported as nulls rather than
    // resolved from the string here, because a second resolution path is the defect.
    const none = { insuranceLineId: null, officeInsuranceLineId: null };
    if (!insuranceProgramId) return none;
    const programme = await this.programs.findById(insuranceProgramId);
    if (!programme) return none;

    const matched = programme.lines.find(
      (l) => l.insuranceLine === insuranceLine,
    );
    if (!matched) {
      const lines = programme.lines.map((l) => l.insuranceLine);
      throw new UnprocessableEntityException(
        `"${insuranceLine}" is not a line on this Opportunity's Insurance Program. Designed lines: ${lines.join(', ') || '(none)'}.`,
      );
    }
    return {
      insuranceLineId: matched.insuranceLineId,
      officeInsuranceLineId: matched.officeInsuranceLineId,
    };
  }

  /**
   * MODULE 0 ITEM (h) — the role scope, on the line this RFQ inherits.
   *
   * Re-checked here even though the programme line was checked when it was designed, and that is
   * the point rather than belt-and-braces: a different person with a different scope takes the
   * programme to market, and a scope that was only ever checked upstream would let a LIFE-scoped
   * officer raise a general RFQ from a programme somebody else designed.
   *
   * A line this office cannot resolve (both ids null — an Opportunity with no programme) is not
   * refused: there is no line to be outside of, and refusing would block a path the RFQ module
   * already models deliberately.
   */
  private async assertLineWithinScope(
    inherited: {
      insuranceLineId: string | null;
      officeInsuranceLineId: string | null;
    },
    actor: AuthenticatedUser,
  ): Promise<void> {
    const lineId =
      inherited.insuranceLineId ?? inherited.officeInsuranceLineId ?? null;
    if (lineId === null) return;
    const category = await this.lines.findCategory(
      inherited.insuranceLineId,
      inherited.officeInsuranceLineId,
    );
    if (!category) return;
    assertWithinRoleScope(
      actor,
      { category, lineId },
      'take this line to market',
    );
  }

  /** Inserts the RFQ row, mapping the `@@unique([opportunityId,
   * insuranceLine])` violation (a concurrent createRfq for the same line
   * lost the race) to the same 409 the pre-check raises. */
  private async insertRfqRow(
    dto: CreateRfqDto,
    actorId: string,
    inheritedLine: {
      insuranceLineId: string | null;
      officeInsuranceLineId: string | null;
    },
    /** 🔴 OWNER DECISION 128 — the stamp the gate returned when it permitted this request.
     *  Passed IN rather than re-derived here: the gate ran before the row existed, and asking
     *  the licence again now would read it at a second instant. */
    stamp: IssuanceStamp,
  ): Promise<RfqWithSubmissions> {
    try {
      const created = await this.rfqs.createRfq({
        opportunityId: dto.opportunityId,
        insuranceLine: dto.insuranceLine,
        // Copied from the programme line, not resolved from the string above.
        insuranceLineId: inheritedLine.insuranceLineId,
        officeInsuranceLineId: inheritedLine.officeInsuranceLineId,
        followUpThresholdDays: dto.followUpThresholdDays,
        issuedByUserId: actorId,
        issuedUnderStudyLicenseId: stamp.issuedUnderStudyLicenseId,
      });
      return await this.mustFindRfq(created.id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Opportunity ${dto.opportunityId} already has an RFQ for "${dto.insuranceLine}" — add insurers to it instead of creating another.`,
        );
      }
      throw err;
    }
  }

  /** Best-effort NEEDS_CONFIRMED -> RFQ_ISSUED on the first RFQ. The RFQ is
   * already committed + audited by the time this runs, so a concurrent
   * create() that moved the Opportunity first (ConflictException), or any
   * other transition hiccup (including a swallowed audit-write failure inside
   * transition()), is logged — never surfaced as a failure of the RFQ
   * creation (same philosophy as WorkflowTransitionService's own sideEffect
   * catch).
   *
   * Consequence for Process 12+: `Opportunity.status` is NOT a reliable "has
   * RFQs" signal — an RFQ can exist while its Opportunity is still
   * NEEDS_CONFIRMED (this move lost a race or hit a transient error). Derive
   * "the Opportunity has been to market" from the RFQ table, not the status
   * column. The next createRfq for another line retries this move. */
  private async markOpportunityRfqIssued(
    opportunityId: string,
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.workflow.transition({
        entityType: 'Opportunity',
        entityId: opportunityId,
        toStatus: 'RFQ_ISSUED',
        actorUserId,
      });
    } catch (err) {
      this.logger.warn(
        `RFQ issued for Opportunity ${opportunityId} but the NEEDS_CONFIRMED -> RFQ_ISSUED transition did not apply: ${(err as Error).message}`,
      );
    }
  }

  async createRfq(
    dto: CreateRfqDto,
    actor: AuthenticatedUser,
    /** The caller's network address, threaded from the controller by `clientIpForRecord`. An
     *  art. 15/d declaration records it; NULL when there genuinely is none. */
    networkAddress: string | null = null,
  ): Promise<RfqForWire> {
    /*
     * ز.١ — A NEW QUOTE REQUEST TO INSURERS. Blocked FIRST, before the visibility read, because the
     * licence is the thing the caller cannot change by editing the request — art. 3/a's own
     * ordering argument, reused.
     */
    const stamp = await this.licenseGate.assertMayPractise(
      'REQUEST_QUOTES',
      async () => {
        // Art. 21/b/5 — LAZY, so the licence check keeps its documented place ahead of the
        // reads and costs no extra query unless the office actually has a partial suspension.
        const scoped = await this.assertOpportunityVisible(
          dto.opportunityId,
          actor,
          'Opportunity not found',
        );
        return this.assertLineInProgramme(
          scoped.insuranceProgramId,
          dto.insuranceLine,
        );
      },
    );
    const opportunity = await this.assertOpportunityVisible(
      dto.opportunityId,
      actor,
      'Opportunity not found',
    );

    if (
      opportunity.status !== 'NEEDS_CONFIRMED' &&
      opportunity.status !== 'RFQ_ISSUED'
    ) {
      throw new UnprocessableEntityException(
        `Opportunity ${opportunity.id} is ${opportunity.status}; an RFQ can only be issued while it is NEEDS_CONFIRMED or RFQ_ISSUED.`,
      );
    }

    const inheritedLine = await this.assertLineInProgramme(
      opportunity.insuranceProgramId,
      dto.insuranceLine,
    );

    // Item (h): the role scope, on the line just inherited — before the insurer shortlist is
    // validated, so a scoped officer gets the scope refusal rather than an insurer error about a
    // line they were never allowed to take to market.
    await this.assertLineWithinScope(inheritedLine, actor);

    const insurerIds = [...new Set(dto.insurerIds)];
    await this.assertInsurersSelectable(insurerIds);

    // The `@@unique([opportunityId, insuranceLine])` is the real enforcement
    // — insertRfqRow() maps its violation to 409. This pre-check is the fast
    // path: a descriptive 409 naming the existing RFQ when there is no race.
    const existing = await this.rfqs.findRfqByOpportunityAndLine(
      dto.opportunityId,
      dto.insuranceLine,
    );
    if (existing) {
      throw new ConflictException(
        `Opportunity ${dto.opportunityId} already has an RFQ for "${dto.insuranceLine}" (${existing.id}) — add insurers to it instead.`,
      );
    }

    /*
     * ART. 15/d — «التواصل مع ثلاث شركات تأمين». OWNER DECISIONS 126, 129, 130 and 133.
     *
     * ## 🔴 EVALUATED BEFORE THE ROW, APPLIED AFTER IT — AND THE SPLIT IS A DEFECT THE e2e FOUND
     *
     * Both records point AT the request, so the WRITES cannot come before it exists. The
     * REFUSALS can, and the first version did not separate them. The consequence was real: a
     * refused request left the RFQ row behind, and the employee's corrected second attempt got
     * **409 Conflict** from `@@unique([opportunityId, insuranceLine])` — told that a request
     * they could not see already existed, with no way to proceed on that line.
     *
     * ⟶ So `evaluate` refuses, then the row is inserted, then `apply` writes a plan that cannot
     *   fail for anything the caller could have fixed.
     *
     * ## AND IT IS ALL BEFORE THE SHORTLIST INSERT
     *
     * The count art. 15/d cares about is the shortlist the request is GOING to — the owner's
     * reading of 9 October, carried forward by decision 129 §3: it is the SENDING, not the
     * replies — so the count is known from `insurerIds` and needs no rows. A refused request has
     * therefore gone nowhere at all, which is the honest state.
     *
     * ⚠️ THE LICENCE CHECK STAYS AHEAD OF EVERYTHING HERE. `license-gate.e2e-spec.ts` asserts
     * the refusal message names `21/a/9`, so a licence failure must not be pre-empted by an art.
     * 15/d one — a suspended office being told about insurer counts would be the wrong answer to
     * the more serious question.
     */
    const article15DPlan = await this.article15D.evaluate({
      // The STANDARD line's code, which is what the exemptions are decided against. NULL for an
      // office-defined line, and that is the answer: such a line is not in the 32-row catalogue
      // art. 15/d's exemptions name, so only the two ungated ones are offered.
      lineCode: await this.lines.findStandardCode(
        inheritedLine.insuranceLineId,
      ),
      insurerCount: insurerIds.length,
      customerId: opportunity.customerId ?? null,
      choice: dto.article15D ?? {},
      grantedCodes: await this.permissions.getCodesForRoles(actor.roleIds),
      actorUserId: actor.id,
      networkAddress,
      // The REQUEST's own moment, so decision 129's criterion 4 holds: change the ceiling row
      // with a new effective date and this request keeps the value it was sent under.
      at: new Date(),
    });

    const rfq = await this.insertRfqRow(dto, actor.id, inheritedLine, stamp);

    await this.article15D.apply(article15DPlan, rfq.id);

    // Audit CREATE BEFORE the shortlist insert: a crash in between still
    // leaves a CREATE trail, and the resulting zero-insurer RFQ is
    // recoverable via addInsurers() (same ordering as
    // InsuranceProgramService.assemble).
    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'RFQ',
      entityId: rfq.id,
      afterValue: {
        opportunityId: dto.opportunityId,
        insuranceLine: dto.insuranceLine,
        followUpThresholdDays: rfq.followUpThresholdDays,
        shortlistInsurerIds: insurerIds,
      },
    });

    for (const insurerId of insurerIds) {
      try {
        await this.rfqs.createInsurerSubmission(rfq.id, insurerId);
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }

    if (opportunity.status === 'NEEDS_CONFIRMED') {
      await this.markOpportunityRfqIssued(opportunity.id, actor.id);
    }

    return rfqForWire(await this.mustFindRfq(rfq.id));
  }

  /**
   * ART. 15/d's QUESTION, answered for a request that does not exist yet.
   *
   * Resolves the line through the opportunity's own designed programme — the SAME call
   * `createRfq` makes — so the answer the screen is given and the rule the server will apply
   * cannot disagree. A screen told one set of exemptions and then refused a different one is
   * worse than no screen.
   *
   * ⚠️ VISIBILITY FIRST. A caller who cannot see the opportunity gets the same 404 every other
   * RFQ route gives them, before any figure is read: otherwise this route would answer questions
   * about another owner's opportunity, which is what `assertOpportunityVisible` exists to stop.
   */
  async article15DOptions(
    query: Article15DOptionsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<Article15DOptions> {
    const opportunity = await this.assertOpportunityVisible(
      query.opportunityId,
      actor,
      'Opportunity not found',
    );
    const inherited = await this.assertLineInProgramme(
      opportunity.insuranceProgramId,
      query.insuranceLine,
    );
    return this.article15D.optionsFor({
      lineCode: await this.lines.findStandardCode(inherited.insuranceLineId),
      insurerCount: query.insurerCount,
      customerId: opportunity.customerId ?? null,
      grantedCodes: await this.permissions.getCodesForRoles(actor.roleIds),
      at: new Date(),
    });
  }

  /**
   * 🔴 THE LINES THIS OPPORTUNITY CAN STILL BE TAKEN TO MARKET ON — §P3.
   *
   * ## What was measured on the owner's demo-path walk, 2026-11-17
   *
   * `insuranceLine` was a FREE-TEXT box. The server matches it byte-for-byte against the
   * programme's own line strings (`assertLineInProgramme`), which are the English programme
   * vocabulary — and the form's own hint offered two ARABIC examples, so a placement officer who
   * followed the screen's advice was refused by the server every time. The placeholder did the
   * same thing. ⟶ There is exactly one correct value per line and the system knows all of them,
   * which makes this a CHOICE rather than a field.
   *
   * ## The two things it excludes, and why each is the server's to decide
   *
   * 1. **A line not on the programme** — `assertLineInProgramme` refuses it, so offering it would
   *    be a screen contradicting its own server.
   * 2. **A line that already has an RFQ** — `@@unique([opportunityId, insuranceLine])` refuses
   *    the second one with a 409, and the walk found exactly that: an employee told a request they
   *    could not see already existed.
   *
   * ⛔ The SERVER's checks are NOT removed. This narrows what can be asked for; it does not
   * become the thing that enforces it. A directly-posted request still meets both.
   *
   * ⚠️ VISIBILITY FIRST, on the same `assertOpportunityVisible` every other RFQ route uses:
   * otherwise this would enumerate another owner's designed programme to anybody who guessed an
   * opportunity id.
   */
  async availableLines(
    opportunityId: string,
    actor: AuthenticatedUser,
  ): Promise<{ insuranceLine: string; insuranceLineAr: string | null }[]> {
    const opportunity = await this.assertOpportunityVisible(
      opportunityId,
      actor,
      'Opportunity not found',
    );
    if (!opportunity.insuranceProgramId) return [];
    const programme = await this.programs.findById(
      opportunity.insuranceProgramId,
    );
    if (!programme) return [];

    /*
     * The lines already taken to market, read from the RFQs themselves rather than from any
     * cached flag — the unique constraint is on this exact pair, so this is the same question
     * the database will be asked.
     */
    const taken = new Set(
      (await this.rfqs.findRfqsByOpportunityId(opportunityId)).map(
        (r) => r.insuranceLine,
      ),
    );
    return programme.lines
      .filter((l) => !taken.has(l.insuranceLine))
      .map((l) => ({
        insuranceLine: l.insuranceLine,
        insuranceLineAr: insuranceLineNameAr(l),
      }));
  }

  async addInsurers(
    rfqId: string,
    dto: AddRfqInsurersDto,
    actor: AuthenticatedUser,
  ): Promise<RfqForWire> {
    /*
     * AND ADDING AN INSURER IS THE SAME ACT, which is why it is gated too rather than left to the
     * creation check. The owner's words name the act as "a new quote request TO INSURERS" — an RFQ
     * carrying no insurers has gone nowhere, so the moment a request reaches the market is the
     * moment an insurer is added. Without this, an office could create the RFQ while licensed and
     * then solicit the market after its licence ended.
     *
     * Two call sites, ONE gate — which is what the gate is for. It is not two answers.
     */
    /*
     * ART. 21/b/5 — the RFQ is read ONCE, here, and its branch handed to the gate.
     *
     * Unlike `createRfq`, this site made no "before the reads" argument — its own comment is about
     * the ACT (soliciting the market is the same act as creating the request), not about ordering.
     * So the read is hoisted rather than duplicated in a thunk: one query instead of two, and
     * `customer-file-anchor.inventory.spec.ts` counts `findVisibleRfq(` occurrences to prove each
     * write path keeps the owner-only policy. A second textual call inside ONE write path does not
     * weaken that, and a bare count cannot tell the two apart — so the count is kept honest by not
     * adding one.
     */
    const visible = await this.findVisibleRfq(rfqId, actor);
    await this.licenseGate.assertMayPractise('REQUEST_QUOTES', visible.rfq);
    const { opportunityStatus } = visible;
    this.assertOpportunityInMarketPhase(opportunityStatus);

    const insurerIds = [...new Set(dto.insurerIds)];
    await this.assertInsurersSelectable(insurerIds);

    const alreadyOn = new Set(
      await this.rfqs.findExistingShortlistInsurerIds(rfqId, insurerIds),
    );
    const added: string[] = [];
    for (const insurerId of insurerIds) {
      if (alreadyOn.has(insurerId)) continue;
      try {
        await this.rfqs.createInsurerSubmission(rfqId, insurerId);
        added.push(insurerId);
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }

    if (added.length > 0) {
      await this.safeAudit({
        userId: actor.id,
        action: 'UPDATE',
        entityType: 'RFQ',
        entityId: rfqId,
        afterValue: { addedShortlistInsurerIds: added },
      });
    }

    return rfqForWire(await this.mustFindRfq(rfqId));
  }

  async transitionInsurer(
    submissionId: string,
    dto: TransitionRfqInsurerDto,
    actor: AuthenticatedUser,
  ): Promise<RfqInsurerWithParents> {
    const submission = await this.rfqs.findInsurerSubmissionById(submissionId);
    if (!submission) {
      throw new NotFoundException('RFQ submission not found');
    }
    try {
      await this.assertCustomerVisible(
        submission.rfq.opportunity.customerId,
        actor,
      );
    } catch {
      throw new NotFoundException('RFQ submission not found');
    }

    // Deliberately NOT gated on the Opportunity's market phase (unlike
    // createRfq / addInsurers): recording what an insurer actually did is a
    // factual log — a late QUOTED or DECLINED that lands after the business
    // was placed elsewhere is still worth capturing. The workflow engine's
    // own legal-move map (WORKFLOW_TRANSITIONS.RFQInsurer) is the only gate.

    // A terminal response stamps respondedAt alongside the status, in the
    // same write; VIEWED / NO_RESPONSE do not (an insurer can still respond
    // after either).
    const data =
      dto.toStatus === 'QUOTED' || dto.toStatus === 'DECLINED'
        ? { respondedAt: new Date() }
        : undefined;

    await this.workflow.transition({
      entityType: 'RFQInsurer',
      entityId: submissionId,
      toStatus: dto.toStatus,
      actorUserId: actor.id,
      data,
    });

    const updated = await this.rfqs.findInsurerSubmissionById(submissionId);
    if (!updated) {
      throw new NotFoundException('RFQ submission not found');
    }
    return updated;
  }

  async list(
    query: ListRfqsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<RfqForWire[]> {
    const { opportunityId, customerId } = query;
    if ((opportunityId && customerId) || (!opportunityId && !customerId)) {
      throw new UnprocessableEntityException(
        'Provide exactly one of opportunityId or customerId.',
      );
    }
    if (opportunityId) {
      /*
       * THE OPPORTUNITY FILTER IS NOT ANCHORED, DELIBERATELY, and it already refuses an
       * anchored-only reader through `assertCustomerVisible` below it. That is the right answer
       * rather than an oversight: an anchor is per CUSTOMER, and an Opportunity is a placement-path
       * object whose own id a reader outside that path has no way to know. Anchoring it would also
       * reopen the thing the design refused — a filter whose scope the anchor does not bound.
       */
      await this.assertOpportunityVisible(
        opportunityId,
        actor,
        'Opportunity not found',
      );
      return (await this.rfqs.findRfqsByOpportunityId(opportunityId)).map(
        rfqForWire,
      );
    }

    /*
     * DOOR FOUR ON THE LIST. `customerId` is REQUIRED here by the refusal at the top of this
     * method — exactly one of the two filters, never neither — so an UNFILTERED list is not a
     * thing this route can produce. That matters more for an anchored reader than for anybody
     * else: an unfiltered list handed to a reader whose anchor is one customer would be the
     * blanket key the whole design refused.
     */
    const anchor = await this.resolveCustomerReadAccess(
      customerId as string,
      actor,
    );
    const rows = await this.rfqs.findRfqsByCustomerId(customerId as string);
    if (anchor) {
      await this.auditAnchoredRead(
        actor,
        { type: 'Customer', id: customerId as string },
        customerId as string,
        'rfq-list',
        anchor,
        { rfqCount: rows.length },
      );
    }
    return rows.map(rfqForWire);
  }

  /**
   * DOOR FOUR's visibility decision, factored out so the LIST and the DETAIL cannot disagree.
   *
   * Returns `null` when the ownership filter admits the caller — the ordinary path, costing no
   * anchor query and writing no audit row — and the anchor when it is the anchor that admitted
   * them. Throws the same NotFound the ownership filter throws when neither does, because a 403
   * would confirm that another officer's record exists.
   */
  private async resolveCustomerReadAccess(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<CustomerFileAnchor | null> {
    const customer = await this.customers.findById(customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    if (this.canReachAnyCustomer(actor) || customer.ownerUserId === actor.id) {
      return null;
    }
    const anchor = await this.anchors.resolve(customerId, actor);
    if (!anchor) throw new NotFoundException('Customer not found');
    return anchor;
  }

  /** `opportunity.customerId` is resolved for the web RFQ detail page's
   * consent-capture control (Part D §5.1 touchpoint #4, RFQ/market
   * placement) — RFQ itself has no direct customerId, only via its parent
   * Opportunity, which `findVisibleRfq` already resolves for the visibility
   * check. */
  async get(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<
    RfqForWire & {
      opportunity: { customerId: string };
      article15DExemption:
        (RfqArticle15DExemption & { lacksEvidence: boolean }) | null;
      article15DAlerts: Article15DPremiumAlert[];
    }
  > {
    const { rfq, opportunityCustomerId, anchor } = await this.findReadableRfq(
      id,
      actor,
    );
    if (anchor) {
      await this.auditAnchoredRead(
        actor,
        { type: 'RFQ', id: rfq.id },
        opportunityCustomerId,
        'rfq',
        anchor,
      );
    }
    /*
     * ART. 15/d ON THE RECORD — decision 129's criterion 7 and the owner's own flow.
     *
     * «الإعفاء يُخزَّن مع الطلب، و«اختاره:» واسم الموظف» — the exemption is stored WITH the
     * request, and the record names who chose it. A row nobody can see is not a record: the
     * whole value of the exemption is that an inspector, and the office itself, can read what
     * the request was sent under.
     *
     * The ALERTS come with it. An art. 15/d/4 warning that lives only in a table is a warning
     * nobody receives, which reads exactly like no breach — and OWNER DECISION 126's shape is
     * that the system WARNS, which is a thing somebody has to be able to see.
     *
     * ⚠️ Both reads are tenant-scoped and both return NULL/empty for the overwhelming majority
     * of requests, which is the point: 84.3% of them rest on nothing because they reached three.
     */
    const [article15DExemption, article15DAlerts] = await Promise.all([
      this.article15D.findExemptionForRfq(rfq.id),
      this.article15D.findAlertsForRfq(rfq.id),
    ]);
    return {
      ...rfqForWire(rfq),
      opportunity: { customerId: opportunityCustomerId },
      /*
       * 🔴 OWNER DECISION 139 ruling 2 — THE MARK «بلا إثبات», DERIVED HERE AND SENT.
       *
       * «الإعفاء موسوم «بلا إثبات» على الطلب، وفي دفتر الأفعال المعلَنة للتفتيش، حتى تُرفَق
       * المراسلة.»
       *
       * Computed by `exemptionLacksEvidence` and put ON THE WIRE rather than left for the
       * screen to work out. The screen HAS the facts — `evidenceCommunicationLogId` is in
       * this payload — so deriving it there would compile and be right today, and would be
       * a SECOND HOME for the rule the moment either half changes. The web cannot import
       * the api's config, so the only way to keep one home is to send the answer.
       */
      article15DExemption:
        article15DExemption === null
          ? null
          : {
              ...article15DExemption,
              lacksEvidence: exemptionLacksEvidence(article15DExemption),
            },
      article15DAlerts,
    };
  }

  listSelectableInsurers(): Promise<SelectableInsurer[]> {
    return this.rfqs.findSelectableInsurers();
  }

  /**
   * Process 12 — log one broker<->insurer exchange on an RFQ (an insurer's
   * query, or the broker's answer / additional-information note). A factual
   * log: no workflow status, no maker/checker, and deliberately NOT gated on
   * the Opportunity's market phase — a late clarification after the business
   * was placed elsewhere is still worth recording (same reasoning as
   * `transitionInsurer`). `customerId` is backfilled from the RFQ's
   * Opportunity so the row also surfaces on that customer's file.
   */
  /**
   * 🔴 OWNER DECISION 139 ruling 4 — attach the evidence to an exemption that has none.
   *
   * THIS METHOD'S ONLY JOB IS VISIBILITY AND THE CUSTOMER. `findVisibleRfq` is what makes a
   * request for somebody else's customer a 404 rather than a refusal that confirms the record
   * exists, and it is where the opportunity's OWN customer comes from — which is the fact
   * `Article15DService` needs and must never take from the caller, or the wrong-customer refusal
   * could be defeated by naming a different one.
   *
   * Everything about what counts as evidence is decided in `Article15DService.attachEvidence`,
   * through the same `resolveEvidence` the original choice went through.
   */
  /**
   * 🔴 OWNER DECISION 143 — WHAT THE «إرفاق المراسلة» BUTTON OFFERS.
   *
   * THE SAME VISIBILITY RULE AS THE ATTACH ITSELF, and that is the whole reason this is here
   * rather than on the compliance service. `findVisibleRfq` makes a request for somebody else's
   * customer a 404 rather than an empty list — an empty list is an answer, and answering "this
   * customer has no approved inbound correspondence" about a customer the caller may not see is
   * a disclosure dressed as nothing.
   *
   * It is also where the customer comes from, for the reason the attach records: taken from the
   * caller, a picker could be made to list ANY customer's correspondence.
   */
  async listArticle15DEvidenceOptions(
    rfqId: string,
    actor: AuthenticatedUser,
  ): Promise<{ id: string; channel: InteractionChannel; sentAt: Date }[]> {
    const { opportunityCustomerId } = await this.findVisibleRfq(rfqId, actor);
    return this.article15D.evidenceOptionsFor(opportunityCustomerId);
  }

  async attachArticle15DEvidence(
    rfqId: string,
    dto: AttachArticle15DEvidenceDto,
    actor: AuthenticatedUser,
  ): Promise<{ attached: true }> {
    const { opportunityCustomerId } = await this.findVisibleRfq(rfqId, actor);
    return this.article15D.attachEvidence({
      rfqId,
      customerId: opportunityCustomerId,
      evidenceCommunicationLogId: dto.evidenceCommunicationLogId,
    });
  }

  async logCommunication(
    rfqId: string,
    dto: LogRfqCommunicationDto,
    actor: AuthenticatedUser,
  ): Promise<CommunicationLog> {
    const { rfq, opportunityCustomerId } = await this.findVisibleRfq(
      rfqId,
      actor,
    );

    if (
      dto.rfqInsurerId !== undefined &&
      !rfq.insurerSubmissions.some((s) => s.id === dto.rfqInsurerId)
    ) {
      throw new UnprocessableEntityException(
        `Submission ${dto.rfqInsurerId} is not on RFQ ${rfqId} — omit rfqInsurerId to address the whole panel, or pass one of this RFQ's shortlisted insurers.`,
      );
    }

    const sentAt =
      dto.occurredAt !== undefined
        ? parseHistoricalInstant(dto.occurredAt, 'occurredAt')
        : undefined;

    const row = await this.rfqs.createCommunication({
      rfqId,
      rfqInsurerId: dto.rfqInsurerId,
      customerId: opportunityCustomerId,
      direction: dto.direction,
      channel: dto.channel,
      subject: dto.subject,
      body: dto.body,
      loggedByUserId: actor.id,
      sentAt,
    });

    // Structural metadata only — the free-text `subject` / `body` are
    // Confidential (loss history, sums insured) and never go into an
    // AuditLogEntry (ibms-brain/meta/lex/sensitive-data-handling.md), exactly
    // like CRM's interaction audit which logs channel/occurredAt but not the
    // `summary`.
    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'RfqCommunication',
      entityId: row.id,
      afterValue: {
        rfqId,
        rfqInsurerId: dto.rfqInsurerId ?? null,
        direction: dto.direction,
        channel: dto.channel,
        sentAt: row.sentAt.toISOString(),
      },
    });

    return row;
  }

  async listCommunications(
    rfqId: string,
    actor: AuthenticatedUser,
  ): Promise<RfqCommunicationRow[]> {
    const { opportunityCustomerId, anchor } = await this.findReadableRfq(
      rfqId,
      actor,
    );
    if (anchor) {
      await this.auditAnchoredRead(
        actor,
        { type: 'RFQ', id: rfqId },
        opportunityCustomerId,
        'communications',
        anchor,
      );
    }
    return this.rfqs.findCommunicationsByRfqId(rfqId);
  }

  /**
   * The nightly follow-up sweep (also runnable on demand from a test). For
   * each still-open submission (SENT / VIEWED) whose RFQ's business-day
   * `followUpThresholdDays` has elapsed since `sentAt`:
   *   1. stamp `followUpAlertSentAt` + write an audit row (race-safe —
   *      `stampFollowUpAlert` is conditional on it still being null, so a
   *      re-run / concurrent sweep does not re-alert);
   *   2. (backlog Part C #12) move it SENT/VIEWED -> NO_RESPONSE through the
   *      workflow engine. The engine's status-conditional write is the
   *      race backstop: a concurrent manual QUOTED/DECLINED makes this a
   *      no-op (ConflictException, or an illegal-move 422 from a terminal
   *      state) — caught and counted as `transitionSkipped`, not `failed`.
   *      `respondedAt` is left null — NO_RESPONSE means no response.
   *
   * A submission whose `(rfqId, insurerId)` already has a current
   * `Quotation` (backlog Part C #13) is dropped up front — an insurer that
   * quoted is not "silent" even if its best-effort `RFQInsurer -> QUOTED`
   * move failed on capture, so it must not be auto-marked NO_RESPONSE
   * (ibms-brain/meta/context/policy-lifecycle.md § RFQ follow-up:
   * `RFQInsurer.status` is not the authoritative "has this insurer quoted?"
   * signal — the `Quotation` table is).
   *
   * Per-row isolation so one bad row does not abandon the rest of the run
   * (same shape as CrossSellDetectionScheduler).
   */
  async runFollowUpScan(actorUserId: string): Promise<FollowUpScanResult> {
    const now = new Date();
    const candidates = await this.rfqs.findOpenSubmissionsForFollowUp();

    // One query for every candidate RFQ: which (rfqId, insurerId) pairs
    // already have a current Quotation. Cheap at Domain B's current volume;
    // revisit alongside `findOpenSubmissionsForFollowUp`'s own pagination
    // TODO if real RFQ traffic arrives.
    const quotedKeys = new Set(
      (
        await this.rfqs.findCurrentQuotationKeys([
          ...new Set(candidates.map((c) => c.rfqId)),
        ])
      ).map((k) => `${k.rfqId}::${k.insurerId}`),
    );

    let due = 0;
    let alerted = 0;
    let autoNoResponse = 0;
    let transitionSkipped = 0;
    let skippedQuoted = 0;
    let failed = 0;

    for (const submission of candidates) {
      if (quotedKeys.has(`${submission.rfqId}::${submission.insurerId}`)) {
        skippedQuoted += 1;
        continue;
      }
      if (
        !isFollowUpDue(
          submission.sentAt,
          submission.rfq.followUpThresholdDays,
          now,
        )
      ) {
        continue;
      }
      due += 1;
      try {
        const stamped = await this.rfqs.stampFollowUpAlert(submission.id, now);
        if (stamped === 1) {
          alerted += 1;
          await this.safeAudit({
            userId: actorUserId,
            action: 'UPDATE',
            entityType: 'RFQInsurer',
            entityId: submission.id,
            afterValue: {
              followUpAlert: true,
              rfqId: submission.rfqId,
              insurerId: submission.insurerId,
              followUpThresholdDays: submission.rfq.followUpThresholdDays,
              sentAt: submission.sentAt.toISOString(),
            },
          });
        }

        try {
          await this.workflow.transition({
            entityType: 'RFQInsurer',
            entityId: submission.id,
            toStatus: 'NO_RESPONSE',
            actorUserId,
          });
          autoNoResponse += 1;
        } catch (err) {
          if (
            err instanceof ConflictException ||
            err instanceof UnprocessableEntityException
          ) {
            transitionSkipped += 1;
            this.logger.log(
              `RFQ follow-up sweep: submission ${submission.id} not moved to NO_RESPONSE (${(err as Error).message}) — the insurer responded concurrently.`,
            );
          } else {
            throw err;
          }
        }
      } catch (err) {
        failed += 1;
        this.logger.error(
          `RFQ follow-up sweep: submission ${submission.id} failed (${(err as Error).message}) — continuing; next run will retry.`,
        );
      }
    }

    return {
      candidates: candidates.length,
      due,
      alerted,
      autoNoResponse,
      transitionSkipped,
      skippedQuoted,
      failed,
    };
  }
}

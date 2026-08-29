import type {
  ClaimStatus,
  ComplaintStatus,
  CrossSellStatus,
  CustomerStatus,
  DisposalBatchStatus,
  DsrStatus,
  EndorsementStatus,
  IncidentStatus,
  InsuranceProgramStatus,
  InvoiceStatus,
  KycStatus,
  LeadStatus,
  NeedsAssessmentStatus,
  OpportunityStatus,
  PolicyStatus,
  Prisma,
  RenewalStatus,
  RfqInsurerStatus,
  UpSellStatus,
} from '@ibms/db';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * The eleven workflow-state entities named in
 * ibms-brain/meta/lex/workflow-state-transitions.md and backlog item A.6,
 * plus `Lead`, `KYCRecord`, `Customer`, `NeedsAssessment`,
 * `InsuranceProgram`, `CrossSellOpportunity`, and `UpSellRecommendation` —
 * the lex file's rule is not scoped to that named list ("Every entity that
 * carries a workflow state ... moves through a transition()"), and each of
 * these backlog items (Part C #1 Lead Management, #3-4 Customer
 * Acquisition/Onboarding, #5 Needs Assessment, #7 Product Recommendation /
 * Program Design, #8 Cross-Selling, #9 Up-Selling) explicitly asks for a
 * governed status move, so they reuse this engine rather than growing
 * one-off transition functions. `KycStatus` and
 * `CustomerStatus` were added together: backlog #3-4 explicitly says "do not
 * activate Customer.status = ACTIVE before [KYC] approval" — see
 * kyc.service.ts, the sole caller of the Customer transition.
 * `NeedsAssessmentStatus` carries the review/approval gate the #5 backlog
 * item asks for — see needs-assessment.service.ts. `InsuranceProgramStatus`
 * carries the DRAFT -> FINALIZED lock the #7 backlog item's program-assembly
 * implies — see insurance-program.service.ts. `CrossSellStatus` carries the
 * "convert/dismiss the opportunity" move the #8 backlog item asks for — see
 * cross-sell.service.ts. `UpSellStatus` is the same OPEN -> CONVERTED |
 * DISMISSED shape for #9's system-flagged under-insurance recommendations —
 * see up-sell.service.ts.
 * The string values match the `entityType` already used for these models'
 * AuditLogEntry rows elsewhere (AuditService is polymorphic on this same
 * string), so a TRANSITION audit row and any other action on the same
 * entity always share one identifier.
 */
export type WorkflowEntityType =
  | 'Opportunity'
  | 'RFQInsurer'
  | 'Policy'
  | 'Endorsement'
  | 'Claim'
  | 'Complaint'
  | 'RenewalCase'
  | 'Invoice'
  | 'DataSubjectRequest'
  | 'IncidentReport'
  | 'DisposalBatch'
  | 'Lead'
  | 'KYCRecord'
  | 'Customer'
  | 'NeedsAssessment'
  | 'InsuranceProgram'
  | 'CrossSellOpportunity'
  | 'UpSellRecommendation';

/** Maps each entity to the Prisma-generated enum type its `status` column holds. */
export interface WorkflowStatusMap {
  Opportunity: OpportunityStatus;
  RFQInsurer: RfqInsurerStatus;
  Policy: PolicyStatus;
  Endorsement: EndorsementStatus;
  Claim: ClaimStatus;
  Complaint: ComplaintStatus;
  RenewalCase: RenewalStatus;
  Invoice: InvoiceStatus;
  DataSubjectRequest: DsrStatus;
  IncidentReport: IncidentStatus;
  DisposalBatch: DisposalBatchStatus;
  Lead: LeadStatus;
  KYCRecord: KycStatus;
  Customer: CustomerStatus;
  NeedsAssessment: NeedsAssessmentStatus;
  InsuranceProgram: InsuranceProgramStatus;
  CrossSellOpportunity: CrossSellStatus;
  UpSellRecommendation: UpSellStatus;
}

/**
 * The single source of truth for what counts as a legal move on every
 * workflow status enum in the schema (ibms-brain/meta/lex/
 * workflow-state-transitions.md). Key: current status. Value: the statuses
 * it may move to next — an empty array means the status is terminal.
 * `WorkflowTransitionService.transition()` is the only code path permitted
 * to consult this map and write a status; nothing else should duplicate it.
 *
 * Because this is typed as `Record<Status, ...>` per entity, TypeScript
 * itself rejects a map missing any enum member — the compiler enforces
 * completeness, not just this file's authors.
 *
 * Most of these shapes are transcribed directly from an explicit source:
 * see the citation on each entity below. Two (RFQInsurer, Invoice) have no
 * dedicated lifecycle paragraph yet and are inferred from field semantics
 * and neighboring model comments in packages/db/prisma/schema.prisma —
 * flagged so a real business-rule confirmation can replace the inference
 * later (candidate for `/brain-gap`).
 */
export const WORKFLOW_TRANSITIONS: {
  [E in WorkflowEntityType]: Record<
    WorkflowStatusMap[E],
    readonly WorkflowStatusMap[E][]
  >;
} = {
  // ibms-brain/meta/context/policy-lifecycle.md "The shapes":
  //   Needs Confirmed -> RFQ Issued -> Quotes Received -> Comparison Built ->
  //   Recommendation Drafted -> Sent to Client -> Client Decision ->
  //   Placement | Renegotiate | Closed-Lost
  // CLOSED_LOST is reachable from every non-terminal stage: a client can go
  // silent or decline at any point, not only once a ClientDecision is
  // recorded. RENEGOTIATE loops back to RFQ_ISSUED per the same file's
  // "renewed Negotiation" branch.
  Opportunity: {
    NEEDS_CONFIRMED: ['RFQ_ISSUED', 'CLOSED_LOST'],
    RFQ_ISSUED: ['QUOTES_RECEIVED', 'CLOSED_LOST'],
    QUOTES_RECEIVED: ['COMPARISON_BUILT', 'CLOSED_LOST'],
    COMPARISON_BUILT: ['RECOMMENDATION_DRAFTED', 'CLOSED_LOST'],
    RECOMMENDATION_DRAFTED: ['SENT_TO_CLIENT', 'CLOSED_LOST'],
    SENT_TO_CLIENT: ['CLIENT_DECISION', 'CLOSED_LOST'],
    CLIENT_DECISION: ['PLACEMENT', 'RENEGOTIATE', 'CLOSED_LOST'],
    RENEGOTIATE: ['RFQ_ISSUED', 'CLOSED_LOST'],
    PLACEMENT: [],
    CLOSED_LOST: [],
  },

  // Inferred (no dedicated lifecycle doc yet — see file header, and the
  // `/brain-gap` filed for ibms-brain/meta/context/policy-lifecycle.md).
  // SENT -> insurer views and/or responds. NO_RESPONSE is reached two ways:
  // a Placement Officer records it manually (Process 12, `rfq.insurer.update`),
  // OR the nightly follow-up sweep (backlog Part C #12) auto-advances a
  // SENT/VIEWED submission once its RFQ's business-day `followUpThresholdDays`
  // has lapsed (see rfq-followup.scheduler.ts / RfqService.runFollowUpScan —
  // it also stamps `followUpAlertSentAt` + audits). A late responder can
  // still submit a quote or decline afterward, hence
  // NO_RESPONSE -> QUOTED/DECLINED.
  RFQInsurer: {
    SENT: ['VIEWED', 'QUOTED', 'DECLINED', 'NO_RESPONSE'],
    VIEWED: ['QUOTED', 'DECLINED', 'NO_RESPONSE'],
    NO_RESPONSE: ['QUOTED', 'DECLINED'],
    QUOTED: [],
    DECLINED: [],
  },

  // ibms-brain/meta/context/policy-lifecycle.md "The shapes":
  //   Placement Confirmed -> Issued -> Checking In Progress ->
  //   Discrepancy | Verified -> Delivered -> Active
  // Same file: a Discrepancy "blocks Delivery until resolved" — modeled as
  // looping back to CHECKING_IN_PROGRESS for re-check, never silently
  // corrected and moved on. ACTIVE -> CANCELLED/EXPIRED per Process 22
  // (Endorsement/Cancellation) and natural policy expiry.
  Policy: {
    PLACEMENT_CONFIRMED: ['ISSUED'],
    ISSUED: ['CHECKING_IN_PROGRESS'],
    CHECKING_IN_PROGRESS: ['DISCREPANCY', 'VERIFIED'],
    DISCREPANCY: ['CHECKING_IN_PROGRESS'],
    VERIFIED: ['DELIVERED'],
    DELIVERED: ['ACTIVE'],
    ACTIVE: ['CANCELLED', 'EXPIRED'],
    CANCELLED: [],
    EXPIRED: [],
  },

  // ibms-brain/meta/context/policy-lifecycle.md "The shapes":
  //   Requested -> Submitted to Insurer -> Insurer Confirmed ->
  //   Financial Adjustment Calculated -> (Refund Approval if applicable) ->
  //   Applied -> Client Notified
  // The refund step is parenthetical/optional in that source — only a
  // negative (return-premium) endorsement triggers Refund Management
  // (same file, "Negative endorsements ... trigger the Refund Management
  // workflow"), so FINANCIAL_ADJUSTMENT_CALCULATED can go straight to
  // APPLIED for a positive endorsement.
  Endorsement: {
    REQUESTED: ['SUBMITTED_TO_INSURER'],
    SUBMITTED_TO_INSURER: ['INSURER_CONFIRMED'],
    INSURER_CONFIRMED: ['FINANCIAL_ADJUSTMENT_CALCULATED'],
    FINANCIAL_ADJUSTMENT_CALCULATED: ['REFUND_APPROVAL_PENDING', 'APPLIED'],
    REFUND_APPROVAL_PENDING: ['APPLIED'],
    APPLIED: ['CLIENT_NOTIFIED'],
    CLIENT_NOTIFIED: [],
  },

  // ibms-brain/meta/context/claims-lifecycle.md "The shapes":
  //   Notified -> Registered -> Documentation In Progress ->
  //   Under Assessment -> Approved | Partially Approved | Declined ->
  //   Settled -> Closed
  // DECLINED skips SETTLED rather than following the source's literal
  // arrow: a declined claim has no payment, and Settlement.approvedAmount
  // is nullable for exactly this reason — going through SETTLED with
  // nothing to settle would be a fake row. APPROVED/PARTIALLY_APPROVED do
  // pass through SETTLED, matching the "four distinct figures" rule in the
  // same file.
  Claim: {
    NOTIFIED: ['REGISTERED'],
    REGISTERED: ['DOCUMENTATION_IN_PROGRESS'],
    DOCUMENTATION_IN_PROGRESS: ['UNDER_ASSESSMENT'],
    UNDER_ASSESSMENT: ['APPROVED', 'PARTIALLY_APPROVED', 'DECLINED'],
    APPROVED: ['SETTLED'],
    PARTIALLY_APPROVED: ['SETTLED'],
    DECLINED: ['CLOSED'],
    SETTLED: ['CLOSED'],
    CLOSED: [],
  },

  // ibms-brain/meta/context/claims-lifecycle.md "The shapes" reads, literally:
  //   Logged -> Assigned -> In Progress -> Resolved -> Closed | Escalated
  // Read literally that puts ESCALATED after RESOLVED, i.e. escalating an
  // already-resolved complaint — which contradicts Process 42's escalation
  // being a route to the regulator/dispute-resolution mechanism for a case
  // that could NOT be resolved internally. Modeled instead as the fork
  // happening at IN_PROGRESS, with ESCALATED able to return to handling or
  // resolve once addressed. Worth a `/brain-gap` to confirm against the
  // source document rather than this inference.
  Complaint: {
    LOGGED: ['ASSIGNED'],
    ASSIGNED: ['IN_PROGRESS'],
    IN_PROGRESS: ['RESOLVED', 'ESCALATED'],
    ESCALATED: ['IN_PROGRESS', 'RESOLVED'],
    RESOLVED: ['CLOSED'],
    CLOSED: [],
  },

  // ibms-brain/meta/context/policy-lifecycle.md "The shapes":
  //   Renewal Due -> In Progress -> Quotes Obtained -> Recommended ->
  //   Client Decision -> Renewed | Lapsed | Cancelled
  // Same file: "No renewal action within the lead-time window escalates to
  // Customer Retention, not silence" — modeled as LAPSED being reachable
  // from every non-terminal stage (a client can go silent at any point),
  // while CANCELLED stays only reachable from CLIENT_DECISION since the
  // source draws it solely as that explicit fork's outcome.
  RenewalCase: {
    RENEWAL_DUE: ['IN_PROGRESS', 'LAPSED'],
    IN_PROGRESS: ['QUOTES_OBTAINED', 'LAPSED'],
    QUOTES_OBTAINED: ['RECOMMENDED', 'LAPSED'],
    RECOMMENDED: ['CLIENT_DECISION', 'LAPSED'],
    CLIENT_DECISION: ['RENEWED', 'LAPSED', 'CANCELLED'],
    RENEWED: [],
    LAPSED: [],
    CANCELLED: [],
  },

  // Inferred (no dedicated lifecycle doc yet — see file header). Derived
  // from the Receipt model comment ("Process 32 — Invoice -> Collection ->
  // Receipt -> Reconciliation -> Remittance cycle") plus
  // ReconciliationException's Process 39 rule that a mismatch is "NEVER
  // silently written off" — modeled as an explicit exception branch off
  // either COLLECTED or RECONCILED, resolved back into the main line.
  Invoice: {
    INVOICED: ['COLLECTED'],
    COLLECTED: ['RECONCILED', 'EXCEPTION_RAISED'],
    RECONCILED: ['REMITTED', 'EXCEPTION_RAISED'],
    EXCEPTION_RAISED: ['EXCEPTION_RESOLVED'],
    EXCEPTION_RESOLVED: ['RECONCILED', 'REMITTED'],
    REMITTED: [],
  },

  // ibms-brain/meta/lex/workflow-state-transitions.md: "DSR: Received ->
  // Identity Verified -> ... -> Closed". The middle steps and the
  // must-not-silently-close rule come from
  // ibms-brain/meta/context/pcms-privacy-modules.md (M04): "A Deletion DSR
  // with an open retention flag cannot be closed as fully fulfilled" — the
  // PARTIALLY_FULFILLED branch exists specifically so that rule has
  // somewhere to land instead of forcing FULFILLED.
  DataSubjectRequest: {
    RECEIVED: ['IDENTITY_VERIFIED', 'REJECTED'],
    IDENTITY_VERIFIED: ['IN_PROGRESS', 'REJECTED'],
    IN_PROGRESS: ['FULFILLED', 'PARTIALLY_FULFILLED', 'REJECTED'],
    PARTIALLY_FULFILLED: ['CLOSED'],
    FULFILLED: ['CLOSED'],
    REJECTED: ['CLOSED'],
    CLOSED: [],
  },

  // ibms-brain/meta/lex/workflow-state-transitions.md, verbatim: "Incident:
  // Reported -> Contained -> Impact Assessed -> Classified -> Notified ->
  // Recovered -> Closed" — also restated in the IncidentReport model
  // comment in packages/db/prisma/schema.prisma. A strictly linear chain in
  // both sources, so modeled with no branching or skipped steps.
  IncidentReport: {
    REPORTED: ['CONTAINED'],
    CONTAINED: ['IMPACT_ASSESSED'],
    IMPACT_ASSESSED: ['CLASSIFIED'],
    CLASSIFIED: ['NOTIFIED'],
    NOTIFIED: ['RECOVERED'],
    RECOVERED: ['CLOSED'],
    CLOSED: [],
  },

  // ibms-brain/meta/context/pcms-privacy-modules.md (M06): "Record
  // destruction is always dual-control (Department Manager nominates, DPO
  // approves) and always produces a Certificate of Destruction." Also the
  // DisposalBatch model comment in schema.prisma. Strictly linear, matching
  // both sources.
  DisposalBatch: {
    NOMINATED: ['MANAGER_APPROVED'],
    MANAGER_APPROVED: ['DPO_APPROVED'],
    DPO_APPROVED: ['EXECUTED'],
    EXECUTED: ['CLOSED'],
    CLOSED: [],
  },

  // Backlog Part C #1 (Lead Management), verbatim: "NEW -> CONTACTED ->
  // QUALIFIED -> CONVERTED_TO_PROSPECT/DISQUALIFIED". Read literally that
  // puts DISQUALIFIED reachable only after QUALIFIED, but every sibling
  // entity in this file that has a "the client went quiet/declined" exit
  // (Opportunity's CLOSED_LOST, RenewalCase's LAPSED) models that exit as
  // reachable from every non-terminal stage, not just the last one — a lead
  // can go cold or turn out disqualified (wrong number, no budget, wrong
  // segment) right after first contact, not only once fully qualified.
  // Modeled the same way here; worth a `/brain-gap` to confirm against a
  // real CRM-process source rather than this inference.
  //
  // QUALIFIED -> CONVERTED_TO_PROSPECT is correctly listed as reachable
  // here — WorkflowTransitionService.transition() itself doesn't restrict
  // it, and ProspectService.convert() (backlog Part C #2) calls it
  // directly. But the GENERIC `POST /leads/:id/transition` endpoint
  // additionally refuses that one target at the LeadService.transition()
  // application layer (a Prospect must be created in the same operation,
  // which the generic engine has no way to do) — see lead.service.ts. This
  // map stays the source of truth for what's a legal STATE move; it is not
  // a complete list of which endpoints may request which move.
  Lead: {
    NEW: ['CONTACTED', 'DISQUALIFIED'],
    CONTACTED: ['QUALIFIED', 'DISQUALIFIED'],
    QUALIFIED: ['CONVERTED_TO_PROSPECT', 'DISQUALIFIED'],
    CONVERTED_TO_PROSPECT: [],
    DISQUALIFIED: [],
  },

  // Backlog Part C #3-4 (Customer Acquisition/Onboarding), transcribed
  // verbatim from the KYCRecord model comment in schema.prisma: "Draft ->
  // Submitted -> Screening -> EDD(optional) -> Compliance Review ->
  // Approved/Rejected -> Periodic Review Due". EDD is reachable only from
  // SCREENING (ScreeningService decides the branch once results are in, or
  // a Compliance Officer forces it via kyc.edd.trigger — see
  // kyc.service.ts); COMPLIANCE_REVIEW is reachable from either SCREENING
  // (no hit) or EDD (enhanced review complete). PERIODIC_REVIEW_DUE is
  // terminal for THIS row, same shape as Lead's CONVERTED_TO_PROSPECT: the
  // actual re-KYC cycle is a new KYCRecord for the same Customer (see
  // KycPeriodicReviewScheduler), not a loop back onto this one.
  KYCRecord: {
    DRAFT: ['SUBMITTED'],
    SUBMITTED: ['SCREENING'],
    SCREENING: ['EDD', 'COMPLIANCE_REVIEW'],
    EDD: ['COMPLIANCE_REVIEW'],
    COMPLIANCE_REVIEW: ['APPROVED', 'REJECTED'],
    APPROVED: ['PERIODIC_REVIEW_DUE'],
    REJECTED: [],
    PERIODIC_REVIEW_DUE: [],
  },

  // Backlog Part C #3-4: "do not activate Customer.status = ACTIVE before
  // [KYC] approval" — ACTIVE is reachable only from PENDING_KYC, and the
  // sole caller of that move is KycService.approve() (maker/checker-gated;
  // see maker-checker.util.ts). SUSPENDED/CLOSED have no dedicated lifecycle
  // doc in this backlog item — modeled the same way every other sibling
  // entity in this file models its "something went wrong later" exits:
  // reachable from ACTIVE, with SUSPENDED able to return to ACTIVE (a
  // resolved suspension) or move on to CLOSED. Worth a `/brain-gap` to
  // confirm against a real post-onboarding account-management process once
  // one exists (Domain A Processes 5-10 aren't built yet).
  Customer: {
    PENDING_KYC: ['ACTIVE'],
    ACTIVE: ['SUSPENDED', 'CLOSED'],
    SUSPENDED: ['ACTIVE', 'CLOSED'],
    CLOSED: [],
  },

  // Backlog Part C #5 (Needs Assessment), from the model's own status
  // comment ("Data Collection -> Draft Assessment -> Reviewed -> Approved ->
  // Linked to Opportunity/RFQ") narrowed to what is buildable now. The
  // Sales Officer captures/edits in DRAFT and submits for review; the
  // Branch/Department Manager (needs-assessment.approve) records a review,
  // then an approval — two stamped columns (reviewedByUserId then
  // approvedByUserId), each maker/checker-gated against createdByUserId (see
  // needs-assessment.service.ts). A manager can bounce it back to DRAFT
  // (returned for changes) from either PENDING_REVIEW or REVIEWED, or
  // REJECTED it outright. APPROVED is terminal here: linking an approved
  // assessment to an Opportunity/RFQ is Process 11+, not built — same
  // "modeled up to the edge of the next unbuilt process" shape as Lead's
  // CONVERTED_TO_PROSPECT was before Part C #2.
  NeedsAssessment: {
    DRAFT: ['PENDING_REVIEW'],
    PENDING_REVIEW: ['REVIEWED', 'DRAFT', 'REJECTED'],
    REVIEWED: ['APPROVED', 'DRAFT', 'REJECTED'],
    APPROVED: [],
    REJECTED: [],
  },

  // Backlog Part C #7 (Product Recommendation / Program Design). The #7 task
  // list is a single "assemble" bullet with no explicit lifecycle, but a
  // program that feeds an Opportunity/RFQ (Process 11+) must be lockable
  // first — so: DRAFT once assembled from the APPROVED NeedsAssessment's
  // coverage list + the RiskProfile survey, FINALIZED when the
  // Placement/Technical Officer locks it. FINALIZED -> DRAFT (reopen) keeps
  // a finalized program with an error from being a dead end. SUPERSEDED is
  // the terminal state a re-assembled replacement would leave the old
  // program in (e.g. a mid-cycle risk change per
  // ibms-brain/meta/context/policy-lifecycle.md) — modeled and reachable,
  // but no endpoint triggers it in this backlog item yet (same "modeled
  // ahead of a real trigger" shape as Customer's SUSPENDED/CLOSED). See
  // insurance-program.service.ts.
  InsuranceProgram: {
    DRAFT: ['FINALIZED', 'SUPERSEDED'],
    FINALIZED: ['DRAFT', 'SUPERSEDED'],
    SUPERSEDED: [],
  },

  // Backlog Part C #8 (Cross-Selling), verbatim: "Convert/dismiss the
  // opportunity". A CrossSellOpportunity is created OPEN by the detection
  // sweep (nothing else creates one — there is no user-facing "raise a
  // cross-sell opportunity" path); a Sales Officer then either CONVERTED it
  // (takes the gap forward into an Opportunity/RFQ — Process 11+, not built,
  // so CONVERTED is terminal here, same "modeled up to the edge of the next
  // unbuilt process" shape as Lead's CONVERTED_TO_PROSPECT was before Part C
  // #2) or DISMISSED it (with a reason). Both non-OPEN states are terminal:
  // the `@@unique([customerId, gapLine])` on CrossSellOpportunity means a
  // resolved gap is never re-flagged as a new row either (see
  // cross-sell.service.ts).
  CrossSellOpportunity: {
    OPEN: ['CONVERTED', 'DISMISSED'],
    CONVERTED: [],
    DISMISSED: [],
  },

  // Backlog Part C #9 (Up-Selling). Same shape as CrossSellOpportunity: a
  // system-detected under-insurance recommendation is created OPEN by the
  // detection sweep (nothing else creates one), then a Sales Officer either
  // CONVERTED it (takes the proposed increase forward into an endorsement /
  // re-quote — Process 22 / 11+, not built, so CONVERTED is terminal here)
  // or DISMISSED it (with a reason). Both non-OPEN states are terminal; the
  // partial UNIQUE index (customerId WHERE status = 'OPEN') keeps at most one
  // OPEN per customer, and a resolved recommendation frees that slot for a
  // fresh one once assets grow further (see up-sell.service.ts).
  UpSellRecommendation: {
    OPEN: ['CONVERTED', 'DISMISSED'],
    CONVERTED: [],
    DISMISSED: [],
  },
};

/** True if `to` is a legal next status from `from` for the given entity. */
export function isWorkflowTransitionAllowed<E extends WorkflowEntityType>(
  entityType: E,
  from: WorkflowStatusMap[E],
  to: WorkflowStatusMap[E],
): boolean {
  const allowed = (
    WORKFLOW_TRANSITIONS[entityType] as Record<string, readonly string[]>
  )[from as string];
  return Array.isArray(allowed) && allowed.includes(to);
}

/** The statuses `from` may legally move to next for the given entity (empty = terminal). */
export function allowedNextStatuses<E extends WorkflowEntityType>(
  entityType: E,
  from: WorkflowStatusMap[E],
): readonly WorkflowStatusMap[E][] {
  return (
    (
      WORKFLOW_TRANSITIONS[entityType] as Record<
        string,
        readonly WorkflowStatusMap[E][]
      >
    )[from as string] ?? []
  );
}

/**
 * The minimal shape `WorkflowTransitionService` needs from a Prisma model
 * delegate — every workflow entity's `status` column is a plain string enum
 * (see the cross-cutting rule #3 at the top of schema.prisma), so this one
 * narrow interface covers every entity in `WORKFLOW_TRANSITIONS` without
 * depending on their individual generated types.
 */
export interface WorkflowDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<{ id: string; status: string } | null>;
  updateMany(args: {
    where: { id: string; status: string };
    data: Prisma.InputJsonObject | Record<string, unknown>;
  }): Promise<{ count: number }>;
}

/** Resolves the Prisma delegate backing a workflow entity's `status` column. */
export function getWorkflowDelegate(
  client: PrismaService['client'],
  entityType: WorkflowEntityType,
): WorkflowDelegate {
  const delegates: Record<WorkflowEntityType, unknown> = {
    Opportunity: client.opportunity,
    RFQInsurer: client.rFQInsurer,
    Policy: client.policy,
    Endorsement: client.endorsement,
    Claim: client.claim,
    Complaint: client.complaint,
    RenewalCase: client.renewalCase,
    Invoice: client.invoice,
    DataSubjectRequest: client.dataSubjectRequest,
    IncidentReport: client.incidentReport,
    DisposalBatch: client.disposalBatch,
    Lead: client.lead,
    KYCRecord: client.kYCRecord,
    Customer: client.customer,
    NeedsAssessment: client.needsAssessment,
    InsuranceProgram: client.insuranceProgram,
    CrossSellOpportunity: client.crossSellOpportunity,
    UpSellRecommendation: client.upSellRecommendation,
  };
  return delegates[entityType] as WorkflowDelegate;
}

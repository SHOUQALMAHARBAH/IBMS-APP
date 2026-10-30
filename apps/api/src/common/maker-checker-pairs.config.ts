/**
 * EVERY MAKER/CHECKER PAIR THIS SYSTEM ENFORCES — the canonical list, in the layer both consumers can read.
 *
 * ## This was MOVED, not written
 *
 * `MAKER_CHECKER_REGISTRY` already existed, complete and correct, in
 * `modules/internal-controls/internal-controls.config.ts` — 16 entries matching the 16 database CHECK
 * constraints one for one. It was moved here (verbatim, plus one field) for a layering reason:
 * `src/common/` must not import from `src/modules/`, and `maker-checker.util.ts` lives in common and now
 * needs the list to name a remedy. `internal-controls.config.ts` re-exports it, so its own consumers are
 * untouched — the same treatment `insurer-performance.config.ts` got when `period.util.ts` was promoted.
 *
 * ## The three lists that were wrong, and the one that was not
 *
 * Measured while planning Part 4:
 *
 *   this registry                16 pairs — matches the database exactly
 *   the database                 16 CHECK constraints across 15 tables
 *
 * THE PAIR COUNT AND THE TABLE COUNT DIFFER BY ONE ON PURPOSE: `NeedsAssessment` carries TWO
 * pairs (reviewer and approver) with two escape columns, because one shared column would let a
 * declared combined REVIEW excuse a self-APPROVAL. A pair's identity is its CONSTRAINT, never
 * its table — which is also why `combined-duty-projection.py` keys on the constraint, and why
 * keying it on the table once collapsed these two into one.
 *
 * AND THE COUNT IS DERIVED RATHER THAN WRITTEN DOWN NOW: `npm run check:maker-checker-pairs`
 * compares this registry to the `*_maker_checker_distinct` constraints the migrations create, by
 * name and in BOTH directions, as a CI step. The figures above were 15 for a day after the
 * sixteenth pair landed, in the file that calls itself the canonical one.
 *   `checker-roles.config.ts`    13 checker permissions — both NeedsAssessment pairs missing
 *   `maker-checker.util.ts`      11 rows in a header comment — four pairs missing
 *
 * The complete list existed all along, in a module nobody opens when touching maker/checker. The two
 * shorter lists are the ones that drifted. Nothing verified any of them against `pg_constraint` —
 * `test/maker-checker-pairs.e2e-spec.ts` now does, so a seventeenth constraint cannot be added without this
 * file moving.
 *
 * ## One pair carries a decision as well as a constraint
 *
 * `DataSubjectRequest` (closure) is annotated in place with IMPROVEMENTS § 1.65: the split
 * between CORRECTING a customer's details and CLOSING the request that asked for it is
 * deliberate as of 2026-09-28, not an accident of who holds which permission. Read that
 * note before proposing that one person should be able to do both.
 *
 * ## The constraint name is the identity
 *
 * Not the entity: `NeedsAssessment` has TWO pairs and they must never be interchangeable — a declared
 * combined REVIEW must not excuse a self-APPROVAL. Part 4's mode depends on that distinction, one escape
 * column per CONSTRAINT.
 */
export interface MakerCheckerPair {
  /** AuditLogEntry-style entity label. */
  entityType: string;
  /** Distinguishes this pair when one entity has more than one (NeedsAssessment). */
  pairLabel: string;
  /** Key on the generated Prisma client (`this.prisma.client[modelProperty]`). */
  modelProperty: string;
  makerField: string;
  checkerField: string;
  /**
   * DECISION 22 — the permission that gates the MAKER's half, or `null` where none exists.
   *
   * REQUIRED, not optional, and that is the point: an omitted field would make "nobody measured
   * this one" and "there is no code" the same thing, and the single null below is the entry where
   * that distinction carries the entire answer.
   *
   * ## MEASURED FROM THE ROUTE THAT WRITES THE MAKER FIELD, NEVER FROM THE FIELD'S NAME
   *
   * `scripts/measurements/maker-permissions.py` is the derivation, committed so the answer is
   * re-derivable rather than remembered. Four readings taken from the field name were wrong, and
   * every one of them is a code somebody would plausibly have written down:
   *
   *   * `DataProcessingAgreement`'s is `vendor.update` — a different permission FAMILY.
   *   * `Complaint`'s is `complaint.log`, which gates EIGHT routes, so holding it says "may work
   *     complaints" and not "may resolve this one".
   *   * `AccessRecertificationItem`'s maker is the SUBJECT of the review, so no permission exists
   *     and none CAN — a person does not need a grant to be the one whose access is reviewed.
   *   * `Refund`'s is `endorsement.apply`, NOT `refund.raise`. `refund.raise` EXISTS in the
   *     catalogue and gates NO ROUTE, which is why recording it would have put a code nothing
   *     reads into the one place meant to answer "who may make this half".
   *
   * ## SO THE GUARD CHECKS ENFORCEMENT, NOT EXISTENCE
   *
   * `maker-permissions.inventory.spec.ts` refuses a code that gates no `@RequirePermissions`
   * anywhere in the api. A catalogue code that reads no route is worse here than an empty field,
   * because it reads as an answer.
   */
  makerPermission: string | null;
  /** The DB CHECK constraint name backing this pair, or null — see header comment. */
  dbCheckConstraint: string | null;
  /**
   * The permission the CHECKER half needs — what a SECOND person must hold for this operation to be
   * completable at all.
   *
   * Added when `assertDifferentActors` started naming the remedy in its refusal: a message that states
   * the rule and stops is useless to whoever is holding it, because they cannot tell what to ask an
   * administrator for. It also backs the readiness list, which answers "which of these can my office not
   * complete today" before anybody is blocked mid-transaction.
   */
  checkerPermission: string;
  /** No application code writes to this model yet (M06/M07/M08) — see header comment. */
  dormant: boolean;
  source: string;
}

export const MAKER_CHECKER_REGISTRY = [
  {
    entityType: 'KYCRecord',
    pairLabel: 'createdByUserId / approvedByUserId',
    modelProperty: 'kYCRecord',
    makerField: 'createdByUserId',
    checkerField: 'approvedByUserId',
    dbCheckConstraint: 'KYCRecord_maker_checker_distinct',
    // `kyc.service.ts#start` -> `POST /kyc`.
    makerPermission: 'kyc.capture',
    checkerPermission: 'kyc.approve',
    dormant: false,
    source: 'Part 5.2, Part 3.1',
  },
  {
    entityType: 'PolicyChecking',
    pairLabel: 'placedByUserId / checkedByUserId',
    modelProperty: 'policyChecking',
    makerField: 'placedByUserId',
    checkerField: 'checkedByUserId',
    dbCheckConstraint: 'PolicyChecking_maker_checker_distinct',
    // `policy.service.ts#place` -> `POST /policies`. The maker is whoever PLACED the policy,
    // so the gate is the placement one and not a checking code.
    makerPermission: 'policy.create',
    checkerPermission: 'policy.check',
    dormant: false,
    source: 'Part 5.2, Part 3.4',
  },
  {
    entityType: 'Refund',
    pairLabel: 'raisedByUserId / approvedByUserId',
    modelProperty: 'refund',
    makerField: 'raisedByUserId',
    checkerField: 'approvedByUserId',
    dbCheckConstraint: 'Refund_maker_checker_distinct',
    // `endorsement.service.ts#calculateAdjustment` -> `POST
    // /endorsements/:id/calculate-adjustment`. NOT `refund.raise`, which exists and gates NO
    // route: a refund is created inside the endorsement because the refund and its commission
    // reversal must move together.
    makerPermission: 'endorsement.apply',
    checkerPermission: 'refund.approve',
    dormant: false,
    source: 'Part 5.2, Part 3.5',
  },
  {
    entityType: 'DisposalBatch',
    pairLabel: 'nominatedByUserId / dpoApprovedByUserId',
    modelProperty: 'disposalBatch',
    makerField: 'nominatedByUserId',
    checkerField: 'dpoApprovedByUserId',
    dbCheckConstraint: 'DisposalBatch_maker_checker_distinct',
    // `disposal-batch.service.ts#nominate` -> `POST /disposal-batches`.
    makerPermission: 'retention.dispose.nominate',
    checkerPermission: 'retention.dispose.approve',
    dormant: false,
    source: 'PRIV-SRS-01 M06',
  },
  {
    /*
     * MODULE 0 CLOSE, DECISION 3 — THE SIXTEENTH PAIR, and the reason it was absent is the finding.
     *
     * The table already HAD a confirm step: `confirmedByLegalCounselAt`, a date with NO ACTOR. So
     * there was nothing to compare, and a code split alone would have been separation in appearance
     * only. Migration `20261128100000` adds the actor on both sides, the escape column and the CHECK.
     *
     * Registering it here is what makes it automatic rather than bespoke: the e2e derives its
     * expected set from `pg_constraint` both ways, the duty-segregation readiness signal reads the
     * checker permission, and a COMBINED office's declared act resolves through the same engine as
     * the other fifteen.
     */
    entityType: 'RetentionScheduleItem',
    pairLabel: 'setByUserId / confirmedByLegalCounselByUserId',
    modelProperty: 'retentionScheduleItem',
    makerField: 'setByUserId',
    checkerField: 'confirmedByLegalCounselByUserId',
    dbCheckConstraint: 'RetentionScheduleItem_maker_checker_distinct',
    // `retention-schedule.service.ts#create` AND `#update` -> `POST`/`PATCH
    // /retention-schedule`. Both write the maker, because the person a confirmation must
    // differ from is whoever LAST set the period — and both routes carry the same code.
    makerPermission: 'retention-schedule.update',
    checkerPermission: 'retention-schedule.confirm',
    dormant: false,
    source: 'PRIV-SRS-01 M06',
  },
  {
    entityType: 'DataSharingApproval',
    pairLabel: 'requestedByUserId / approvedByUserId',
    modelProperty: 'dataSharingApproval',
    makerField: 'requestedByUserId',
    checkerField: 'approvedByUserId',
    dbCheckConstraint: 'DataSharingApproval_maker_checker_distinct',
    // `data-sharing-approval.service.ts#create` -> `POST /data-sharing-approvals`.
    makerPermission: 'data-sharing.request',
    checkerPermission: 'data-sharing.approve',
    dormant: false,
    source: 'PRIV-SRS-01 M08',
  },
  {
    entityType: 'DataProcessingAgreement',
    pairLabel: 'assessedByUserId / dpoApprovedByUserId',
    modelProperty: 'dataProcessingAgreement',
    makerField: 'assessedByUserId',
    checkerField: 'dpoApprovedByUserId',
    dbCheckConstraint: 'DataProcessingAgreement_maker_checker_distinct',
    // `data-processing-agreement.service.ts#create` -> `POST /data-processing-agreements`. A
    // DIFFERENT FAMILY from `dpa.approve`, which is the checker's — an assessment is recorded
    // against a vendor, so the gate is the vendor one.
    makerPermission: 'vendor.update',
    checkerPermission: 'dpa.approve',
    dormant: false,
    source: 'PRIV-SRS-01 M07',
  },
  {
    entityType: 'Settlement',
    pairLabel: 'approvedByUserId / secondApproverUserId',
    modelProperty: 'settlement',
    makerField: 'approvedByUserId',
    checkerField: 'secondApproverUserId',
    dbCheckConstraint: 'Settlement_maker_checker_distinct',
    // `claim.service.ts#recordSettlement` -> `POST /claims/:id/settlement`. The FIRST approval
    // is the maker here, which is why both halves are approval codes.
    makerPermission: 'claim.settle.approve',
    checkerPermission: 'claim.settle.second-approve',
    dormant: false,
    source: 'Part 5.2 (large claims / broker-processed payments), Process 28',
  },
  {
    entityType: 'CommissionLedgerEntry',
    pairLabel: 'overrideRequestedByUserId / overrideApprovedByUserId',
    modelProperty: 'commissionLedgerEntry',
    makerField: 'overrideRequestedByUserId',
    checkerField: 'overrideApprovedByUserId',
    dbCheckConstraint: 'CommissionLedgerEntry_maker_checker_distinct',
    // `commission-ledger.service.ts#raiseOverride` -> `POST /commission/.../override`.
    makerPermission: 'commission-override.raise',
    checkerPermission: 'commission-override.approve',
    dormant: false,
    source: 'Part 5.2, Process 35',
  },
  {
    entityType: 'Recommendation',
    pairLabel: 'draftedByUserId / approvedByUserId',
    modelProperty: 'recommendation',
    makerField: 'draftedByUserId',
    checkerField: 'approvedByUserId',
    dbCheckConstraint: 'Recommendation_maker_checker_distinct',
    // `recommendation.service.ts#draft` -> `POST /recommendations`.
    makerPermission: 'recommendation.draft',
    checkerPermission: 'recommendation.approve',
    dormant: false,
    source: 'Part 5.2, Process 16',
  },
  {
    entityType: 'AccessRecertificationItem',
    pairLabel: 'subjectUserId / reviewerUserId',
    modelProperty: 'accessRecertificationItem',
    makerField: 'subjectUserId',
    checkerField: 'reviewerUserId',
    dbCheckConstraint: 'AccessRecertificationItem_maker_checker_distinct',
    // NONE, AND NONE CAN EXIST. The maker field is `subjectUserId` — the SUBJECT of the
    // review, written when the cycle opens. A person does not hold a permission in order to be
    // the one whose access is reviewed, so there is no gate to name. An empty field with this
    // reason is an answer; a guessed code would not be.
    makerPermission: null,
    checkerPermission: 'access-recertification.review',
    dormant: false,
    source: 'backlog A.8',
  },
  {
    entityType: 'NeedsAssessment',
    pairLabel: 'createdByUserId / reviewedByUserId',
    modelProperty: 'needsAssessment',
    makerField: 'createdByUserId',
    checkerField: 'reviewedByUserId',
    dbCheckConstraint: 'NeedsAssessment_reviewer_maker_checker_distinct',
    // `needs-assessment.service.ts#create` -> `POST /needs-assessments`. Both of this table's
    // pairs share one maker field, so both name the same code — which is correct and is not
    // the two pairs collapsing: their CHECKER halves and their escape columns stay separate.
    makerPermission: 'needs-assessment.create',
    checkerPermission: 'needs-assessment.approve',
    dormant: false,
    source: 'Domain A #5',
  },
  {
    entityType: 'NeedsAssessment',
    pairLabel: 'createdByUserId / approvedByUserId',
    modelProperty: 'needsAssessment',
    makerField: 'createdByUserId',
    checkerField: 'approvedByUserId',
    dbCheckConstraint: 'NeedsAssessment_approver_maker_checker_distinct',
    // `needs-assessment.service.ts#create` -> `POST /needs-assessments`. See the reviewer pair
    // above: one maker field, two pairs, two escape columns.
    makerPermission: 'needs-assessment.create',
    checkerPermission: 'needs-assessment.approve',
    dormant: false,
    source: 'Domain A #5',
  },
  {
    entityType: 'Complaint',
    pairLabel: 'resolvedByUserId / closureApprovedByUserId',
    modelProperty: 'complaint',
    makerField: 'resolvedByUserId',
    checkerField: 'closureApprovedByUserId',
    dbCheckConstraint: 'Complaint_closure_maker_checker_distinct',
    // `complaint.service.ts#resolve` -> `POST /complaints/:id/resolve`. This code gates EIGHT
    // routes, so holding it says 'may work complaints' rather than 'may resolve this one' — a
    // coarseness worth knowing when reading the segregation answer off this field.
    makerPermission: 'complaint.log',
    checkerPermission: 'complaint.close',
    dormant: false,
    source: 'Process 42',
  },
  {
    /*
     * A DELIBERATE TWO-PERSON FLOW, decided 2026-09-28 — do not "simplify" it.
     *
     * IMPROVEMENTS § 1.65. This pair already gave DSR closure its two-person property and
     * its combined-duty escape, and that is not what the decision is about. What the
     * decision settles is the relationship between CORRECTING a customer's details and
     * CLOSING the request that asked for the correction:
     *
     *   SALES_RELATIONSHIP_OFFICER   customer.update  YES    dsr.close  no
     *   DATA_PROTECTION_OFFICER      customer.update  no     dsr.close  YES
     *
     * So the officer who can change a phone number cannot close the request, and the DPO
     * who closes it cannot change the number. **Until this entry existed, that was a
     * by-product of a permission split made for another reason** — nobody had decided it,
     * and the obvious tidy-up is to grant the DPO `customer.update` so one person can
     * finish the job.
     *
     * The owner decided to KEEP it at two, because it is real segregation: the person who
     * alters customer data is not the person certifying to a regulator that the request
     * was answered. It works only because the correction carries the request's reference,
     * which is what `DsrService.fulfil` looks for before it will close anything.
     *
     * It inherits the office's declared mode like every other pair here: a SEGREGATED
     * office needs two people, and an office that has declared COMBINED duties can do both
     * halves with one — recorded, with a stated reason, and surfaced in the self-approval
     * report. That is the property that makes keeping it at two safe for a one-person
     * office rather than a wall.
     *
     * If you are here to grant the DPO `customer.update`: that is a decision to reverse,
     * not a cleanup. It widens who may edit customer data.
     */
    entityType: 'DataSubjectRequest',
    pairLabel: 'processedByUserId / closedByUserId',
    modelProperty: 'dataSubjectRequest',
    makerField: 'processedByUserId',
    checkerField: 'closedByUserId',
    dbCheckConstraint: 'DataSubjectRequest_closure_maker_checker_distinct',
    // `dsr.service.ts#fulfil`, `#partiallyFulfil` and `#reject` all write it, and all three
    // are gated on the same code.
    makerPermission: 'dsr.handle',
    checkerPermission: 'dsr.close',
    dormant: false,
    source: 'Process #52/M04',
  },
  {
    entityType: 'IncidentReport',
    pairLabel: 'classifiedByDpoUserId / seniorManagementCoSignUserId',
    modelProperty: 'incidentReport',
    makerField: 'classifiedByDpoUserId',
    checkerField: 'seniorManagementCoSignUserId',
    dbCheckConstraint: 'IncidentReport_classification_maker_checker_distinct',
    // `incident.service.ts#classify` -> `POST /incidents/:id/classify`.
    makerPermission: 'incident.classify',
    checkerPermission: 'incident.classification.co-sign',
    dormant: false,
    source: 'Process 55/M09',
  },
] as const satisfies readonly MakerCheckerPair[];

/**
 * The 16 constraint names, as a type.
 *
 * `as const` above is what makes this possible, and it is the difference between a typo at a call site
 * being a compile error and being a refusal message that names a permission nobody holds. That was a real
 * risk: the remedy sentence is built from whatever name the caller passes.
 */
export type MakerCheckerConstraint = NonNullable<
  (typeof MAKER_CHECKER_REGISTRY)[number]['dbCheckConstraint']
>;

/** Looked up by the constraint that enforces it — the only identity that cannot be ambiguous. */
export function pairByConstraint(
  constraint: string,
): MakerCheckerPair | undefined {
  return MAKER_CHECKER_REGISTRY.find((p) => p.dbCheckConstraint === constraint);
}

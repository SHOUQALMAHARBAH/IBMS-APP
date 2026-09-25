/**
 * EVERY MAKER/CHECKER PAIR THIS SYSTEM ENFORCES — the canonical list, in the layer both consumers can read.
 *
 * ## This was MOVED, not written
 *
 * `MAKER_CHECKER_REGISTRY` already existed, complete and correct, in
 * `modules/internal-controls/internal-controls.config.ts` — 15 entries matching the 15 database CHECK
 * constraints one for one. It was moved here (verbatim, plus one field) for a layering reason:
 * `src/common/` must not import from `src/modules/`, and `maker-checker.util.ts` lives in common and now
 * needs the list to name a remedy. `internal-controls.config.ts` re-exports it, so its own consumers are
 * untouched — the same treatment `insurer-performance.config.ts` got when `period.util.ts` was promoted.
 *
 * ## The three lists that were wrong, and the one that was not
 *
 * Measured while planning Part 4:
 *
 *   this registry                15 pairs — matches the database exactly
 *   the database                 15 CHECK constraints across 14 tables
 *   `checker-roles.config.ts`    13 checker permissions — both NeedsAssessment pairs missing
 *   `maker-checker.util.ts`      11 rows in a header comment — four pairs missing
 *
 * The complete list existed all along, in a module nobody opens when touching maker/checker. The two
 * shorter lists are the ones that drifted. Nothing verified any of them against `pg_constraint` —
 * `test/maker-checker-pairs.e2e-spec.ts` now does, so a sixteenth constraint cannot be added without this
 * file moving.
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
    checkerPermission: 'retention.dispose.approve',
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
    checkerPermission: 'complaint.close',
    dormant: false,
    source: 'Process 42',
  },
  {
    entityType: 'DataSubjectRequest',
    pairLabel: 'processedByUserId / closedByUserId',
    modelProperty: 'dataSubjectRequest',
    makerField: 'processedByUserId',
    checkerField: 'closedByUserId',
    dbCheckConstraint: 'DataSubjectRequest_closure_maker_checker_distinct',
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
    checkerPermission: 'incident.classification.co-sign',
    dormant: false,
    source: 'Process 55/M09',
  },
] as const satisfies readonly MakerCheckerPair[];

/**
 * The 15 constraint names, as a type.
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

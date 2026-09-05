/**
 * Process 56 (backlog Part C #56, Domain F) — Internal Controls (Maker/
 * Checker). The backlog line reads "fully covered in Part A.5, plus a
 * periodic audit report scanning for any possible self-approval cases" — see
 * ibms-brain/meta/context/internal-controls-audit.md for the full design
 * note (why each pair below is here, which ones are DB-CHECK-backed, and the
 * one pair that structurally cannot be).
 *
 * `MAKER_CHECKER_REGISTRY` is the single source of truth this scan walks —
 * one entry per DB `CHECK` constraint added across
 * `20260826091424_add_maker_checker_check_constraints`,
 * `20260827120000_add_needs_assessment_status_enum`,
 * `20260903170000_add_complaint_management`,
 * `20260905120000_add_dsr_widening`, and
 * `20260906120000_add_incident_maker_checker_check`. Two entities
 * (`NeedsAssessment`, `PolicyChecking`) contribute more than one pair.
 *
 * `DisposalBatch` / `DataSharingApproval` / `DataProcessingAgreement` are
 * "core schema" models with no application code writing to them yet (M06/
 * M07/M08 are not built — see root README.md's Part D gaps) — `dormant:
 * true` documents that today's scan of them will always see 0 rows, not
 * that they were forgotten (the #48 `third_party_payment_source` dormant-
 * classifier precedent: kept and scanned, not removed, so the day M06/M07/
 * M08 land this report already covers them).
 *
 * The ONE pair with `dbCheckConstraint: null` — `PolicyChecking.checkedByUserId`
 * vs the PARENT `Policy.issuedByUserId` — is not an oversight: a Postgres
 * `CHECK` constraint can only compare columns on the SAME row of the SAME
 * table, and these two columns live on different tables (`PolicyChecking`
 * and `Policy`). `PolicyCheckingService.check()`'s `assertDifferentActors`
 * call is this pair's only guard today; this periodic scan is its only
 * defense-in-depth backstop (see `ibms-brain/meta/context/policy-lifecycle.md`,
 * which flagged this exact open question before #56 answered it).
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
  /** No application code writes to this model yet (M06/M07/M08) — see header comment. */
  dormant: boolean;
  source: string;
}

export const MAKER_CHECKER_REGISTRY: MakerCheckerPair[] = [
  {
    entityType: 'KYCRecord',
    pairLabel: 'createdByUserId / approvedByUserId',
    modelProperty: 'kYCRecord',
    makerField: 'createdByUserId',
    checkerField: 'approvedByUserId',
    dbCheckConstraint: 'KYCRecord_maker_checker_distinct',
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
    dormant: true,
    source: 'PRIV-SRS-01 M06',
  },
  {
    entityType: 'DataSharingApproval',
    pairLabel: 'requestedByUserId / approvedByUserId',
    modelProperty: 'dataSharingApproval',
    makerField: 'requestedByUserId',
    checkerField: 'approvedByUserId',
    dbCheckConstraint: 'DataSharingApproval_maker_checker_distinct',
    dormant: true,
    source: 'PRIV-SRS-01 M08',
  },
  {
    entityType: 'DataProcessingAgreement',
    pairLabel: 'assessedByUserId / dpoApprovedByUserId',
    modelProperty: 'dataProcessingAgreement',
    makerField: 'assessedByUserId',
    checkerField: 'dpoApprovedByUserId',
    dbCheckConstraint: 'DataProcessingAgreement_maker_checker_distinct',
    dormant: true,
    source: 'PRIV-SRS-01 M07',
  },
  {
    entityType: 'Settlement',
    pairLabel: 'approvedByUserId / secondApproverUserId',
    modelProperty: 'settlement',
    makerField: 'approvedByUserId',
    checkerField: 'secondApproverUserId',
    dbCheckConstraint: 'Settlement_maker_checker_distinct',
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
    dormant: false,
    source: 'Process 55/M09',
  },
];

/** Label for the one cross-table pair, kept out of the registry above
 * because it needs a `select` that follows the `policy` relation rather
 * than two plain columns — see the header comment. */
export const POLICY_CHECKING_ISSUER_PAIR = {
  entityType: 'PolicyChecking',
  pairLabel: 'issuedByUserId (Policy) / checkedByUserId',
  dbCheckConstraint: null as string | null,
  dormant: false,
  source:
    'ibms-app product decision — Part 3.4 rationale extended app-side; no single-table CHECK can express it',
};

/** Safety-valve cap per pair — these are all workflow/approval tables, not
 * transactional ledgers, so this should never bind; `truncated: true` on a
 * pair means the report is INCOMPLETE for that pair, not clean. */
export const INTERNAL_CONTROLS_SCAN_LIMIT = 20000;

export interface ScannedRow {
  id: string;
  [field: string]: unknown;
}

export interface SelfApprovalViolation {
  entityType: string;
  pairLabel: string;
  entityId: string;
  makerField: string;
  checkerField: string;
  /** The single user id found on both sides. */
  userId: string;
  dbCheckConstraint: string | null;
}

/** Pure: a row is a violation only when BOTH sides are set (a null checker
 * means "not yet decided," never a violation) and they resolve to the SAME
 * user id. This mirrors `assertDifferentActors`'s own condition exactly —
 * this scan is checking that the guard's invariant held, not applying a
 * different rule. */
export function classifyPairRows(
  pair: Pick<
    MakerCheckerPair,
    | 'entityType'
    | 'pairLabel'
    | 'makerField'
    | 'checkerField'
    | 'dbCheckConstraint'
  >,
  rows: ScannedRow[],
): SelfApprovalViolation[] {
  const violations: SelfApprovalViolation[] = [];
  for (const row of rows) {
    const maker = row[pair.makerField];
    const checker = row[pair.checkerField];
    if (
      typeof maker === 'string' &&
      typeof checker === 'string' &&
      maker === checker
    ) {
      violations.push({
        entityType: pair.entityType,
        pairLabel: pair.pairLabel,
        entityId: row.id,
        makerField: pair.makerField,
        checkerField: pair.checkerField,
        userId: maker,
        dbCheckConstraint: pair.dbCheckConstraint,
      });
    }
  }
  return violations;
}

export interface PolicyCheckingCrossTableRow {
  id: string;
  checkedByUserId: string | null;
  policy: { issuedByUserId: string | null } | null;
}

/** Pure: the cross-table twin of `classifyPairRows` — same condition
 * (both sides set, both equal), just reached through the `policy` relation
 * instead of a second column on the same row. */
export function classifyCrossTableRows(
  rows: PolicyCheckingCrossTableRow[],
): SelfApprovalViolation[] {
  const violations: SelfApprovalViolation[] = [];
  for (const row of rows) {
    const checker = row.checkedByUserId;
    const maker = row.policy?.issuedByUserId ?? null;
    if (
      typeof maker === 'string' &&
      typeof checker === 'string' &&
      maker === checker
    ) {
      violations.push({
        entityType: POLICY_CHECKING_ISSUER_PAIR.entityType,
        pairLabel: POLICY_CHECKING_ISSUER_PAIR.pairLabel,
        entityId: row.id,
        makerField: 'issuedByUserId',
        checkerField: 'checkedByUserId',
        userId: maker,
        dbCheckConstraint: POLICY_CHECKING_ISSUER_PAIR.dbCheckConstraint,
      });
    }
  }
  return violations;
}

export interface MakerCheckerPairResult {
  entityType: string;
  pairLabel: string;
  rowsChecked: number;
  violations: SelfApprovalViolation[];
  dbCheckConstraint: string | null;
  dormant: boolean;
  truncated: boolean;
}

export interface InternalControlsAuditReportByPair {
  entityType: string;
  pairLabel: string;
  rowsChecked: number;
  violationCount: number;
  dbCheckConstraint: string | null;
  dormant: boolean;
  truncated: boolean;
}

export interface InternalControlsAuditReport {
  generatedAt: string;
  pairsScanned: number;
  totalRowsChecked: number;
  violations: SelfApprovalViolation[];
  byPair: InternalControlsAuditReportByPair[];
}

/** Pure: aggregates the per-pair scan results into the report shape the
 * controller returns and the audit row summarizes. */
export function buildInternalControlsReport(
  pairResults: MakerCheckerPairResult[],
  now: Date,
): InternalControlsAuditReport {
  return {
    generatedAt: now.toISOString(),
    pairsScanned: pairResults.length,
    totalRowsChecked: pairResults.reduce((sum, r) => sum + r.rowsChecked, 0),
    violations: pairResults.flatMap((r) => r.violations),
    byPair: pairResults.map((r) => ({
      entityType: r.entityType,
      pairLabel: r.pairLabel,
      rowsChecked: r.rowsChecked,
      violationCount: r.violations.length,
      dbCheckConstraint: r.dbCheckConstraint,
      dormant: r.dormant,
      truncated: r.truncated,
    })),
  };
}

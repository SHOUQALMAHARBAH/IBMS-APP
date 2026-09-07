import {
  DpiaOutcome,
  ComplaintStatus,
  DsrStatus,
  IncidentStatus,
  KycStatus,
} from '@ibms/db';
import {
  deriveComplianceCalendarItemView,
  type ComplianceCalendarItemRow,
} from '../compliance-risk/compliance-calendar.config';
import { COMPLAINT_CATEGORIES } from '../customer-service/complaint.config';

/**
 * Part E — Compliance Dashboard (backlog Process #64, Part 13). Bullet text:
 * "KYC status (approved/pending/overdue for refresh), complaints by
 * status/category, compliance breaches/exceptions, regulatory filing/report
 * status, open DSRs, breach-register status, DPIA backlog." The fifth of the
 * six named dashboards, and the last one gated by a genuinely new dashboard
 * permission — the sixth (Insurer & Employee Performance) is already built
 * (backlog #60/#61).
 *
 * **Seven sections, each reading a DIFFERENT existing table directly — the
 * DPO Workspace "aggregate several registers on one screen, zero
 * cross-module SERVICE dependency" shape**, applied here for the Compliance
 * Officer's own audience instead of the DPO's (there is real overlap: DSRs,
 * DPIA, and the breach register also feed DPO Workspace — that is expected,
 * not a bug, since a Compliance Officer and a DPO both legitimately need
 * visibility into PDPL-adjacent state).
 *
 * **No period range, unlike Claims/Financial — every section is pure
 * current-state with no `asOf` override at all**, a deliberate step further
 * than Claims/Financial's own `asOf` reference-date compromise. Claims/
 * Financial's `asOf` worked because a simple `createdAt` cutoff reasonably
 * approximates "state as of a past date" for those tables (a claim rarely
 * un-closes; an invoice's outstanding-ness is a clean function of receipt
 * timing). Here it would not: a `KYCRecord`'s `status` moves through 7
 * states over its life, a `Complaint` through 6 — filtering by `createdAt <
 * asOf` while still reading the CURRENT `status` column would silently
 * misrepresent "status as of that date" far more than Claims Dashboard's own
 * documented limitation already accepted. Reconstructing genuine
 * point-in-time status for seven different entities would mean walking each
 * one's own status-history table (only `ClaimStatusHistory` exists;
 * `Complaint`/`KYCRecord`/`DataSubjectRequest`/`IncidentReport` have none) —
 * a cost disproportionate to a compliance ROLLUP screen. Deliberately
 * omitted, not an oversight.
 *
 * **`branchId` (-> `Customer.ownerUserId`) is the ONE cross-cutting filter
 * with genuine multi-section reach here — `insuranceLine`/`insurerId` are
 * omitted dashboard-wide**, unlike every prior Part E dashboard. Checked
 * every one of the seven underlying models directly: `KYCRecord`/
 * `Complaint`/`DataSubjectRequest`/`TransactionMonitoringAlert` each tie
 * (optionally, for the latter two) to a `Customer` with an `ownerUserId`, so
 * `branchId` scopes those four. `ComplianceCalendarItem.ownerUserId` names
 * the COMPLIANCE STAFF member tracking an obligation, not a Sales Officer —
 * no branch concept applies. `IncidentReport` and `DpiaScreening` carry no
 * `Customer`/owner relation at all (a company-wide operational incident; a
 * screening of a product/system/vendor, not a client). None of the seven
 * ties to a `Policy`, so `insuranceLine`/`insurerId` have no genuine
 * dimension anywhere on this dashboard — thin enough (present only via
 * `Complaint`'s own OPTIONAL `policyId`) that exposing them dashboard-wide
 * would be force-fitting, the Sales Dashboard "filter applicability is real,
 * not uniform" discipline taken to its logical conclusion: sometimes a
 * dimension doesn't apply ANYWHERE on a given dashboard, not just on some of
 * its metrics.
 *
 * **"Compliance breaches/exceptions" needed a genuinely drafted
 * interpretation — the backlog names no model.** `breach-register status`
 * (its own, separate bullet clause) unambiguously means `IncidentReport`
 * (the PDPL Part 7.4/8.1/9.3 breach workflow — confirmed by grepping the
 * schema for every use of the word "breach"). The only other real "exception"
 * concept in the schema is `ReconciliationException` (#39, bank
 * reconciliation) — but that is FINANCE-owned (`reconciliation-exception.*`
 * grants `[FINANCE, MANAGER]`, no `COMPLIANCE_OFFICER`), so it does not read
 * as a genuinely Compliance-owned exception queue. `TransactionMonitoringAlert`
 * (#48, AML/CFT) IS Compliance-owned (`aml.monitor` grants `[COMPLIANCE_
 * OFFICER]` only) and open ones are a real, cheap-to-query "compliance
 * exception" queue — used here. Internal Controls' own self-approval
 * findings (`internal-controls.view`, also Compliance-visible) are a
 * plausible second candidate, but `InternalControlsService.
 * runSelfApprovalAudit()` is an expensive 16-query LIVE scan by its own doc
 * comment ("measured to add up to a genuinely slow report") — re-running it
 * inline on every Compliance Dashboard load would be disproportionate.
 * Instead this reads the MOST RECENT already-persisted `InternalControlsAuditReport`
 * READ audit row (via `AuditTrailRepository.findAuditLog`, reused directly —
 * no re-scan) for a "last known" violation count and when it was taken —
 * `null` if the audit has never run. So "compliance breaches/exceptions"
 * here means: open AML/CFT alerts (by pattern type) + the most recent
 * self-approval scan's violation count.
 *
 * No migration, no cross-module SERVICE dependency (every repository reads
 * its own table directly; `AuditTrailRepository` is reused the #63/Claims
 * Dashboard "share the repository, not the service" way).
 */

export interface StatusCountRow {
  key: string;
  count: number;
}

function zeroFillCounts(
  keys: readonly string[],
  rows: StatusCountRow[],
): Record<string, number> {
  const byKey = new Map(rows.map((r) => [r.key, r.count]));
  const result: Record<string, number> = {};
  for (const key of keys) result[key] = byKey.get(key) ?? 0;
  return result;
}

export const KYC_STATUS_KEYS = Object.values(KycStatus);
export const COMPLAINT_STATUS_KEYS = Object.values(ComplaintStatus);
export const DSR_STATUS_KEYS = Object.values(DsrStatus);
export const INCIDENT_STATUS_KEYS = Object.values(IncidentStatus);
export const DPIA_OUTCOME_KEYS = Object.values(DpiaOutcome);
/** `Complaint.category` is nullable — an uncategorized complaint gets its
 * own bucket alongside the controlled list. */
export const COMPLAINT_CATEGORY_KEYS = [
  ...COMPLAINT_CATEGORIES,
  'uncategorized',
];

export interface RegulatoryFilingsSummary {
  totalCount: number;
  submittedCount: number;
  overdueCount: number;
  pendingCount: number;
}

/** Pure: composes the regulatory-filing summary from raw `ComplianceCalendarItem`
 * rows, reusing #51's own `deriveComplianceCalendarItemView` directly rather
 * than re-deriving the overdue rule. */
export function buildRegulatoryFilingsSummary(
  rows: ComplianceCalendarItemRow[],
  now: Date,
): RegulatoryFilingsSummary {
  const views = rows.map((r) => deriveComplianceCalendarItemView(r, now));
  const submittedCount = views.filter((v) => v.isSubmitted).length;
  const overdueCount = views.filter((v) => v.isOverdue).length;
  return {
    totalCount: views.length,
    submittedCount,
    overdueCount,
    pendingCount: views.length - submittedCount - overdueCount,
  };
}

export interface ComplianceDashboardSummary {
  generatedAt: string;
  kyc: { byStatus: Record<string, number> };
  complaints: {
    byStatus: Record<string, number>;
    byCategory: Record<string, number>;
  };
  complianceExceptions: {
    openAmlAlertsCount: number;
    amlByPatternType: Record<string, number>;
    lastSelfApprovalScan: { asOf: string; violationCount: number } | null;
  };
  regulatoryFilings: RegulatoryFilingsSummary;
  dsr: { openCount: number; byStatus: Record<string, number> };
  breachRegister: { openCount: number; byStatus: Record<string, number> };
  dpiaBacklog: {
    pendingReviewCount: number;
    byOutcome: Record<string, number>;
  };
}

export function buildComplianceDashboardSummary(input: {
  now: Date;
  kycByStatus: StatusCountRow[];
  complaintsByStatus: StatusCountRow[];
  complaintsByCategory: StatusCountRow[];
  amlOpenByPatternType: StatusCountRow[];
  lastSelfApprovalScan: { asOf: Date; violationCount: number } | null;
  regulatoryFilingRows: ComplianceCalendarItemRow[];
  dsrByStatus: StatusCountRow[];
  incidentByStatus: StatusCountRow[];
  dpiaByOutcome: StatusCountRow[];
  dpiaPendingReviewCount: number;
}): ComplianceDashboardSummary {
  const dsrByStatus = zeroFillCounts(DSR_STATUS_KEYS, input.dsrByStatus);
  const incidentByStatus = zeroFillCounts(
    INCIDENT_STATUS_KEYS,
    input.incidentByStatus,
  );
  const amlByPatternType = Object.fromEntries(
    input.amlOpenByPatternType.map((r) => [r.key, r.count]),
  );

  return {
    generatedAt: input.now.toISOString(),
    kyc: { byStatus: zeroFillCounts(KYC_STATUS_KEYS, input.kycByStatus) },
    complaints: {
      byStatus: zeroFillCounts(COMPLAINT_STATUS_KEYS, input.complaintsByStatus),
      byCategory: zeroFillCounts(
        COMPLAINT_CATEGORY_KEYS,
        input.complaintsByCategory,
      ),
    },
    complianceExceptions: {
      openAmlAlertsCount: input.amlOpenByPatternType.reduce(
        (sum, r) => sum + r.count,
        0,
      ),
      amlByPatternType,
      lastSelfApprovalScan: input.lastSelfApprovalScan
        ? {
            asOf: input.lastSelfApprovalScan.asOf.toISOString(),
            violationCount: input.lastSelfApprovalScan.violationCount,
          }
        : null,
    },
    regulatoryFilings: buildRegulatoryFilingsSummary(
      input.regulatoryFilingRows,
      input.now,
    ),
    dsr: {
      openCount: DSR_STATUS_KEYS.filter((k) => k !== 'CLOSED').reduce(
        (sum, k) => sum + dsrByStatus[k],
        0,
      ),
      byStatus: dsrByStatus,
    },
    breachRegister: {
      openCount: INCIDENT_STATUS_KEYS.filter((k) => k !== 'CLOSED').reduce(
        (sum, k) => sum + incidentByStatus[k],
        0,
      ),
      byStatus: incidentByStatus,
    },
    dpiaBacklog: {
      pendingReviewCount: input.dpiaPendingReviewCount,
      byOutcome: zeroFillCounts(DPIA_OUTCOME_KEYS, input.dpiaByOutcome),
    },
  };
}

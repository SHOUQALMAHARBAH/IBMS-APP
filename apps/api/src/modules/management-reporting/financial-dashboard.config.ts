import {
  buildCommissionRollup,
  buildInsurerPayables,
  buildProfitability,
  buildReceivablesAgeing,
  type CommissionRollup,
  type CommissionRollupEntryRow,
  type InsurerObligationRow,
  type InsurerPayablesReport,
  type InsurerRemittanceRow,
  type OutstandingInvoiceRow,
  type ProfitabilitySection,
  type ReceivablesAgeingReport,
} from '../finance/finance.config';
import type { ProfitabilityPolicyRow } from '../../repositories/profitability-policy.repository';

/**
 * Part E — Financial Dashboard (backlog Process #64, Part 13). Bullet text:
 * "receivables and ageing, payables to insurers, commission income and
 * outstanding commission, profitability by client segment/line."
 *
 * **This is a "mostly built, needs a real refinement" item — not a fresh
 * build, and not a pure "verify, don't build" outcome either.** Backlog #40
 * (`FinancialReportService.summary()`, `GET /financial-report/summary`)
 * already computes every one of these four sections, verbatim — its own doc
 * comment quotes this Part E bullet directly. But #40's own DTO says outright
 * "No line / insurer / branch filters here — those are a Part E dashboard
 * refinement" — the ONE genuine gap between #40 and Part E's cross-cutting
 * "filterable by branch/line/insurer/period" rule. This module supplies that
 * refinement, reusing #40's own PURE builders (`buildReceivablesAgeing` /
 * `buildInsurerPayables` / `buildCommissionRollup` / `buildProfitability`) via
 * direct import — the Claims Dashboard "reuse a pure function directly"
 * precedent, applied to four functions instead of one — rather than
 * duplicating a single line of bucket/rollup/netPosition math. The
 * REPOSITORIES that feed them (`InvoiceRepository`, `FinancialReportRepository`,
 * `ProfitabilityPolicyRepository`) were widened with optional
 * `insuranceLine`/`insurerId`/`ownerUserIds` scope params (all additive — no
 * existing caller's call site changed) rather than duplicated, the #63
 * Profitability Analysis / Claims Dashboard "share the repository, not the
 * service" shape: each is independently re-provided in THIS module's own
 * `providers` array, with zero `imports`/`exports` wiring to `FinanceModule`.
 *
 * **Every section here is current-state, like Claims Dashboard — no period
 * range.** Receivables/payables are point-in-time at a single `asOf`
 * reference date (`#33`/`#34`'s own existing shape); commission and
 * profitability are current-state with no date dimension at all (the
 * commission ledger and `Policy.issuedPremium` are not time-versioned — #40's
 * own doc comment already says so). `asOf` therefore scopes ONLY the
 * receivables/payables sections, never commission/profitability — mirrored
 * exactly from #40, not a new design.
 *
 * **Filter applicability is real, not uniform** — the newly-added
 * branch/line/insurer filters do NOT apply identically to every section:
 * - `insurerId` scopes all four sections (every section is insurer-adjacent:
 *   receivables via the invoice's policy, payables IS grouped by insurer,
 *   commission IS grouped by insurer, profitability via the policy).
 * - `insuranceLine` / `branchId` scope receivables, commission, and
 *   profitability (all reachable via a `Policy`) — but NOT the remittance
 *   side of payables: a `Remittance` is a lump payment against one insurer
 *   with no `Policy` relation of its own (it can cover many invoices/lines/
 *   branches in one payment), so `insuranceLine`/`branchId` cannot narrow it.
 *   The "outstanding obligations" side of payables IS still narrowed by both,
 *   since an obligation is one specific invoice tied to one specific policy.
 * - An outstanding invoice with NO linked policy (`Invoice.policyId` is
 *   nullable) is excluded whenever `insuranceLine`/`insurerId`/`branchId` is
 *   given — a filter on the underlying policy cannot include a receivable
 *   with no policy to check it against.
 *
 * `dashboard.financial.view`'s role grant (`[FINANCE, MANAGER, EXEC]`) is a
 * strict SUBSET of `financial-report.view`'s (`+ EXTERNAL_AUDITOR`) — so there
 * is no practical access gap between the two permissions today. Kept as its
 * own dedicated Part E permission anyway (the Sales/Policy/Claims Dashboard
 * shape — a pre-seeded dashboard.*.view code gates its own dashboard-specific
 * endpoint), rather than widening `GET /financial-report/summary`'s own
 * `@RequirePermissions` to accept it: unlike the Notices "also accepts
 * consent.manage" precedent (one unchanged endpoint, two independent callers
 * with identical needs), this endpoint's needs genuinely differ from #40's
 * (branch/line/insurer filtering), so it earns a real, separate route.
 */

export interface FinancialDashboardSummary {
  generatedAt: string;
  asOf: string;
  currency: string;
  receivables: ReceivablesAgeingReport;
  payables: InsurerPayablesReport;
  commission: CommissionRollup;
  profitability: ProfitabilitySection;
}

export function buildFinancialDashboardSummary(input: {
  now: Date;
  asOf: Date;
  outstandingInvoices: OutstandingInvoiceRow[];
  obligations: InsurerObligationRow[];
  remittances: InsurerRemittanceRow[];
  commissionEntries: CommissionRollupEntryRow[];
  profitabilityPolicies: ProfitabilityPolicyRow[];
}): FinancialDashboardSummary {
  return {
    generatedAt: input.now.toISOString(),
    asOf: input.asOf.toISOString(),
    currency: 'JOD',
    receivables: buildReceivablesAgeing({
      asOf: input.asOf,
      invoices: input.outstandingInvoices,
    }),
    payables: buildInsurerPayables({
      asOf: input.asOf,
      obligations: input.obligations,
      remittances: input.remittances,
    }),
    commission: buildCommissionRollup(input.commissionEntries),
    profitability: buildProfitability(input.profitabilityPolicies),
  };
}

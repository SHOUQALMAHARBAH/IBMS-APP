import type { TranslationKey } from '../../lib/i18n/translations';
import { hasAnyPermission } from '../../lib/auth/permissions';
import type { MeResponse } from '../../lib/auth/auth-api';

/**
 * THE destination catalogue, and THE rule that decides whether a destination renders.
 *
 * It lives here rather than inside `AppNav` because it is not the sidebar's private business.
 * Every surface that offers a route — the sidebar, the home launcher, anything added later — reads
 * this list and asks `canReach`. One mechanism, not one per surface.
 *
 * That rule exists because the alternative was measured and shipped: the sidebar assembled itself
 * from the resolved permission set (correct), while the home launcher — the FIRST screen after
 * login — carried its own hard-coded list of seven cards with no permission check at all. An office
 * administrator was shown four screens that answer 403 for her and none of the three she can
 * actually use, and concluded the role screen did not exist. It did; nothing pointed at it.
 *
 * So: a destination declared once, with its gate beside it. If you render a route from anywhere,
 * take it from here and filter it with `canReach`. Do not write a second list.
 */
export type Destination = {
  href: string;
  labelKey: TranslationKey;
  /** Holding ANY of these reveals the destination. Omitted = always visible. */
  permissions?: readonly string[];
};

export type DestinationGroup = { labelKey: TranslationKey; items: readonly Destination[] };

/**
 * Hidden, not shown-then-denied. A destination whose permission the user does not hold must not
 * appear at all: a card that renders and then refuses teaches people that the product is broken,
 * and tells them which screens exist that they may not use.
 */
export function canReach(
  // The same shape `hasAnyPermission` takes, so a caller cannot pass something narrower and get a
  // quietly permissive answer.
  user: Pick<MeResponse, 'permissions'> | null | undefined,
  destination: Destination,
): boolean {
  return !destination.permissions || hasAnyPermission(user, destination.permissions);
}

export const HOME: Destination = { href: '/', labelKey: 'navHome' };

/** Declaration order is the DEFAULT group order, used by any role without an
 *  entry in NAV_ORDER_BY_ROLE. */
export const DESTINATION_GROUPS: readonly DestinationGroup[] = [
  {
    labelKey: 'navGroupNewBusiness',
    items: [
      { href: '/leads', labelKey: 'navLeads', permissions: ['lead.list.read'] },
      { href: '/prospects', labelKey: 'navProspects', permissions: ['prospect.read'] },
      { href: '/needs-assessments', labelKey: 'navNeedsAssessments', permissions: ['needs-assessment.read'] },
      { href: '/risk-profiles', labelKey: 'navRiskSurveys', permissions: ['risk-profile.read'] },
      { href: '/insurance-programs', labelKey: 'navInsurancePrograms', permissions: ['program.read'] },
      { href: '/opportunities', labelKey: 'navRfqMarket', permissions: ['opportunity.read'] },
      // ## Why the insurer register lives HERE and not in Operations
      //
      // It was in Operations first, beside `/vendors`, on the argument that both are counterparty
      // REGISTERS while New business is a pipeline of stages. CI refuted that argument, and the
      // refutation is the better rule: `sidebar-executive.spec.ts` asserts an Executive sees NO
      // Operations group at all, and an Executive holds `insurer.read` AND
      // `insurer.directory.read` — so the entry made an administrative group appear for a role
      // that deliberately has none of it.
      //
      // The rule that settles it is not what KIND of thing a screen is, it is WHO holds the
      // permission that gates it. A nav entry must sit in a group every holder of its permission
      // can see. `insurer.read` is broad — Sales, Placement, Manager, Executive, Compliance, the
      // external auditor — and Operations is narrow by design (`*.manage` registers). New business
      // is where every one of those roles already works, and insurers are the counterparties of
      // the market `/opportunities` takes business to.
      { href: '/insurers', labelKey: 'navInsurers', permissions: ['insurer.read'] },
      // Its OWN entry and its own permission, never a tab on `/insurers`. They answer opposite
      // questions — "who does my office deal with, on what terms" versus "which companies exist at
      // all" — and `insurer.directory.read` is separate precisely so an office can be given the
      // market without also being given its own panel. A tab would imply one grants the other.
      {
        href: '/insurer-directory',
        labelKey: 'navInsurerDirectory',
        permissions: ['insurer.directory.read'],
      },
    ],
  },
  {
    labelKey: 'navGroupClients',
    items: [
      { href: '/customers', labelKey: 'navCustomers', permissions: ['customer.360-view.read'] },
      { href: '/crm', labelKey: 'navCrm', permissions: ['customer.360-view.read'] },
      { href: '/customers/kyc-queue', labelKey: 'navKycQueue', permissions: ['customer.360-view.read'] },
      { href: '/cross-sell', labelKey: 'navCrossSell', permissions: ['cross-sell.read'] },
      { href: '/up-sell', labelKey: 'navUpSell', permissions: ['up-sell.read'] },
    ],
  },
  {
    labelKey: 'navGroupPolicies',
    items: [
      { href: '/policies', labelKey: 'navPolicies', permissions: ['policy.read'] },
      // The Claims desk's own landing screen. The "Claims" GROUP was dissolved
      // earlier precisely because it held only an analytics screen with no
      // operational claims screen to sit beside; the operational screen now
      // exists, and it belongs next to the policy a claim is made against —
      // Policy -> Claims -> Renewals is the lifecycle order.
      { href: '/claims', labelKey: 'navClaims', permissions: ['claim.read'] },
      { href: '/renewal-cases', labelKey: 'navRenewalCases', permissions: ['renewal.read'] },
    ],
  },
  {
    labelKey: 'navGroupFinance',
    items: [
      { href: '/client-accounting', labelKey: 'navClientAccounting', permissions: ['client-accounting.read'] },
      { href: '/insurer-accounting', labelKey: 'navInsurerAccounting', permissions: ['insurer-accounting.read'] },
      {
        href: '/commission',
        labelKey: 'navCommissionRates',
        permissions: ['commission-rate.manage', 'financial-report.view'],
      },
      { href: '/payment-channels', labelKey: 'navPaymentChannels', permissions: ['payment-channel.read'] },
      {
        href: '/bank-reconciliation',
        labelKey: 'navBankReconciliation',
        permissions: ['reconciliation-exception.investigate'],
      },
      { href: '/financial-report', labelKey: 'navFinancialReport', permissions: ['financial-report.view'] },
    ],
  },
  {
    labelKey: 'navGroupService',
    items: [
      { href: '/service-requests', labelKey: 'navCustomerRequests', permissions: ['service-request.manage'] },
      { href: '/complaints', labelKey: 'navComplaints', permissions: ['complaint.log'] },
      { href: '/communications', labelKey: 'navCommunications', permissions: ['communication.send'] },
      { href: '/feedback', labelKey: 'navFeedback', permissions: ['feedback.log'] },
      { href: '/retention-cases', labelKey: 'navRetention', permissions: ['retention-case.manage'] },
      { href: '/sla-dashboard', labelKey: 'navSlaDashboard', permissions: ['sla-dashboard.view'] },
    ],
  },
  {
    labelKey: 'navGroupDashboards',
    items: [
      { href: '/kpi-dashboard', labelKey: 'navKpiDashboard', permissions: ['kpi-dashboard.view'] },
      { href: '/dashboards/sales', labelKey: 'navSalesDashboard', permissions: ['dashboard.sales.view'] },
      { href: '/dashboards/policy', labelKey: 'navPolicyDashboard', permissions: ['dashboard.policy.view'] },
      { href: '/dashboards/claims', labelKey: 'navClaimsDashboard', permissions: ['dashboard.claims.view'] },
      { href: '/dashboards/financial', labelKey: 'navFinancialDashboard', permissions: ['dashboard.financial.view'] },
      {
        href: '/dashboards/compliance',
        labelKey: 'navComplianceDashboard',
        permissions: ['dashboard.compliance.view'],
      },
      {
        href: '/dashboards/insurer-employee-performance',
        labelKey: 'navInsurerEmployeePerformanceDashboard',
        permissions: ['insurer-performance.view', 'employee-performance.view'],
      },
      { href: '/dashboards/executive', labelKey: 'navExecutiveDashboard', permissions: ['dashboard.executive.view'] },
    ],
  },
  {
    labelKey: 'navGroupPerformance',
    items: [
      {
        href: '/sales-performance',
        labelKey: 'navSalesPerformance',
        permissions: ['dashboard.sales.view', 'sales-target.manage'],
      },
      { href: '/employee-performance', labelKey: 'navEmployeePerformance', permissions: ['employee-performance.view'] },
      { href: '/insurer-performance', labelKey: 'navInsurerPerformance', permissions: ['insurer-performance.view'] },
      { href: '/portfolio-analysis', labelKey: 'navPortfolioAnalysis', permissions: ['portfolio-analysis.view'] },
      { href: '/claims-analytics', labelKey: 'navClaimsAnalytics', permissions: ['claims-analytics.view'] },
      {
        href: '/profitability-analysis',
        labelKey: 'navProfitabilityAnalysis',
        permissions: ['profitability-analysis.view'],
      },
      { href: '/planning-export', labelKey: 'navPlanningExport', permissions: ['planning-export.generate'] },
    ],
  },
  {
    labelKey: 'navGroupPrivacy',
    items: [
      { href: '/consent', labelKey: 'navConsent', permissions: ['consent.manage'] },
      { href: '/dsr', labelKey: 'navDsr', permissions: ['dsr.log'] },
      {
        href: '/retention-disposal',
        labelKey: 'navRetentionDisposal',
        permissions: [
          'retention-schedule.manage',
          'legal-hold.manage',
          'retention.dispose.nominate',
          'retention.dispose.approve',
        ],
      },
      {
        href: '/cross-border-transfers',
        labelKey: 'navCrossBorderTransfer',
        permissions: ['cross-border-transfer.approve'],
      },
      {
        href: '/data-sharing-approvals',
        labelKey: 'navDataSharing',
        permissions: ['data-sharing.approve', 'data-sharing.request'],
      },
      { href: '/dpia-screenings', labelKey: 'navDpiaScreening', permissions: ['dpia.review'] },
      { href: '/privacy-notices', labelKey: 'navNotices', permissions: ['privacy-notice.read'] },
      { href: '/ropa-entries', labelKey: 'navRopa', permissions: ['ropa.manage'] },
      { href: '/dpo-workspace', labelKey: 'navDpoWorkspace', permissions: ['dpo-workspace.view'] },
    ],
  },
  {
    labelKey: 'navGroupCompliance',
    items: [
      { href: '/transaction-monitoring', labelKey: 'navAmlMonitoring', permissions: ['aml.monitor'] },
      { href: '/watchlist-sync', labelKey: 'navWatchlistSync', permissions: ['sanctions-pep.screen'] },
      { href: '/screening-matches', labelKey: 'navScreeningMatches', permissions: ['sanctions-pep.screen'] },
      { href: '/screening-health', labelKey: 'navScreeningHealth', permissions: ['sanctions-pep.screen'] },
      {
        href: '/regulatory-compliance',
        labelKey: 'navRegulatoryCompliance',
        permissions: ['compliance-calendar.manage', 'license.manage'],
      },
      {
        href: '/operational-pi-risk',
        labelKey: 'navOperationalPiRisk',
        permissions: ['pi-policy.manage', 'risk-register.manage'],
      },
      { href: '/incidents', labelKey: 'navIncidentManagement', permissions: ['incident.report'] },
      { href: '/internal-controls', labelKey: 'navInternalControls', permissions: ['internal-controls.view'] },
      {
        href: '/internal-audit-findings',
        labelKey: 'navInternalAuditFindings',
        permissions: ['internal-audit.record', 'internal-audit.close'],
      },
      { href: '/sla-policies', labelKey: 'navSlaPolicies', permissions: ['sla.policy.read'] },
      { href: '/audit-trail', labelKey: 'navAuditTrail', permissions: ['audit-log.read'] },
    ],
  },
  {
    labelKey: 'navGroupOperations',
    items: [
      { href: '/employees', labelKey: 'navEmployees', permissions: ['employee.read'] },
      { href: '/vendors', labelKey: 'navVendors', permissions: ['vendor.read'] },
      { href: '/information-assets', labelKey: 'navInformationAssets', permissions: ['information-asset.manage'] },
      { href: '/documents', labelKey: 'navDocuments', permissions: ['document.read'] },
      { href: '/bcp-dr-plans', labelKey: 'navBcpDrPlans', permissions: ['bcp-dr.manage'] },
      { href: '/knowledge-base', labelKey: 'navKnowledgeBase', permissions: ['kb.publish'] },
    ],
  },
  {
    labelKey: 'navGroupAdmin',
    items: [
      {
        href: '/access-recertification',
        labelKey: 'navAccessRecertification',
        permissions: ['access-recertification.review'],
      },
      { href: '/settings/users', labelKey: 'navUserAdmin', permissions: ['user.manage'] },
      // `role.read`, not a write code: a caller who may look at the office's
      // roles but not change them gets the screen read-only rather than no link
      // at all. That is the whole reason the prep step split those two names.
      { href: '/settings/roles', labelKey: 'navRoleAdmin', permissions: ['role.read'] },
      {
        href: '/settings/duty-segregation',
        labelKey: 'navDutySegregation',
        // BOTH codes, and the two see different screens: the office administrator can declare the mode,
        // while Compliance / Executive / the external auditor can only read it — which is the separation the
        // API enforces and the reason the read is deliberately open to the second group. A single gate here
        // would hide the office's own posture from the people who review the acts it permits.
        permissions: ['duty-segregation.mode.declare', 'internal-controls.view'],
      },
      {
        href: '/settings/org-units',
        labelKey: 'navOrgUnits',
        // Either code opens the screen; each column renders only for the one that gates it. A single
        // gate here would hide branches from someone who may read them but not departments.
        permissions: ['department.read', 'branch.read'],
      },
    ],
  },
];

/*
 * Navigation order per role — the whole of what "ordered by how often it is used"
 * means in this pass, and it is a FIXED, role-informed order rather than a
 * measured one. That is not a shortcut; it is what the data supports. There is
 * no page-view telemetry anywhere in apps/web, and AuditLogEntry's READ action
 * is written at only 27 deliberate sites, weighted towards reporting screens —
 * so ordering by it would rank dashboards top precisely because dashboards are
 * what log reads. A Manager does not even hold `audit-log.read`. Real
 * per-user ordering needs its own data-collection decision (and the DPO in the
 * room, since it is employee monitoring); see the plan.
 *
 * A role absent from this map falls back to NAV_GROUPS' declaration order.
 */
export type RoleNavOrder = {
  /** Every group key, so the order stays defined if a permission changes and
   *  a group this role cannot currently see starts rendering. */
  groups: readonly TranslationKey[];
  /**
   * Hrefs lifted to the top of THEIR OWN group for this role.
   *
   * Item order is otherwise global, deliberately — a second per-role item
   * taxonomy is exactly the duplicated structure this file's header argues
   * against. But one item genuinely changes meaning with the reader:
   * /dashboards/executive is the screen an Executive opens first and the one a
   * Manager opens last, and it cannot be both eighth and first in a single
   * global list. A short list of exceptions carried on the SAME per-role
   * entry as the group order is the smallest thing that expresses it — one
   * place to look for "what is different for this role", rather than two
   * parallel maps to keep in step.
   */
  hoist?: readonly string[];
};

/**
 * The house order, for every role.
 *
 * This was the Branch/Department Manager's own order and nobody else's. Every
 * other role except Executive fell through to the DECLARATION order of
 * `NAV_GROUPS` — which is an artefact of how the file was written, not a
 * decision about what an officer needs first. That is what made a manager's
 * sidebar look considered and everyone else's look arbitrary: not one pixel of
 * styling (there is no role-conditional styling anywhere in this component —
 * every role renders the same `sidebarStyle`, the same `<details>` groups and
 * the same link styles), purely the order the groups came out in.
 *
 * Work first, administration last. It reads correctly for a Claims Officer or
 * a Finance Officer for the same reason it reads correctly for a Manager: the
 * groups a role cannot see are filtered out before this order is applied, so a
 * role simply gets its own subset of the same sequence.
 */
export const DEFAULT_NAV_ORDER: RoleNavOrder = {
  groups: [
    'navGroupClients',
    'navGroupNewBusiness',
    'navGroupPolicies',
    'navGroupService',
    'navGroupFinance',
    'navGroupDashboards',
    'navGroupPerformance',
    'navGroupCompliance',
    'navGroupOperations',
    'navGroupPrivacy',
    'navGroupAdmin',
  ],
};

export const NAV_ORDER_BY_ROLE: Readonly<Record<string, RoleNavOrder>> = {
  // An Executive reads the numbers first and the pipeline afterwards — the
  // mirror image of the Manager, who lives in the book and checks the numbers.
  // Operations and Privacy render for neither role today; they are listed so a
  // future permission grant does not land them in an arbitrary position.
  EXECUTIVE_MANAGEMENT: {
    groups: [
      'navGroupDashboards',
      'navGroupPerformance',
      'navGroupFinance',
      'navGroupPolicies',
      'navGroupClients',
      'navGroupNewBusiness',
      'navGroupService',
      'navGroupCompliance',
      'navGroupOperations',
      'navGroupPrivacy',
      'navGroupAdmin',
    ],
    hoist: ['/dashboards/executive'],
  },
};

/** Self-service account security. Never gated — see the note above. */
export const SECURITY: Destination = { href: '/settings/security', labelKey: 'navSecurity' };

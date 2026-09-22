'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { useAuth } from '../../lib/auth/auth-context';
import { hasAnyPermission } from '../../lib/auth/permissions';
import { useLanguage } from '../../lib/i18n/language-context';
import { foldedIncludes, foldForSearch } from '../../lib/i18n/fold';
import type { TranslationKey } from '../../lib/i18n/translations';
import { TextInput } from '../ui/Field';
import {
  getNavGroupServerSnapshot,
  getNavGroupSnapshot,
  setNavGroupOpen,
  subscribeNavGroups,
} from './nav-open-groups';
import {
  navGroupItemsStyle,
  navGroupSummaryStyle,
  navLinkActiveStyle,
  navLinkStyle,
  navSearchInputStyle,
  navSearchStatusStyle,
  navSearchWrapStyle,
  sidebarFooterStyle,
  sidebarStyle,
} from './app.styles';

/*
 * The primary navigation.
 *
 * Every item names the permission its own destination endpoint enforces, and
 * an item the signed-in user does not hold is NOT RENDERED. This is frontend
 * directive section 1 and MULTI-TENANCY-SPEC 10.4: if a role cannot do
 * something, the control does not exist on their screen — never render it and
 * let the page explain a 403 afterwards.
 *
 * That "render it and let the page 403" pattern is what this file used to do,
 * deliberately, with a comment saying a nav-level grid "would only duplicate
 * — and drift from — the seeded grid". The drift concern was real; the
 * conclusion was wrong. The fix is not to skip the check, it is to stop
 * hand-maintaining a second copy of the grid: user.permissions is the
 * server's OWN resolved set, returned by /auth/me from the same grid the API
 * enforces with, so there is nothing here to drift.
 *
 * The permission codes below were derived mechanically, not guessed — each is
 * what RequirePermissions on that route's own GET handler asks for.
 *
 * Two items carry NO permission and are always visible:
 *   - Home, which is a launcher and holds nothing privileged.
 *   - Security (in the footer), which is SELF-SERVICE MFA enrolment. It must
 *     never be gated: MfaRequiredGuard 403s every other screen until a user
 *     enrols, so hiding the one route that lets them enrol would lock out
 *     every role that does not hold the admin security-config.read — which is
 *     ten of the eleven.
 *
 * ---------------------------------------------------------------------------
 * WHY THE GROUPS LOOK LIKE THIS
 * ---------------------------------------------------------------------------
 * A broadly-permissioned role reaches a lot of this: a Branch/Department
 * Manager sees 43 of the 68 gated items, an Executive 36. Before this pass all
 * of them rendered at once, and two groups carried 25 of the Manager's 43 —
 * so the rail always scrolled and the header rows did no real work.
 *
 * Three structural edits, taken from the reviewed plan:
 *   - "Sales & clients" (13, the largest) split into New business / Clients /
 *     Policies. It was mixing three different jobs: winning work, servicing an
 *     existing book, and the policies themselves.
 *   - "Insights & reporting" (14) split into Dashboards / Performance &
 *     analysis — a screen you watch versus a question you go and answer.
 *   - "Claims" held exactly one item, an analytics screen, with no operational
 *     claims screen to sit beside. Dissolved into Performance & analysis.
 *
 * ONE taxonomy, filtered per role — never a per-role tree. A user holding two
 * roles still gets one coherent sidebar, and there is no second structure to
 * drift from the grid. What varies per role is ORDER; see
 * NAV_ORDER_BY_ROLE.
 *
 * Item order inside the six groups this pass did not restructure is left
 * exactly as it was, deliberately: re-sequencing groups nobody asked about
 * would bury the change that was actually reviewed.
 *
 * Deliberately NOT in scope here, and still open: directive section 5 wants a
 * sidebar of "major modules only", and 43 grouped entries are still 43
 * entries. Collapsing makes the rail usable; it does not make it short. The
 * prune that would — folding KYC queue into Customers, consolidating the
 * performance screens — moves PAGES, needs client sign-off on what merges, and
 * is tracked as a separate pass. See README section Known gaps.
 */
type NavItem = {
  href: string;
  labelKey: TranslationKey;
  /** Holding ANY of these reveals the item. Omitted = always visible. */
  permissions?: readonly string[];
};

type NavGroup = { labelKey: TranslationKey; items: readonly NavItem[] };

const HOME: NavItem = { href: '/', labelKey: 'navHome' };

/** Declaration order is the DEFAULT group order, used by any role without an
 *  entry in NAV_ORDER_BY_ROLE. */
const NAV_GROUPS: readonly NavGroup[] = [
  {
    labelKey: 'navGroupNewBusiness',
    items: [
      { href: '/leads', labelKey: 'navLeads', permissions: ['lead.list.read'] },
      { href: '/prospects', labelKey: 'navProspects', permissions: ['prospect.read'] },
      { href: '/needs-assessments', labelKey: 'navNeedsAssessments', permissions: ['needs-assessment.read'] },
      { href: '/risk-profiles', labelKey: 'navRiskSurveys', permissions: ['risk-profile.read'] },
      { href: '/insurance-programs', labelKey: 'navInsurancePrograms', permissions: ['program.read'] },
      { href: '/opportunities', labelKey: 'navRfqMarket', permissions: ['opportunity.read'] },
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
      { href: '/payment-channels', labelKey: 'navPaymentChannels', permissions: ['payment-channel.manage'] },
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
      // Beside /vendors, because both are counterparty REGISTERS an office maintains — and not in
      // "New business", which is a pipeline of stages (lead -> prospect -> ... -> opportunity)
      // rather than a place for a list you keep. Insurers first: for a broker they are the primary
      // counterparty, and /vendors is everything else.
      { href: '/insurers', labelKey: 'navInsurers', permissions: ['insurer.read'] },
      { href: '/vendors', labelKey: 'navVendors', permissions: ['vendor.manage'] },
      { href: '/information-assets', labelKey: 'navInformationAssets', permissions: ['information-asset.manage'] },
      { href: '/documents', labelKey: 'navDocuments', permissions: ['document.manage'] },
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
      // `role.read`, not `role.manage`: a caller who may look at the office's
      // roles but not change them gets the screen read-only rather than no link
      // at all. That is the whole reason the prep step split those two names.
      { href: '/settings/roles', labelKey: 'navRoleAdmin', permissions: ['role.read'] },
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
type RoleNavOrder = {
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
const DEFAULT_NAV_ORDER: RoleNavOrder = {
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

const NAV_ORDER_BY_ROLE: Readonly<Record<string, RoleNavOrder>> = {
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
const SECURITY: NavItem = { href: '/settings/security', labelKey: 'navSecurity' };

function matches(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

/** The first role THIS MAP declares that the user actually holds — so the
 *  result does not depend on the order /auth/me happens to return roles in.
 *  Anyone the map does not name gets `DEFAULT_NAV_ORDER`, which is the same
 *  sequence a Manager sees; nobody falls through to the declaration order. */
function navOrderFor(roles: readonly string[] | undefined): RoleNavOrder {
  if (roles?.length) {
    for (const [role, order] of Object.entries(NAV_ORDER_BY_ROLE)) {
      if (roles.includes(role)) return order;
    }
  }
  return DEFAULT_NAV_ORDER;
}

/** Position in `order`, or the end for anything the list does not name.
 *  Paired with a stable sort, so unnamed entries keep their relative order. */
function rankIn(order: readonly string[], value: string): number {
  const i = order.indexOf(value);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

export function AppNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { t, tPlural } = useLanguage();

  const canSee = (item: NavItem) => !item.permissions || hasAnyPermission(user, item.permissions);

  const permitted = NAV_GROUPS.map((group) => ({
    labelKey: group.labelKey,
    items: group.items.filter(canSee),
  })).filter((group) => group.items.length > 0);

  const roleOrder = navOrderFor(user?.roles);
  // Array.prototype.sort is stable, so a group the order omits keeps its
  // declaration position relative to the other omitted ones, and an item no
  // `hoist` names keeps its global position relative to the other unhoisted
  // ones.
  const hoist = roleOrder?.hoist;
  const withHoistedItems =
    hoist && hoist.length > 0
      ? permitted.map((group) => ({
          labelKey: group.labelKey,
          items: [...group.items].sort((a, b) => rankIn(hoist, a.href) - rankIn(hoist, b.href)),
        }))
      : permitted;

  const visibleGroups = roleOrder
    ? [...withHoistedItems].sort(
        (a, b) => rankIn(roleOrder.groups, a.labelKey) - rankIn(roleOrder.groups, b.labelKey),
      )
    : withHoistedItems;

  // Longest matching href wins, so /customers/kyc-queue highlights "KYC
  // queue" only — not "Customers" as well. Computed over the VISIBLE set so a
  // hidden item can never claim the active state.
  const activeHref = [HOME, ...visibleGroups.flatMap((g) => g.items), SECURITY]
    .filter((item) => matches(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const activeGroupKey = visibleGroups.find((g) => g.items.some((i) => i.href === activeHref))?.labelKey;

  /*
   * Open/closed state, read from an external store rather than held in state.
   * See ./nav-open-groups.ts for why that is not a stylistic choice: a
   * `useState` initialiser reading localStorage is a hydration bug, and
   * adopting it in a mount effect is a lint error. The store's server snapshot
   * is empty, so SSR and the first client render agree, and the default below
   * applies until the user has actually toggled something.
   */
  const decisions = useSyncExternalStore(subscribeNavGroups, getNavGroupSnapshot, getNavGroupServerSnapshot);

  const [query, setQuery] = useState('');
  // Folded, so whitespace-only is not a search — see lib/i18n/fold.ts for why
  // a raw `includes()` is the wrong test in Arabic.
  const searching = foldForSearch(query).length > 0;

  const shownGroups = searching
    ? visibleGroups
        .map((group) => ({
          labelKey: group.labelKey,
          items: group.items.filter((item) => foldedIncludes(t(item.labelKey), query)),
        }))
        .filter((group) => group.items.length > 0)
    : visibleGroups;

  const matchCount = shownGroups.reduce((n, g) => n + g.items.length, 0);

  function renderLink(item: NavItem) {
    const isActive = item.href === activeHref;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? 'page' : undefined}
        style={isActive ? navLinkActiveStyle : navLinkStyle}
      >
        {t(item.labelKey)}
      </Link>
    );
  }

  return (
    <nav aria-label={t('navPrimaryAria')} style={sidebarStyle}>
      <div style={navSearchWrapStyle}>
        <TextInput
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
          }}
          placeholder={t('navSearchPlaceholder')}
          aria-label={t('navSearchLabel')}
          style={navSearchInputStyle}
        />
        {searching ? (
          <div style={navSearchStatusStyle} aria-live="polite">
            {matchCount > 0 ? tPlural('navSearchMatches', matchCount) : t('navSearchNoResults')}
          </div>
        ) : null}
      </div>

      {renderLink(HOME)}

      {shownGroups.map((group) => (
        <details
          key={group.labelKey}
          /* A query overrides collapse entirely: a match is never hidden
             behind a closed group. Not an accordion — opening one group does
             not close another, because a manager genuinely works across
             Clients and Finance in one sitting. */
          open={searching || (decisions[group.labelKey] ?? group.labelKey === activeGroupKey)}
          onToggle={(e) => {
            // While searching, `open` is driven by the query, and the toggle
            // events that come from it are not user intent — recording them
            // would overwrite the user's real preferences with search state.
            if (!searching) setNavGroupOpen(group.labelKey, e.currentTarget.open);
          }}
        >
          <summary style={navGroupSummaryStyle}>{t(group.labelKey)}</summary>
          <div style={navGroupItemsStyle}>{group.items.map(renderLink)}</div>
        </details>
      ))}

      {/*
        Identity and sign-out moved to the navbar's profile menu, which now
        shows the same name plus the department and owns the sign-out. Leaving
        a second copy here would be the duplicate-brand-mark problem again,
        one row down.

        The Security link stays. It is the SELF-SERVICE MFA enrolment route,
        deliberately ungated because MfaRequiredGuard 403s every other screen
        until a user enrols — and it is now reachable two ways, which for the
        one route that can strand a user is a feature rather than a duplicate.
      */}
      <div style={sidebarFooterStyle}>{renderLink(SECURITY)}</div>
    </nav>
  );
}

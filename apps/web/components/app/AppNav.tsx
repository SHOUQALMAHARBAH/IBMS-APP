'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth/auth-context';
import { logout } from '../../lib/auth/auth-api';
import { hasAnyPermission } from '../../lib/auth/permissions';
import { useLanguage } from '../../lib/i18n/language-context';
import type { TranslationKey } from '../../lib/i18n/translations';
import {
  brandStyle,
  navGroupLabelStyle,
  navLinkActiveStyle,
  navLinkStyle,
  sidebarFooterStyle,
  sidebarStyle,
  signOutButtonStyle,
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
 */
type NavItem = {
  href: string;
  labelKey: TranslationKey;
  /** Holding ANY of these reveals the item. Omitted = always visible. */
  permissions?: readonly string[];
};

type NavGroup = { labelKey: TranslationKey; items: readonly NavItem[] };

const HOME: NavItem = { href: '/', labelKey: 'navHome' };

const NAV_GROUPS: readonly NavGroup[] = [
  {
    labelKey: 'navGroupSales',
    items: [
      { href: '/leads', labelKey: 'navLeads', permissions: ['lead.list.read'] },
      { href: '/prospects', labelKey: 'navProspects', permissions: ['prospect.read'] },
      { href: '/customers', labelKey: 'navCustomers', permissions: ['customer.360-view.read'] },
      { href: '/customers/kyc-queue', labelKey: 'navKycQueue', permissions: ['customer.360-view.read'] },
      { href: '/needs-assessments', labelKey: 'navNeedsAssessments', permissions: ['needs-assessment.read'] },
      { href: '/risk-profiles', labelKey: 'navRiskSurveys', permissions: ['risk-profile.read'] },
      { href: '/insurance-programs', labelKey: 'navInsurancePrograms', permissions: ['program.read'] },
      { href: '/opportunities', labelKey: 'navRfqMarket', permissions: ['opportunity.read'] },
      { href: '/policies', labelKey: 'navPolicies', permissions: ['policy.read'] },
      { href: '/cross-sell', labelKey: 'navCrossSell', permissions: ['cross-sell.read'] },
      { href: '/up-sell', labelKey: 'navUpSell', permissions: ['up-sell.read'] },
      { href: '/crm', labelKey: 'navCrm', permissions: ['customer.360-view.read'] },
      { href: '/renewal-cases', labelKey: 'navRenewalCases', permissions: ['renewal.read'] },
    ],
  },
  {
    labelKey: 'navGroupClaims',
    items: [{ href: '/claims-analytics', labelKey: 'navClaimsAnalytics', permissions: ['claims-analytics.view'] }],
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
    labelKey: 'navGroupInsights',
    items: [
      { href: '/kpi-dashboard', labelKey: 'navKpiDashboard', permissions: ['kpi-dashboard.view'] },
      {
        href: '/sales-performance',
        labelKey: 'navSalesPerformance',
        permissions: ['dashboard.sales.view', 'sales-target.manage'],
      },
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
      { href: '/insurer-performance', labelKey: 'navInsurerPerformance', permissions: ['insurer-performance.view'] },
      { href: '/employee-performance', labelKey: 'navEmployeePerformance', permissions: ['employee-performance.view'] },
      { href: '/portfolio-analysis', labelKey: 'navPortfolioAnalysis', permissions: ['portfolio-analysis.view'] },
      {
        href: '/profitability-analysis',
        labelKey: 'navProfitabilityAnalysis',
        permissions: ['profitability-analysis.view'],
      },
      { href: '/planning-export', labelKey: 'navPlanningExport', permissions: ['planning-export.generate'] },
    ],
  },
  {
    labelKey: 'navGroupOperations',
    items: [
      { href: '/employees', labelKey: 'navEmployees', permissions: ['employee.manage'] },
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
    ],
  },
];

/** Self-service account security. Never gated — see the note above. */
const SECURITY: NavItem = { href: '/settings/security', labelKey: 'navSecurity' };

function matches(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearUser } = useAuth();
  const { language, setLanguage, t } = useLanguage();

  const canSee = (item: NavItem) => !item.permissions || hasAnyPermission(user, item.permissions);

  const visibleGroups = NAV_GROUPS.map((group) => ({
    labelKey: group.labelKey,
    items: group.items.filter(canSee),
  })).filter((group) => group.items.length > 0);

  // Longest matching href wins, so /customers/kyc-queue highlights "KYC
  // queue" only — not "Customers" as well. Computed over the VISIBLE set so a
  // hidden item can never claim the active state.
  const activeHref = [HOME, ...visibleGroups.flatMap((g) => g.items), SECURITY]
    .filter((item) => matches(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  async function handleSignOut() {
    await logout();
    clearUser();
    router.push('/login');
  }

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
    <nav aria-label="Primary" style={sidebarStyle}>
      <Link href="/" style={brandStyle}>
        IBMS
      </Link>

      {renderLink(HOME)}

      {visibleGroups.map((group) => (
        <div key={group.labelKey}>
          <div style={navGroupLabelStyle}>{t(group.labelKey)}</div>
          {group.items.map(renderLink)}
        </div>
      ))}

      <div
        role="group"
        aria-label={t('language')}
        style={{ display: 'flex', gap: 'var(--space-2)', padding: '0 var(--space-2)', marginTop: 'var(--space-4)' }}
      >
        <button
          type="button"
          aria-pressed={language === 'AR'}
          onClick={() => setLanguage('AR')}
          style={language === 'AR' ? navLinkActiveStyle : navLinkStyle}
        >
          {t('switchToArabic')}
        </button>
        <button
          type="button"
          aria-pressed={language === 'EN'}
          onClick={() => setLanguage('EN')}
          style={language === 'EN' ? navLinkActiveStyle : navLinkStyle}
        >
          {t('switchToEnglish')}
        </button>
      </div>

      <div style={sidebarFooterStyle}>
        {renderLink(SECURITY)}
        <div style={{ marginTop: 'var(--space-3)' }}>
          {t('signedInAs')} {user?.fullName}
        </div>
        <div>{user && user.roles.length > 0 ? user.roles.join(', ') : t('noRoleAssigned')}</div>
        <button type="button" onClick={() => void handleSignOut()} style={signOutButtonStyle}>
          {t('signOut')}
        </button>
      </div>
    </nav>
  );
}

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth/auth-context';
import { logout } from '../../lib/auth/auth-api';
import { useLanguage } from '../../lib/i18n/language-context';
import type { TranslationKey } from '../../lib/i18n/translations';
import {
  brandStyle,
  navLinkActiveStyle,
  navLinkStyle,
  sidebarFooterStyle,
  sidebarStyle,
  signOutButtonStyle,
} from './app.styles';

// Every top-level screen that exists today. Ordered roughly by the Domain A
// process flow (lead -> prospect -> customer -> KYC), then cross-cutting
// admin. Links are NOT permission-gated here: each destination page already
// renders a friendly message when the API returns 403 for a missing
// permission (see e.g. leads/page.tsx's `lead.list.read` copy), so a
// nav-level grid would only duplicate — and drift from — the seeded grid.
//
// `labelKey` (not a literal string) so every item renders through `t()` —
// the highest-visibility translation target in the app, since this nav is
// on every authenticated screen.
const NAV_ITEMS: { href: string; labelKey: TranslationKey }[] = [
  { href: '/', labelKey: 'navHome' },
  { href: '/leads', labelKey: 'navLeads' },
  { href: '/prospects', labelKey: 'navProspects' },
  { href: '/customers', labelKey: 'navCustomers' },
  { href: '/customers/kyc-queue', labelKey: 'navKycQueue' },
  { href: '/needs-assessments', labelKey: 'navNeedsAssessments' },
  { href: '/risk-profiles', labelKey: 'navRiskSurveys' },
  { href: '/insurance-programs', labelKey: 'navInsurancePrograms' },
  { href: '/cross-sell', labelKey: 'navCrossSell' },
  { href: '/up-sell', labelKey: 'navUpSell' },
  { href: '/crm', labelKey: 'navCrm' },
  { href: '/opportunities', labelKey: 'navRfqMarket' },
  { href: '/renewal-cases', labelKey: 'navRenewalCases' },
  { href: '/claims-analytics', labelKey: 'navClaimsAnalytics' },
  { href: '/client-accounting', labelKey: 'navClientAccounting' },
  { href: '/insurer-accounting', labelKey: 'navInsurerAccounting' },
  { href: '/commission', labelKey: 'navCommissionRates' },
  { href: '/payment-channels', labelKey: 'navPaymentChannels' },
  { href: '/bank-reconciliation', labelKey: 'navBankReconciliation' },
  { href: '/financial-report', labelKey: 'navFinancialReport' },
  { href: '/service-requests', labelKey: 'navCustomerRequests' },
  { href: '/complaints', labelKey: 'navComplaints' },
  { href: '/communications', labelKey: 'navCommunications' },
  { href: '/feedback', labelKey: 'navFeedback' },
  { href: '/retention-cases', labelKey: 'navRetention' },
  { href: '/sla-dashboard', labelKey: 'navSlaDashboard' },
  { href: '/consent', labelKey: 'navConsent' },
  { href: '/dsr', labelKey: 'navDsr' },
  { href: '/retention-disposal', labelKey: 'navRetentionDisposal' },
  { href: '/cross-border-transfers', labelKey: 'navCrossBorderTransfer' },
  { href: '/data-sharing-approvals', labelKey: 'navDataSharing' },
  { href: '/dpia-screenings', labelKey: 'navDpiaScreening' },
  { href: '/privacy-notices', labelKey: 'navNotices' },
  { href: '/ropa-entries', labelKey: 'navRopa' },
  { href: '/dpo-workspace', labelKey: 'navDpoWorkspace' },
  { href: '/transaction-monitoring', labelKey: 'navAmlMonitoring' },
  { href: '/watchlist-sync', labelKey: 'navWatchlistSync' },
  { href: '/screening-matches', labelKey: 'navScreeningMatches' },
  { href: '/regulatory-compliance', labelKey: 'navRegulatoryCompliance' },
  { href: '/operational-pi-risk', labelKey: 'navOperationalPiRisk' },
  { href: '/incidents', labelKey: 'navIncidentManagement' },
  { href: '/internal-controls', labelKey: 'navInternalControls' },
  { href: '/internal-audit-findings', labelKey: 'navInternalAuditFindings' },
  { href: '/sla-policies', labelKey: 'navSlaPolicies' },
  { href: '/audit-trail', labelKey: 'navAuditTrail' },
  { href: '/kpi-dashboard', labelKey: 'navKpiDashboard' },
  { href: '/sales-performance', labelKey: 'navSalesPerformance' },
  { href: '/dashboards/sales', labelKey: 'navSalesDashboard' },
  { href: '/dashboards/policy', labelKey: 'navPolicyDashboard' },
  { href: '/dashboards/claims', labelKey: 'navClaimsDashboard' },
  { href: '/dashboards/financial', labelKey: 'navFinancialDashboard' },
  { href: '/dashboards/compliance', labelKey: 'navComplianceDashboard' },
  { href: '/dashboards/insurer-employee-performance', labelKey: 'navInsurerEmployeePerformanceDashboard' },
  { href: '/dashboards/executive', labelKey: 'navExecutiveDashboard' },
  { href: '/insurer-performance', labelKey: 'navInsurerPerformance' },
  { href: '/employee-performance', labelKey: 'navEmployeePerformance' },
  { href: '/portfolio-analysis', labelKey: 'navPortfolioAnalysis' },
  { href: '/profitability-analysis', labelKey: 'navProfitabilityAnalysis' },
  { href: '/planning-export', labelKey: 'navPlanningExport' },
  { href: '/employees', labelKey: 'navEmployees' },
  { href: '/vendors', labelKey: 'navVendors' },
  { href: '/information-assets', labelKey: 'navInformationAssets' },
  { href: '/documents', labelKey: 'navDocuments' },
  { href: '/bcp-dr-plans', labelKey: 'navBcpDrPlans' },
  { href: '/knowledge-base', labelKey: 'navKnowledgeBase' },
  { href: '/access-recertification', labelKey: 'navAccessRecertification' },
  { href: '/settings/users', labelKey: 'navUserAdmin' },
  { href: '/settings/security', labelKey: 'navSecurity' },
];

function matches(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearUser } = useAuth();
  const { language, setLanguage, t } = useLanguage();

  // Longest matching href wins, so /customers/kyc-queue highlights "KYC
  // queue" only — not "Customers" as well.
  const activeHref = NAV_ITEMS.filter((item) => matches(pathname, item.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0]?.href;

  async function handleSignOut() {
    await logout();
    clearUser();
    router.push('/login');
  }

  return (
    <nav aria-label="Primary" style={sidebarStyle}>
      <Link href="/" style={brandStyle}>
        IBMS
      </Link>

      {NAV_ITEMS.map((item) => {
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
      })}

      <div
        role="group"
        aria-label={t('language')}
        style={{ display: 'flex', gap: '0.4rem', padding: '0 0.75rem', marginTop: '0.5rem' }}
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
        <div>
          {t('signedInAs')} {user?.fullName}
        </div>
        <div style={{ opacity: 0.8 }}>
          {user && user.roles.length > 0 ? user.roles.join(', ') : t('noRoleAssigned')}
        </div>
        <button type="button" onClick={() => void handleSignOut()} style={signOutButtonStyle}>
          {t('signOut')}
        </button>
      </div>
    </nav>
  );
}

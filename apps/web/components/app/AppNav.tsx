'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth/auth-context';
import { logout } from '../../lib/auth/auth-api';
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
const NAV_ITEMS: { href: string; label: string }[] = [
  { href: '/', label: 'Home' },
  { href: '/leads', label: 'Leads' },
  { href: '/prospects', label: 'Prospects' },
  { href: '/customers', label: 'Customers' },
  { href: '/customers/kyc-queue', label: 'KYC queue' },
  { href: '/needs-assessments', label: 'Needs assessments' },
  { href: '/risk-profiles', label: 'Risk surveys' },
  { href: '/insurance-programs', label: 'Insurance programs' },
  { href: '/cross-sell', label: 'Cross-sell' },
  { href: '/up-sell', label: 'Up-sell' },
  { href: '/crm', label: 'Relationship (CRM)' },
  { href: '/opportunities', label: 'RFQ / market' },
  { href: '/claims-analytics', label: 'Claims analytics' },
  { href: '/client-accounting', label: 'Client accounting' },
  { href: '/insurer-accounting', label: 'Insurer accounting' },
  { href: '/access-recertification', label: 'Access recertification' },
  { href: '/settings/security', label: 'Security' },
];

function matches(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearUser } = useAuth();

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
            {item.label}
          </Link>
        );
      })}

      <div style={sidebarFooterStyle}>
        <div>{user?.fullName}</div>
        <div style={{ opacity: 0.8 }}>
          {user && user.roles.length > 0 ? user.roles.join(', ') : 'No role assigned'}
        </div>
        <button type="button" onClick={() => void handleSignOut()} style={signOutButtonStyle}>
          Sign out
        </button>
      </div>
    </nav>
  );
}

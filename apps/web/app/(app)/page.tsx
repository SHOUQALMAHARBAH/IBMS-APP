'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth/auth-context';
import { pageStyle } from '../../components/lead/lead.styles';
import { homeCardBlurbStyle, homeCardStyle, homeGridStyle } from '../../components/app/app.styles';

const MODULES: { href: string; title: string; blurb: string }[] = [
  {
    href: '/leads',
    title: 'Leads',
    blurb: 'Capture a lead from any acquisition source and move it through the pipeline.',
  },
  {
    href: '/prospects',
    title: 'Prospects',
    blurb: 'Qualify a converted lead and record its business profile.',
  },
  {
    href: '/customers',
    title: 'Customers',
    blurb: 'Onboard individual and corporate customers, capture UBOs, and run KYC screening.',
  },
  {
    href: '/customers/kyc-queue',
    title: 'KYC compliance queue',
    blurb: 'Review and approve pending KYC records before a customer is activated.',
  },
  {
    href: '/access-recertification',
    title: 'Access recertification',
    blurb: 'Run and complete the periodic access-review cycle.',
  },
  {
    href: '/settings/security',
    title: 'Security',
    blurb: 'Manage multi-factor authentication and review your session policy.',
  },
];

export default function HomePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Welcome, {user.fullName}</h1>
      <p style={{ opacity: 0.8 }}>
        Insurance Brokerage Management System. Signed in as{' '}
        {user.roles.length > 0 ? user.roles.join(', ') : 'no role assigned'}.
      </p>

      <div style={homeGridStyle}>
        {MODULES.map((m) => (
          <Link key={m.href} href={m.href} style={homeCardStyle}>
            <strong>{m.title}</strong>
            <span style={homeCardBlurbStyle}>{m.blurb}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}

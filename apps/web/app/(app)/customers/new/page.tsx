'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { CustomerOnboardingWizard } from '../../../../components/customer/CustomerOnboardingWizard';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';

const CAN_CREATE_CUSTOMER_ROLES = ['SALES_RELATIONSHIP_OFFICER'];

export default function NewCustomerPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  const canCreateCustomer = user.roles.some((role) => CAN_CREATE_CUSTOMER_ROLES.includes(role));

  return (
    <main style={pageStyle}>
      <h1>{t('customerNewHeading')}</h1>
      <p style={{ opacity: 0.8 }}>{t('customerNewIntro')}</p>
      {canCreateCustomer ? (
        <CustomerOnboardingWizard />
      ) : (
        <p role="alert" style={errorStyle}>
          {t('customerNewNoPermission')}
        </p>
      )}
    </main>
  );
}

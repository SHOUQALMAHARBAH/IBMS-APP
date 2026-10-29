'use client';

import { useEffect } from 'react';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { CustomerOnboardingWizard } from '../../../../components/customer/CustomerOnboardingWizard';
import {
  PageHeader,
} from '../../../../components/ui';
import { pageStackStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { hasPermission } from '../../../../lib/auth/permissions';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';


export default function NewCustomerPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  if (isLoading || !user) return null;

  const canCreateCustomer = hasPermission(user, 'customer.create');

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('customerNewHeading')}
        description={t('customerNewIntro')}
      />
      {canCreateCustomer ? (
        <CustomerOnboardingWizard />
      ) : (
        <p role="alert" style={errorStyle}>
          {permissionRefusal(t, 'customerNewRefusalAct', 'customer.create')}
        </p>
      )}
    </main>
  );
}

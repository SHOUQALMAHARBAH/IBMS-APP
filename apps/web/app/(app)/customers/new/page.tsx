'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { CustomerOnboardingWizard } from '../../../../components/customer/CustomerOnboardingWizard';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';

const CAN_CREATE_CUSTOMER_ROLES = ['SALES_RELATIONSHIP_OFFICER'];

export default function NewCustomerPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  const canCreateCustomer = user.roles.some((role) => CAN_CREATE_CUSTOMER_ROLES.includes(role));

  return (
    <main style={pageStyle}>
      <h1>Onboard a customer</h1>
      <p style={{ opacity: 0.8 }}>
        Process 3-4 — a step-by-step KYC wizard: customer type, profile, beneficial owners (if
        corporate), supporting documents, then submission to Compliance for screening and
        approval.
      </p>
      {canCreateCustomer ? (
        <CustomerOnboardingWizard />
      ) : (
        <p role="alert" style={errorStyle}>
          You don&apos;t hold the customer.create permission, so there&apos;s nothing to do here.
        </p>
      )}
    </main>
  );
}

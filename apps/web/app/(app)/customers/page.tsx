'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { listCustomers, type Customer } from '../../../lib/customer/customer-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { cardMetaStyle, cardStyle, pageStyle } from '../../../components/lead/lead.styles';
import { listGridStyle } from '../../../components/prospect/prospect.styles';

// Roles the seeded permission grid grants `customer.create` to
// (packages/db/prisma/seed-data/permissions.ts) — a client-side hint only,
// same convention as leads/page.tsx's CAN_CREATE_LEAD_ROLES.
const CAN_CREATE_CUSTOMER_ROLES = ['SALES_RELATIONSHIP_OFFICER'];

export default function CustomersPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadCustomers = useCallback(async () => {
    try {
      const result = await listCustomers();
      setCustomers(result);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the customer.360-view.read permission, so there's nothing to show here."
          : err instanceof ApiError
            ? err.message
            : 'Could not load customers — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadCustomers();
    })();
  }, [user, loadCustomers]);

  if (isLoading || !user) return null;

  const canCreateCustomer = user.roles.some((role) => CAN_CREATE_CUSTOMER_ROLES.includes(role));

  return (
    <main style={pageStyle}>
      <h1>Customers</h1>
      <p style={{ opacity: 0.8 }}>
        Process 3-4 — customer acquisition and onboarding (individual and corporate), KYC, and
        beneficial ownership.
      </p>

      {canCreateCustomer ? (
        <button type="button" onClick={() => router.push('/customers/new')} style={{ cursor: 'pointer' }}>
          + Onboard a new customer
        </button>
      ) : null}

      {customers === null && !loadError ? <p>Loading…</p> : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}
      {customers !== null && !loadError ? (
        customers.length === 0 ? (
          <p style={{ opacity: 0.6, marginTop: '1rem' }}>No customers yet.</p>
        ) : (
          <div style={listGridStyle}>
            {customers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                style={{ ...cardStyle, textAlign: 'left', width: '100%', cursor: 'pointer' }}
                aria-label={`View profile — ${customer.legalName}`}
                onClick={() => router.push(`/customers/${customer.id}`)}
              >
                <strong>{customer.legalName}</strong>
                <div style={cardMetaStyle}>{customer.customerType}</div>
                <div style={cardMetaStyle}>Status: {customer.status}</div>
              </button>
            ))}
          </div>
        )
      ) : null}
    </main>
  );
}

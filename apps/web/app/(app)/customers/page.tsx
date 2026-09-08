'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
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
  // Part F item #6 — bilingual full-text search (Arabic + English) over
  // legalName. `search` is the input's live value; `searchTerm` is what was
  // actually submitted and drives the fetch — a submit-triggered search,
  // not search-as-you-type (this app has no debounce utility anywhere).
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const loadCustomers = useCallback(async (term: string) => {
    try {
      const result = await listCustomers(term ? { search: term } : {});
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

  function onSearchSubmit(e: FormEvent) {
    e.preventDefault();
    setSearchTerm(search);
  }

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadCustomers(searchTerm);
    })();
  }, [user, searchTerm, loadCustomers]);

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

      <form onSubmit={onSearchSubmit} style={{ margin: '0.75rem 0' }}>
        <label htmlFor="customer-search" style={{ marginInlineEnd: '0.5rem' }}>
          Search
        </label>
        <input
          id="customer-search"
          dir="auto"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, in Arabic or English"
        />
        <button type="submit" style={{ marginInlineStart: '0.5rem', cursor: 'pointer' }}>
          Search
        </button>
      </form>

      {customers === null && !loadError ? <p>Loading…</p> : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}
      {customers !== null && !loadError ? (
        customers.length === 0 ? (
          <p style={{ opacity: 0.6, marginTop: '1rem' }}>
            {searchTerm ? 'No customers match your search.' : 'No customers yet.'}
          </p>
        ) : (
          <div style={listGridStyle}>
            {customers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                style={{ ...cardStyle, textAlign: 'start', width: '100%', cursor: 'pointer' }}
                aria-label={`View profile — ${customer.legalName}`}
                onClick={() => router.push(`/customers/${customer.id}`)}
              >
                <strong>
                  <bdi>{customer.legalName}</bdi>
                </strong>
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

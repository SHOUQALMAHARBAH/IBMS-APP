'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { listCustomers, type Customer } from '../../../lib/customer/customer-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { cardMetaStyle, cardStyle, pageStyle } from '../../../components/lead/lead.styles';
import { listGridStyle } from '../../../components/prospect/prospect.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../lib/i18n/translations';
import type { CustomerStatus, CustomerType } from '../../../lib/customer/customer-api';

const TYPE_LABEL_KEY: Record<CustomerType, TranslationKey> = {
  INDIVIDUAL: 'customerTypeIndividual',
  CORPORATE: 'customerTypeCorporate',
};

const STATUS_LABEL_KEY: Record<CustomerStatus, TranslationKey> = {
  PENDING_KYC: 'customerStatusPendingKyc',
  ACTIVE: 'customerStatusActive',
  SUSPENDED: 'customerStatusSuspended',
  CLOSED: 'customerStatusClosed',
};

// Roles the seeded permission grid grants `customer.create` to
// (packages/db/prisma/seed-data/permissions.ts) — a client-side hint only,
// same convention as leads/page.tsx's CAN_CREATE_LEAD_ROLES.
const CAN_CREATE_CUSTOMER_ROLES = ['SALES_RELATIONSHIP_OFFICER'];

export default function CustomersPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

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
          ? t('customersNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('commonTryAgain'),
      );
    }
  }, [t]);

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
      <h1>{t('customersHeading')}</h1>
      <p style={{ opacity: 0.8 }}>{t('customersProcessIntro')}</p>

      {canCreateCustomer ? (
        <button type="button" onClick={() => router.push('/customers/new')} style={{ cursor: 'pointer' }}>
          {t('customersOnboardButton')}
        </button>
      ) : null}

      <form onSubmit={onSearchSubmit} style={{ margin: '0.75rem 0' }}>
        <label htmlFor="customer-search" style={{ marginInlineEnd: '0.5rem' }}>
          {t('customersSearchLabel')}
        </label>
        <input
          id="customer-search"
          dir="auto"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('commonSearchPlaceholder')}
        />
        <button type="submit" style={{ marginInlineStart: '0.5rem', cursor: 'pointer' }}>
          {t('customersSearchLabel')}
        </button>
      </form>

      {customers === null && !loadError ? <p>{t('commonLoading')}</p> : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}
      {customers !== null && !loadError ? (
        customers.length === 0 ? (
          <p style={{ opacity: 0.6, marginTop: '1rem' }}>
            {searchTerm ? t('customersNoneMatch') : t('customersNoneYet')}
          </p>
        ) : (
          <div style={listGridStyle}>
            {customers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                style={{ ...cardStyle, textAlign: 'start', width: '100%', cursor: 'pointer' }}
                aria-label={t('customersViewProfileAria', { name: customer.legalName })}
                onClick={() => router.push(`/customers/${customer.id}`)}
              >
                <strong>
                  <bdi>{customer.legalName}</bdi>
                </strong>
                <div style={cardMetaStyle}>{t(TYPE_LABEL_KEY[customer.customerType])}</div>
                <div style={cardMetaStyle}>
                  {t('customerStatusLabel', { status: t(STATUS_LABEL_KEY[customer.status]) })}
                </div>
              </button>
            ))}
          </div>
        )
      ) : null}
    </main>
  );
}

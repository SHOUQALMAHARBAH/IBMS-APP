'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { ApiError } from '../../../lib/auth/api-client';
import {
  listPolicies,
  type Policy,
  type PolicyStatus,
} from '../../../lib/policy/policy-api';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { cardMetaStyle, cardStyle, pageStyle } from '../../../components/lead/lead.styles';
import { listGridStyle } from '../../../components/prospect/prospect.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import {
  POLICY_STATUS_LABEL_KEY,
  POLICY_STATUS_OPTIONS,
} from '../../../lib/policy/policy-status';

/**
 * The book-wide policy list.
 *
 * This screen exists because a Policy Checking Officer had nowhere to land:
 * the role holds `policy.read`/`policy.check` and its whole job is Process 20
 * QC, but every route to a policy went through a customer or an opportunity,
 * so it could only reach a policy whose id someone had already given it.
 *
 * Deliberately the same shape as `customers/page.tsx` — submit-triggered
 * search (this app has no debounce utility), the same four states in the same
 * order, the same card grid. A user who has learned one list screen here has
 * learned this one.
 */

/** Mirrors POLICY_LIST_TAKE in apps/api/src/repositories/policy.repository.ts.
 * Only used to tell the reader the list was capped — the server is the one
 * that enforces it. */
const POLICY_LIST_TAKE = 200;

export default function PoliciesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [status, setStatus] = useState<PolicyStatus | ''>('');

  const loadPolicies = useCallback(
    async (term: string, statusFilter: PolicyStatus | '') => {
      try {
        const result = await listPolicies({
          ...(term ? { search: term } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
        });
        setPolicies(result);
        setLoadError(null);
      } catch (err) {
        setPolicies(null);
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? t('policiesNoPermission')
            : err instanceof ApiError
              ? err.message
              : t('policiesLoadError'),
        );
      }
    },
    [t],
  );

  function onSearchSubmit(e: FormEvent) {
    e.preventDefault();
    setSearchTerm(search);
  }

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadPolicies(searchTerm, status);
    })();
  }, [user, searchTerm, status, loadPolicies, t]);

  if (isLoading || !user) return null;

  const isFiltered = Boolean(searchTerm || status);

  return (
    <main style={pageStyle}>
      <h1>{t('policiesListHeading')}</h1>
      <p style={{ color: 'var(--ink-secondary)' }}>{t('policiesListIntro')}</p>

      <form
        onSubmit={onSearchSubmit}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
          alignItems: 'flex-end',
          margin: 'var(--space-4) 0',
        }}
      >
        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <label htmlFor="policy-search">{t('policiesSearchLabel')}</label>
          <input
            id="policy-search"
            dir="auto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('policiesSearchPlaceholder')}
          />
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <label htmlFor="policy-status">{t('policiesStatusFilterLabel')}</label>
          <select
            id="policy-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as PolicyStatus | '')}
          >
            <option value="">{t('policiesStatusAll')}</option>
            {POLICY_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(POLICY_STATUS_LABEL_KEY[s])}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" style={{ cursor: 'pointer' }}>
          {t('policiesSearchLabel')}
        </button>
      </form>

      {/* The four states, in the order every other list screen uses. */}
      {policies === null && !loadError ? <p>{t('policyCommonLoading')}</p> : null}

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {policies !== null && !loadError ? (
        policies.length === 0 ? (
          <p style={{ color: 'var(--ink-muted)', marginTop: 'var(--space-4)' }}>
            {isFiltered ? t('policiesNoneMatch') : t('policiesNoneYet')}
          </p>
        ) : (
          <>
            <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)' }}>
              {policies.length >= POLICY_LIST_TAKE
                ? t('policiesCapNotice', { count: POLICY_LIST_TAKE })
                : t('policiesCountLabel', { count: policies.length })}
            </p>
            <div style={listGridStyle}>
              {policies.map((policy) => {
                const label = policy.policyNumber ?? t('policiesNoNumberYet');
                return (
                  <button
                    key={policy.id}
                    type="button"
                    style={{
                      ...cardStyle,
                      textAlign: 'start',
                      width: '100%',
                      cursor: 'pointer',
                    }}
                    aria-label={t('policiesViewAria', { name: label })}
                    onClick={() => router.push(`/policies/${policy.id}`)}
                  >
                    <strong>
                      <bdi>{label}</bdi>
                    </strong>
                    <div style={cardMetaStyle}>
                      {t('policiesCustomerLabel')}:{' '}
                      <bdi>{policy.customer?.legalName ?? '—'}</bdi>
                    </div>
                    <div style={cardMetaStyle}>
                      {t('policiesLineLabel')}: <bdi>{policy.insuranceLine}</bdi>
                    </div>
                    <div style={cardMetaStyle}>
                      {t('policyStatusLabel')}: {t(POLICY_STATUS_LABEL_KEY[policy.status])}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )
      ) : null}
    </main>
  );
}

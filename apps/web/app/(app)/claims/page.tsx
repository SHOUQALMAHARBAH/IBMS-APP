'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { ApiError } from '../../../lib/auth/api-client';
import { Pagination } from '../../../components/ui/Pagination';
import {
  listClaims,
  type Claim,
  type ClaimStatus,
} from '../../../lib/claim/claim-api';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import {
  cardMetaStyle,
  cardStyle,
  pageStyle,
} from '../../../components/lead/lead.styles';
import { listGridStyle } from '../../../components/prospect/prospect.styles';
import { rfqBadgeStyle } from '../../../components/rfq/rfq.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { formatDate, formatMoney } from '../../../lib/i18n/format';

/**
 * The claims queue.
 *
 * This screen exists because a Claims Officer had nowhere to land. The role
 * holds `claim.read`/`claim.register`/`claim.assess`/`claim.settle.approve`
 * and its entire job is this book, but every route to a claim went through
 * `/opportunities/[id]` — a screen behind `opportunity.read`, which the role
 * does not hold. The API accepted them; no screen offered it. Exactly the
 * Policy Checking Officer gap, and fixed the same way: give the role its own
 * screen rather than widen the role.
 *
 * Deliberately the same shape as `policies/page.tsx` — submit-triggered search
 * (this app has no debounce utility), the same four states in the same order,
 * the same card grid. A user who has learned one list screen here has learned
 * this one.
 *
 * It is a QUEUE, not an index: every row carries the state the desk triages on
 * (status, an unresolved insurer follow-up alert, incomplete documentation), so
 * the screen answers "what needs me next" rather than only linking onward.
 */

const CLAIM_STATUS_OPTIONS: readonly ClaimStatus[] = [
  'NOTIFIED',
  'REGISTERED',
  'DOCUMENTATION_IN_PROGRESS',
  'UNDER_ASSESSMENT',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'DECLINED',
  'SETTLED',
  'CLOSED',
] as const;

export default function ClaimsQueuePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language, t } = useLanguage();

  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [status, setStatus] = useState<ClaimStatus | ''>('');
  const [alertOnly, setAlertOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(0);

  const loadClaims = useCallback(
    async (
      term: string,
      statusFilter: ClaimStatus | '',
      onlyAlerting: boolean,
      nextPage = 0,
    ) => {
      try {
        const result = await listClaims({
          ...(term ? { search: term } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(onlyAlerting ? { alertOpen: true } : {}),
          ...(nextPage ? { page: nextPage } : {}),
        });
        setClaims(result.items);
        setTotal(result.total);
        // The server's size, not a constant repeated here: it clamps what was
        // asked for, so this is the only honest source for the range label.
        setPageSize(result.pageSize);
        setPage(result.page);
        setLoadError(null);
      } catch (err) {
        setClaims(null);
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? t('claimsQueueNoPermission')
            : err instanceof ApiError
              ? err.message
              : t('claimsQueueLoadError'),
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
      await loadClaims(searchTerm, status, alertOnly);
    })();
  }, [user, searchTerm, status, alertOnly, loadClaims, t]);

  if (isLoading || !user) return null;

  const isFiltered = Boolean(searchTerm || status || alertOnly);

  return (
    <main style={pageStyle}>
      <h1>{t('claimsQueueHeading')}</h1>
      <p style={{ color: 'var(--ink-secondary)' }}>{t('claimsQueueIntro')}</p>

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
          <label htmlFor="claim-search">{t('claimsQueueSearchLabel')}</label>
          <input
            id="claim-search"
            dir="auto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('claimsQueueSearchPlaceholder')}
          />
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <label htmlFor="claim-status">
            {t('claimsQueueStatusFilterLabel')}
          </label>
          <select
            id="claim-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ClaimStatus | '')}
          >
            <option value="">{t('claimsQueueStatusAll')}</option>
            {CLAIM_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(ENUM_LABEL.ClaimStatus[s])}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <label htmlFor="claim-alert-only">
            <input
              id="claim-alert-only"
              type="checkbox"
              checked={alertOnly}
              onChange={(e) => setAlertOnly(e.target.checked)}
            />{' '}
            {t('claimsQueueAlertOnlyLabel')}
          </label>
          <span
            style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)' }}
          >
            {t('claimsQueueAlertOnlyHint')}
          </span>
        </div>

        <button type="submit" style={{ cursor: 'pointer' }}>
          {t('claimsQueueSearchLabel')}
        </button>
      </form>

      {/* The four states, in the order every other list screen uses. */}
      {claims === null && !loadError ? <p>{t('commonLoading')}</p> : null}

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {claims !== null && !loadError ? (
        claims.length === 0 ? (
          <p style={{ color: 'var(--ink-muted)', marginTop: 'var(--space-4)' }}>
            {isFiltered ? t('claimsQueueNoneMatch') : t('claimsQueueNoneYet')}
          </p>
        ) : (
          <>
            <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)' }}>
              {t('claimsQueueCountLabel', { count: total })}
            </p>
            <div style={listGridStyle}>
              {claims.map((claim) => {
                const label =
                  claim.claimNumber ??
                  claim.insurerClaimReference ??
                  t('claimsQueueNoNumberYet');
                return (
                  <button
                    key={claim.id}
                    type="button"
                    style={{
                      ...cardStyle,
                      textAlign: 'start',
                      width: '100%',
                      cursor: 'pointer',
                    }}
                    aria-label={t('claimsQueueViewAria', { name: label })}
                    onClick={() => router.push(`/claims/${claim.id}`)}
                  >
                    <strong>
                      <bdi>{label}</bdi>
                    </strong>
                    <div style={cardMetaStyle}>
                      {t('claimsQueuePolicyLabel')}:{' '}
                      <bdi>{claim.policyNumber ?? '—'}</bdi>
                    </div>
                    <div style={cardMetaStyle}>
                      {t('claimsQueueLossDateLabel')}:{' '}
                      {formatDate(claim.lossDate, language)}
                    </div>
                    <div style={cardMetaStyle}>
                      {t('claimsQueueEstimatedLabel')}:{' '}
                      {formatMoney(claim.estimatedLoss, language)}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 'var(--space-1)',
                        marginTop: 'var(--space-2)',
                      }}
                    >
                      {/* `data-*` carries the CODE, the cell carries the
                          label — machine hooks must not be translated. */}
                      <span
                        style={rfqBadgeStyle}
                        data-claim-status={claim.status}
                      >
                        {t(ENUM_LABEL.ClaimStatus[claim.status])}
                      </span>
                      {/* The two triage signals the desk works from. */}
                      {claim.followUp.followUpAlertOpen ? (
                        <span style={rfqBadgeStyle} data-claim-alert="open">
                          {t('claimsQueueAlertBadge')}
                        </span>
                      ) : null}
                      {!claim.documentationComplete ? (
                        <span style={rfqBadgeStyle} data-claim-docs="incomplete">
                          {t('claimsQueueDocsIncompleteBadge')}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )
      ) : null}
      {/* Every filter travels with the page, so paging never silently widens
          the result set the reader is looking at. */}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(next) =>
          void loadClaims(searchTerm, status, alertOnly, next)
        }
      />
    </main>
  );
}

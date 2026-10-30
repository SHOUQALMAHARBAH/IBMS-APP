'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { ApiError } from '../../../lib/auth/api-client';
import { Pagination } from '../../../components/ui/Pagination';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  Icon,
  PageHeader,
  Select,
  SkeletonList,
  TextInput,
} from '../../../components/ui';
import {
  listClaims,
  type Claim,
  type ClaimStatus,
} from '../../../lib/claim/claim-api';
import {
  cardMetaStyle,
  cardStyle,
  pageStackStyle,
} from '../../../components/lead/lead.styles';
import { listGridStyle } from '../../../components/prospect/prospect.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { formatDate, formatMoney } from '../../../lib/i18n/format';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

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
 *
 * DESIGN PASS — NOTHING ABOUT WHAT IT DOES CHANGED. The filters, the submit-triggered search, the
 * pagination that carries every filter with it, and the refusal branch are byte-for-byte the same
 * decisions. What changed is that the four states are now the product's own four components
 * instead of three bare paragraphs, and that the two TRIAGE SIGNALS are told apart by COLOUR as
 * well as by text.
 *
 * THAT LAST ONE IS THE ONLY REAL DESIGN DECISION HERE, and it is a reading of the screen's own
 * purpose rather than decoration: all three badges rendered in the identical grey pill, so the
 * state a desk is merely INFORMED of (the claim's status) looked exactly like the two it must ACT
 * on (an unanswered insurer follow-up, and documentation that is not complete). This screen exists
 * to answer *what needs me next*; a queue whose urgent rows look like its calm ones answers that
 * question no better than a list. Status stays neutral, the two signals take `warning`, and both
 * keep their words — a colour is never the only carrier.
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
            ? permissionRefusal(t, 'claimsQueueRefusalAct', 'claim.read')
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
    <main style={pageStackStyle}>
      <PageHeader
        title={t('claimsQueueHeading')}
        description={t('claimsQueueIntro')}
      />

      {/* THE FILTER STRIP IS A CONTROL SURFACE, not part of the list. It sits on the sunken
          surface inside its own card so a reader can see at a glance where the thing they type
          into ends and the thing they read begins — which on a queue is the difference between
          "these are all the claims" and "these are the claims I asked for". */}
      <Card padded={false}>
        <form onSubmit={onSearchSubmit}>
          <FilterBar
            actions={
              <Button type="submit">
                <Icon name="search" size={14} />
                {t('claimsQueueSearchLabel')}
              </Button>
            }
          >
            <Field label={t('claimsQueueSearchLabel')} style={{ minWidth: '15rem' }}>
              {(props) => (
                <TextInput
                  {...props}
                  dir="auto"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('claimsQueueSearchPlaceholder')}
                />
              )}
            </Field>

            <Field label={t('claimsQueueStatusFilterLabel')}>
              {(props) => (
                <Select
                  {...props}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ClaimStatus | '')}
                >
                  <option value="">{t('claimsQueueStatusAll')}</option>
                  {CLAIM_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {t(ENUM_LABEL.ClaimStatus[s])}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {/* THE CHECKBOX KEEPS ITS OWN `<label>` WRAPPER rather than going through `Field`.
                `Field` renders the label ABOVE its control, which is right for a text box and
                wrong for a tick box — the word belongs beside the box it toggles, and the whole
                phrase has to be the click target. */}
            <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
              <label
                htmlFor="claim-alert-only"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  cursor: 'pointer',
                  minHeight: '2.25rem',
                }}
              >
                <input
                  id="claim-alert-only"
                  type="checkbox"
                  checked={alertOnly}
                  onChange={(e) => setAlertOnly(e.target.checked)}
                />
                {t('claimsQueueAlertOnlyLabel')}
              </label>
              <span
                style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-xs)' }}
              >
                {t('claimsQueueAlertOnlyHint')}
              </span>
            </div>
          </FilterBar>
        </form>
      </Card>

      {/* The four states, in the order every other list screen uses. */}
      {claims === null && !loadError ? <SkeletonList rows={4} label={t('commonLoading')} /> : null}

      {/* THE SERVER'S OWN SENTENCE IS THE TITLE — decision 90, and the convention the three
          pilot screens already set. A generic heading above it would add a word that says less
          than the sentence under it, and the refusal branch above has already chosen between a
          permission refusal, the api's own message and a fallback. */}
      {loadError ? <ErrorState title={loadError} /> : null}

      {claims !== null && !loadError ? (
        claims.length === 0 ? (
          /* TWO EMPTY STATES, because they are two different facts: a filter that matched
             nothing is the reader's own doing and is fixed by widening it, while an empty book
             is a statement about the office. Collapsing them would tell somebody who typed a
             misspelled name that their office has no claims. */
          <EmptyState
            title={isFiltered ? t('claimsQueueNoneMatch') : t('claimsQueueNoneYet')}
          />
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
                      <Badge tone="neutral" data-claim-status={claim.status}>
                        {t(ENUM_LABEL.ClaimStatus[claim.status])}
                      </Badge>
                      {/* THE TWO TRIAGE SIGNALS, and they are `warning` where the status above
                          is neutral. A desk is INFORMED of a claim's status and must ACT on these
                          two; rendering all three in one grey pill made the whole row read as
                          flat information, which is the opposite of what a queue is for.
                          Both keep their words — the colour is a second carrier, never the only
                          one, because a reader who cannot distinguish the two tones still reads
                          *follow-up* and *documentation incomplete*. */}
                      {claim.followUp.followUpAlertOpen ? (
                        <Badge tone="warning" data-claim-alert="open">
                          <Icon name="clock" size={11} />
                          {t('claimsQueueAlertBadge')}
                        </Badge>
                      ) : null}
                      {!claim.documentationComplete ? (
                        <Badge tone="warning" data-claim-docs="incomplete">
                          <Icon name="file" size={11} />
                          {t('claimsQueueDocsIncompleteBadge')}
                        </Badge>
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

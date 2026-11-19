'use client';

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  listAllOpportunities,
  listOpportunities,
  type OpportunityListRow,
  type OpportunityStatus,
} from '../../../lib/opportunity/opportunity-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  ErrorState,
  PageHeader,
  SkeletonList,
} from '../../../components/ui';
import { Pagination } from '../../../components/ui/Pagination';
import { cardMetaStyle, pageStackStyle } from '../../../components/lead/lead.styles';
import {
  listCardHeaderRowStyle,
  listEmptyNoteStyle,
  listRowsStyle,
  listSearchButtonStyle,
  listSearchFieldStyle,
  listSearchFormStyle,
  rfqBadgeStyle,
  rfqCardStyle,
} from '../../../components/rfq/rfq.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDate } from '../../../lib/i18n/format';
import type { TranslationKey } from '../../../lib/i18n/translations';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

const OPPORTUNITY_STATUS_LABEL_KEY: Record<OpportunityStatus, TranslationKey> = {
  NEEDS_CONFIRMED: 'oppStatusNeedsConfirmed',
  RFQ_ISSUED: 'oppStatusRfqIssued',
  QUOTES_RECEIVED: 'oppStatusQuotesReceived',
  COMPARISON_BUILT: 'oppStatusComparisonBuilt',
  RECOMMENDATION_DRAFTED: 'oppStatusRecommendationDrafted',
  SENT_TO_CLIENT: 'oppStatusSentToClient',
  CLIENT_DECISION: 'oppStatusClientDecision',
  PLACEMENT: 'oppStatusPlacement',
  RENEGOTIATE: 'oppStatusRenegotiate',
  CLOSED_LOST: 'oppStatusClosedLost',
};

/**
 * One row, shared by both branches, so a customer-scoped card and a book-wide card cannot drift
 * into being two different things.
 */
function OpportunityCard({ opportunity }: { opportunity: OpportunityListRow }) {
  const router = useRouter();
  const { language, t } = useLanguage();
  return (
    <button
      type="button"
      style={rfqCardStyle}
      onClick={() => router.push(`/opportunities/${opportunity.id}`)}
    >
      <div style={listCardHeaderRowStyle}>
        <strong>{t('oppCardHeading', { id: opportunity.id.slice(0, 8) })}</strong>
        <span style={rfqBadgeStyle}>{t(OPPORTUNITY_STATUS_LABEL_KEY[opportunity.status])}</span>
      </div>
      {/* The customer, because a reader who arrived from the sidebar has none in hand — which is
          the whole reason this screen was empty. `<bdi>` for the reason every other list screen
          uses it: a Latin company name inside an Arabic line. */}
      <div style={cardMetaStyle}>
        {t('oppListCustomerLabel')}: <bdi>{opportunity.customer.legalName}</bdi>
      </div>
      <div style={cardMetaStyle}>
        {t('oppCreatedMeta', {
          type: t(opportunity.isRenewal ? 'oppRenewal' : 'oppNewBusiness'),
          date: formatDate(opportunity.createdAt, language),
        })}
      </div>
    </button>
  );
}

/** The customer-scoped branch, unchanged in meaning: every link that already carried a
 *  `customerId` lands here and sees exactly what it always did. */
function OpportunitiesForCustomer({ customerId }: { customerId: string }) {
  const { t } = useLanguage();
  const [opportunities, setOpportunities] = useState<OpportunityListRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOpportunities(await listOpportunities(customerId));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'oppListRefusalAct', 'opportunity.read')
          : err instanceof ApiError && err.status === 404
            ? t('oppCustomerNotFound')
            : err instanceof ApiError
              ? err.message
              : t('oppListLoadError'),
      );
    }
  }, [customerId, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load, t]);

  if (loadError) return <ErrorState title={loadError} />;
  if (!opportunities) return <SkeletonList rows={4} label={t('commonLoading')} />;

  if (opportunities.length === 0) {
    return (
      <p style={listEmptyNoteStyle}>{t('oppListNoneYet')}</p>
    );
  }

  return (
    <div style={listRowsStyle}>
      {opportunities.map((opportunity) => (
        <OpportunityCard key={opportunity.id} opportunity={opportunity} />
      ))}
    </div>
  );
}

/**
 * 🔴 OWNER DECISION 150 RULING 1 — THE BOOK-WIDE LIST.
 *
 * Deliberately the same shape as `policies/page.tsx`: submit-triggered search (this app has no
 * debounce utility), the same four states in the same order, the same page control. A user who
 * has learned one list screen here has learned this one.
 */
function AllOpportunities() {
  const { t } = useLanguage();
  const [opportunities, setOpportunities] = useState<OpportunityListRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(0);

  const load = useCallback(
    async (term: string, nextPage = 0) => {
      try {
        const result = await listAllOpportunities({
          ...(term ? { search: term } : {}),
          ...(nextPage ? { page: nextPage } : {}),
        });
        setOpportunities(result.items);
        setTotal(result.total);
        // The server's size, not a constant repeated here: it clamps what was asked for, so this
        // is the only honest source for the range label.
        setPageSize(result.pageSize);
        setPage(result.page);
        setLoadError(null);
      } catch (err) {
        setOpportunities(null);
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? permissionRefusal(t, 'oppListRefusalAct', 'opportunity.read')
            : err instanceof ApiError
              ? err.message
              : t('oppListLoadError'),
        );
      }
    },
    [t],
  );

  useEffect(() => {
    void (async () => {
      await load(searchTerm);
    })();
  }, [searchTerm, load, t]);

  function onSearchSubmit(e: FormEvent) {
    e.preventDefault();
    setSearchTerm(search);
  }

  return (
    <>
      <form onSubmit={onSearchSubmit} style={listSearchFormStyle}>
        <div style={listSearchFieldStyle}>
          <label htmlFor="opportunity-search">{t('commonSearch')}</label>
          <input
            id="opportunity-search"
            dir="auto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('commonSearchPlaceholder')}
          />
        </div>
        <button type="submit" style={listSearchButtonStyle}>
          {t('commonSearch')}
        </button>
      </form>

      {/* The four states, in the order every other list screen uses. */}
      {opportunities === null && !loadError ? (
        <SkeletonList rows={4} label={t('commonLoading')} />
      ) : null}
      {loadError ? <ErrorState title={loadError} /> : null}
      {opportunities !== null && !loadError ? (
        opportunities.length === 0 ? (
          /* ⚠️ NOT `oppListNoneYet`, which says «لهذا العميل» — false on a book-wide list. The
             generic sentence is true of both the unfiltered and the searched empty case; one
             naming opportunities would be a new sentence, and that is the owner's. */
          <p style={listEmptyNoteStyle}>
            {t('oppListNoRecords')}
          </p>
        ) : (
          <div style={listRowsStyle}>
            {opportunities.map((opportunity) => (
              <OpportunityCard key={opportunity.id} opportunity={opportunity} />
            ))}
          </div>
        )
      ) : null}
      {/* The search travels with the page, so paging never silently widens the result set. */}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(next) => void load(searchTerm, next)}
      />
    </>
  );
}

function OpportunitiesFlow() {
  const searchParams = useSearchParams();
  const customerId = searchParams.get('customerId') ?? '';
  return customerId ? (
    <OpportunitiesForCustomer customerId={customerId} />
  ) : (
    <AllOpportunities />
  );
}

export default function OpportunitiesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader title={t('oppListHeading')} description={t('oppListIntro')} />
      <Suspense fallback={null}>
        <OpportunitiesFlow />
      </Suspense>
    </main>
  );
}

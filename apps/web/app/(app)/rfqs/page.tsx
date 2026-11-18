'use client';

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { hasPermission } from '../../../lib/auth/permissions';
import { listAllRfqs, listRfqs, type RfqListRow } from '../../../lib/rfq/rfq-api';
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
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';
import { insurerDisplayName, lineDisplayName } from '../../../lib/i18n/names';

/**
 * One row, shared by all three branches, so a scoped card and a book-wide card cannot drift into
 * being two different things.
 */
function RfqCard({ rfq }: { rfq: RfqListRow }) {
  const router = useRouter();
  const { language, t } = useLanguage();
  return (
    <button
      type="button"
      style={rfqCardStyle}
      onClick={() => router.push(`/rfqs/${rfq.id}`)}
    >
      <div style={listCardHeaderRowStyle}>
        <strong>
          <bdi>{lineDisplayName(rfq, language)}</bdi>
        </strong>
        <span style={rfqBadgeStyle}>
          {t(
            rfq.insurerSubmissions.length === 1
              ? 'rfqInsurerCountOne'
              : 'rfqInsurerCountOther',
            { count: rfq.insurerSubmissions.length },
          )}
        </span>
      </div>
      {/* The customer, because a reader who arrived from the sidebar has none in hand. */}
      <div style={cardMetaStyle}>
        {t('rfqListCustomerLabel')}: <bdi>{rfq.customer.legalName}</bdi>
      </div>
      {/* The line again, labelled — the heading above shows it, and a row scanned in a book-wide
          list is read by its labels rather than by position. Both go through message 45's
          `lineDisplayName`, so the two cannot disagree. */}
      <div style={cardMetaStyle}>
        {t('rfqListLineLabel')}: <bdi>{lineDisplayName(rfq, language)}</bdi>
      </div>
      {/* ⛔ THE INSURERS GO THROUGH `insurerDisplayName`, NEVER `.name` DIRECTLY. Message 45 §2
          measured what happens otherwise: three submission rows printed an EMPTY cell, because
          `undefined` renders as nothing in React. Shown only when there is a shortlist — the
          count badge above already says when there is not. */}
      {rfq.insurerSubmissions.length > 0 ? (
        <div style={cardMetaStyle}>
          {t('rfqListInsurerLabel')}:{' '}
          <bdi>
            {rfq.insurerSubmissions
              .map((s) => insurerDisplayName(s.insurer, language))
              .join(' · ')}
          </bdi>
        </div>
      ) : null}
      <div style={cardMetaStyle}>
        {t('rfqListIssuedMeta', { date: formatDate(rfq.issuedAt, language) })}
      </div>
    </button>
  );
}

/** The scoped branches, unchanged in meaning: every link that already carried an
 *  `opportunityId` or a `customerId` lands here and sees exactly what it always did. */
function RfqsForParent({
  scope,
}: {
  scope: { opportunityId: string } | { customerId: string };
}) {
  const { t } = useLanguage();
  const [rfqs, setRfqs] = useState<RfqListRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const key = 'opportunityId' in scope ? scope.opportunityId : scope.customerId;

  const load = useCallback(async () => {
    try {
      setRfqs(await listRfqs(scope));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'rfqListRefusalAct', 'rfq.read')
          : err instanceof ApiError && err.status === 404
            ? t('rfqListParentNotFound')
            : err instanceof ApiError
              ? err.message
              : t('rfqListLoadError'),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load, t]);

  if (loadError) return <ErrorState title={loadError} />;
  if (!rfqs) return <SkeletonList rows={4} label={t('commonLoading')} />;
  if (rfqs.length === 0) {
    return (
      <p style={listEmptyNoteStyle}>{t('rfqListNone')}</p>
    );
  }

  return (
    <div style={listRowsStyle}>
      {rfqs.map((rfq) => (
        <RfqCard key={rfq.id} rfq={rfq} />
      ))}
    </div>
  );
}

/**
 * 🔴 OWNER DECISION 150 RULING 1 — THE BOOK-WIDE LIST, in `policies/page.tsx`'s shape.
 *
 * ⚠️ AND IT DOES NOT WIDEN DOOR FOUR. The server scopes this by OWNERSHIP, never by the
 * customer-file anchor — a reader admitted only by an anchor owns no customer and holds no
 * `customer-file.all-owners.read`, so this list is empty for them and their anchor stays
 * consultable on the `customerId` branch alone.
 */
function AllRfqs() {
  const { t } = useLanguage();
  const [rfqs, setRfqs] = useState<RfqListRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(0);

  const load = useCallback(
    async (term: string, nextPage = 0) => {
      try {
        const result = await listAllRfqs({
          ...(term ? { search: term } : {}),
          ...(nextPage ? { page: nextPage } : {}),
        });
        setRfqs(result.items);
        setTotal(result.total);
        setPageSize(result.pageSize);
        setPage(result.page);
        setLoadError(null);
      } catch (err) {
        setRfqs(null);
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? permissionRefusal(t, 'rfqListRefusalAct', 'rfq.read')
            : err instanceof ApiError
              ? err.message
              : t('rfqListLoadError'),
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
          <label htmlFor="rfq-search">{t('commonSearch')}</label>
          <input
            id="rfq-search"
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
      {rfqs === null && !loadError ? <SkeletonList rows={4} label={t('commonLoading')} /> : null}
      {loadError ? <ErrorState title={loadError} /> : null}
      {rfqs !== null && !loadError ? (
        rfqs.length === 0 ? (
          /* `rfqListNone` names no customer, so it is already true of the book-wide and the
             searched empty case alike — the only one of the three screens whose shipping
             empty-state sentence needed nothing. */
          <p style={listEmptyNoteStyle}>{t('rfqListNone')}</p>
        ) : (
          <div style={listRowsStyle}>
            {rfqs.map((rfq) => (
              <RfqCard key={rfq.id} rfq={rfq} />
            ))}
          </div>
        )
      ) : null}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(next) => void load(searchTerm, next)}
      />
    </>
  );
}

function RfqsFlow() {
  const searchParams = useSearchParams();
  const opportunityId = searchParams.get('opportunityId') ?? '';
  const customerId = searchParams.get('customerId') ?? '';

  if (opportunityId) return <RfqsForParent scope={{ opportunityId }} />;
  if (customerId) return <RfqsForParent scope={{ customerId }} />;
  return <AllRfqs />;
}

export default function RfqsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  if (isLoading || !user) return null;

  /*
   * ITEM 6 — THE GATE THAT WAS MISSING. Owner decision, 2026-10-17: "install the gate. Every role in
   * the system can open those two pages today, including the DPO and the collections officer. This is
   * a hole in the screen layer, not a decision."
   *
   * AND THE CORRECTION THAT BOUNDS IT, because it was first described to her as a security hole and
   * it is not one: `rfq.controller.ts` requires `rfq.read` on `GET /rfqs` and `rfq.create` on
   * `POST /rfqs`, so the API refuses a caller without them. Only the PAGE was reachable, and whoever
   * opened it saw an empty screen and no data. Same harmless direction as the other findings — a
   * screen that renders nothing rather than a screen that discloses something.
   *
   * What the gate buys is therefore not confidentiality; it is that a role which has no business here
   * is TOLD so instead of being shown a blank page it cannot act on, which is this product's standing
   * rule for a reader who is refused.
   */
  if (!hasPermission(user, 'rfq.read')) {
    return (
      <main style={pageStackStyle}>
        <PageHeader title={t('rfqListHeading')} />
        <p role="status" data-permission-refusal>
          {permissionRefusal(t, 'rfqListRefusalAct', 'rfq.read')}
        </p>
      </main>
    );
  }

  return (
    <main style={pageStackStyle}>
      <PageHeader title={t('rfqListHeading')} />
      <Suspense fallback={null}>
        <RfqsFlow />
      </Suspense>
    </main>
  );
}

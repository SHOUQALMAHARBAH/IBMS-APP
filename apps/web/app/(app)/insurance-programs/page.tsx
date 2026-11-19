'use client';

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  listAllInsurancePrograms,
  listInsurancePrograms,
  type InsuranceProgramListRow,
} from '../../../lib/insurance-program/insurance-program-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  ErrorState,
  PageHeader,
  SkeletonList,
} from '../../../components/ui';
import { Pagination } from '../../../components/ui/Pagination';
import { cardMetaStyle, pageStackStyle } from '../../../components/lead/lead.styles';
import { programListCardStyle } from '../../../components/insurance-program/insurance-program.styles';
import {
  listEmptyNoteStyle,
  listRowsStyle,
  listSearchButtonStyle,
  listSearchFieldStyle,
  listSearchFormStyle,
} from '../../../components/rfq/rfq.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDate } from '../../../lib/i18n/format';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

/**
 * One row, shared by both branches, so a customer-scoped card and a book-wide card cannot drift
 * into being two different things.
 */
function ProgramCard({ program }: { program: InsuranceProgramListRow }) {
  const router = useRouter();
  const { language, t, tPlural } = useLanguage();
  return (
    <button
      type="button"
      style={programListCardStyle}
      aria-label={t('iprogOpenProgramAria', {
        at: formatDate(program.createdAt, language),
      })}
      onClick={() => router.push(`/insurance-programs/${program.id}`)}
    >
      <strong>
        {t('commonStatusLabel')}{' '}
        {t(ENUM_LABEL.InsuranceProgramStatus[program.status])}
      </strong>
      {/* The customer, because a reader who arrived from the sidebar has none in hand. */}
      <div style={cardMetaStyle}>
        {t('iprogListCustomerLabel')}:{' '}
        <bdi>{program.riskProfile.customer.legalName}</bdi>
      </div>
      <div style={cardMetaStyle}>{tPlural('iprogLineCount', program.lines.length)}</div>
      {/* ⚠️ THIS LINE USED TO READ `Assembled {date}` — a hardcoded English word on a screen
          whose other half is Arabic, left behind by Part F. The label is a shipped key now
          («تاريخ الإنشاء» / «Created»), so the card reads in one language. */}
      <div style={cardMetaStyle}>
        {t('iprogListCreatedLabel')}: {formatDate(program.createdAt, language)}
      </div>
    </button>
  );
}

/** The customer-scoped branch, unchanged in meaning: every link that already carried a
 *  `customerId` lands here and sees exactly what it always did. */
function ProgramsForCustomer({ customerId }: { customerId: string }) {
  const { t } = useLanguage();

  const [programs, setPrograms] = useState<InsuranceProgramListRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPrograms(await listInsurancePrograms(customerId));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'iprogRefusalAct', 'program.read')
          : err instanceof ApiError && err.status === 404
            ? t('iprogCustomerNotFound')
            : err instanceof ApiError
              ? err.message
              : t('iprogLoadError'),
      );
    }
  }, [customerId, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load, t]);

  if (loadError) return <ErrorState title={loadError} />;
  if (!programs) return <SkeletonList rows={4} label={t('iprogLoading')} />;

  if (programs.length === 0) {
    return (
      <p style={listEmptyNoteStyle}>
        {t('iprogNoneForCustomer')}
      </p>
    );
  }

  return (
    <div style={listRowsStyle}>
      {programs.map((program) => (
        <ProgramCard key={program.id} program={program} />
      ))}
    </div>
  );
}

/**
 * 🔴 OWNER DECISION 150 RULING 1 — THE BOOK-WIDE LIST, in `policies/page.tsx`'s shape: the same
 * submit-triggered search, the same four states in the same order, the same page control.
 */
function AllPrograms() {
  const { t } = useLanguage();
  const [programs, setPrograms] = useState<InsuranceProgramListRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(0);

  const load = useCallback(
    async (term: string, nextPage = 0) => {
      try {
        const result = await listAllInsurancePrograms({
          ...(term ? { search: term } : {}),
          ...(nextPage ? { page: nextPage } : {}),
        });
        setPrograms(result.items);
        setTotal(result.total);
        setPageSize(result.pageSize);
        setPage(result.page);
        setLoadError(null);
      } catch (err) {
        setPrograms(null);
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? permissionRefusal(t, 'iprogRefusalAct', 'program.read')
            : err instanceof ApiError
              ? err.message
              : t('iprogLoadError'),
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
          <label htmlFor="program-search">{t('commonSearch')}</label>
          <input
            id="program-search"
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
      {programs === null && !loadError ? (
        <SkeletonList rows={4} label={t('iprogLoading')} />
      ) : null}
      {loadError ? <ErrorState title={loadError} /> : null}
      {programs !== null && !loadError ? (
        programs.length === 0 ? (
          /* ⚠️ NOT `iprogNoneForCustomer`, which says «لهذا العميل» — false on a book-wide
             list. The generic sentence is true of both the unfiltered and the searched empty
             case; one naming programmes would be a new sentence, and that is the owner's. */
          <p style={listEmptyNoteStyle}>
            {t('iprogListNoRecords')}
          </p>
        ) : (
          <div style={listRowsStyle}>
            {programs.map((program) => (
              <ProgramCard key={program.id} program={program} />
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

function InsuranceProgramsFlow() {
  const searchParams = useSearchParams();
  const customerId = searchParams.get('customerId') ?? '';
  return customerId ? <ProgramsForCustomer customerId={customerId} /> : <AllPrograms />;
}

export default function InsuranceProgramsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader title={t('iprogHeading')} description={t('iprogIntro')} />
      <Suspense fallback={null}>
        <InsuranceProgramsFlow />
      </Suspense>
    </main>
  );
}

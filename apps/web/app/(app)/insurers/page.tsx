'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { listInsurers, type Insurer } from '../../../lib/insurer/insurer-api';
import { ApiError, isMfaEnrolmentError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import {
  cardMetaStyle,
  cardStyle,
  formRowStyle,
  pageStyle,
} from '../../../components/lead/lead.styles';
import {
  lineChipOfficeStyle,
  lineChipStyle,
  listGridStyle,
} from '../../../components/insurer/insurer.styles';
import { DeactivatedInsurerBadge } from '../../../components/insurer/DeactivatedInsurerBadge';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';

/**
 * The office's own insurer list.
 *
 * ## Why the status filter defaults to "all"
 *
 * A deactivated insurer is not gone — it keeps its policies, claims and invoices, and the office
 * can put it back in play. Hiding those rows by default would make an administrator think a company
 * had been deleted, and the one thing they most need to find is the row they stopped dealing with.
 * So the default shows both and says which is which.
 */
export default function InsurersPage() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const canManage = !!user && hasPermission(user, 'insurer.relationship.manage');

  const [insurers, setInsurers] = useState<Insurer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  // `undefined` is "both", which is why this is not a boolean: `false` means "inactive only" and
  // the API distinguishes the two. A three-state control needs a three-state variable.
  const [activeOnly, setActiveOnly] = useState<boolean | undefined>(undefined);

  const load = useCallback(
    async (term: string, isActive: boolean | undefined) => {
      try {
        const page = await listInsurers({
          ...(term ? { search: term } : {}),
          ...(isActive === undefined ? {} : { isActive }),
        });
        setInsurers(page.items);
        setLoadError(null);
      } catch (err) {
        setInsurers(null);
        setLoadError(
          isMfaEnrolmentError(err)
            ? t('insMfaRequired')
            : err instanceof ApiError && err.status === 403
              ? t('insListNoPermission')
            : err instanceof ApiError
              ? err.message
              : t('insListLoadError'),
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
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load(searchTerm, activeOnly);
    })();
  }, [user, searchTerm, activeOnly, load]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('insListHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>{t('insListIntro')}</p>

      <form onSubmit={onSearchSubmit} style={formRowStyle}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {t('insSearchLabel')}
          <input
            aria-label={t('insSearchLabel')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button type="submit">{t('insSearchButton')}</button>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {t('insFilterAll')}
          <select
            aria-label={t('insFilterAll')}
            data-status-filter=""
            value={activeOnly === undefined ? 'all' : activeOnly ? 'active' : 'inactive'}
            onChange={(e) =>
              setActiveOnly(
                e.target.value === 'all' ? undefined : e.target.value === 'active',
              )
            }
          >
            <option value="all">{t('insFilterAll')}</option>
            <option value="active">{t('insFilterActive')}</option>
            <option value="inactive">{t('insFilterInactive')}</option>
          </select>
        </label>
        {canManage ? (
          <Link href="/insurers/new" style={{ alignSelf: 'end' }}>
            {t('insRegisterButton')}
          </Link>
        ) : null}
      </form>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {insurers ? (
        insurers.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)' }}>
            {searchTerm || activeOnly !== undefined
              ? t('insListEmptyFiltered')
              : t('insListEmpty')}
          </p>
        ) : (
          <div style={listGridStyle}>
            {insurers.map((ins) => (
              <article key={ins.id} style={cardStyle} data-insurer-card="">
                <h2 style={{ fontSize: '1.05rem', margin: 0 }}>
                  <Link href={`/insurers/${ins.id}`}>
                    {/* `bdi` because an Arabic company name beside Latin text reorders the
                        whole line otherwise — the same treatment every name gets in this app. */}
                    <bdi>{language === 'AR' ? (ins.nameAr ?? ins.name) : ins.name}</bdi>
                  </Link>
                  <DeactivatedInsurerBadge isActive={ins.isActive} />
                </h2>
                {ins.isOfficeLocal ? (
                  <p style={cardMetaStyle} title={t('insOfficeLocalExplain')}>
                    {t('insOfficeLocalBadge')}
                  </p>
                ) : null}
                <p style={cardMetaStyle}>{t('insLinesLabel')}</p>
                {ins.linesOffered.length === 0 ? (
                  <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem' }}>
                    {t('insLinesNone')}
                  </p>
                ) : (
                  <div>
                    {ins.linesOffered.map((line) => (
                      <span
                        key={line.id}
                        style={line.isStandard ? lineChipStyle : lineChipOfficeStyle}
                        title={line.isStandard ? undefined : t('insOfficeLineBadge')}
                      >
                        <bdi>{language === 'AR' ? line.nameAr : line.nameEn}</bdi>
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )
      ) : loadError ? null : (
        <p>{t('insListLoading')}</p>
      )}
    </main>
  );
}

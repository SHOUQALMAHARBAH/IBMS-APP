'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { listProspects, type Prospect } from '../../../lib/prospect/prospect-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { cardMetaStyle, cardStyle, pageStyle } from '../../../components/lead/lead.styles';
import { listGridStyle } from '../../../components/prospect/prospect.styles';
import { useLanguage } from '../../../lib/i18n/language-context';

export default function ProspectsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [prospects, setProspects] = useState<Prospect[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Part F item #6 — bilingual full-text search over companyName +
  // contactPerson. Submit-triggered, matching customers/page.tsx's own.
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const loadProspects = useCallback(async (term: string) => {
    try {
      const result = await listProspects(term ? { search: term } : {});
      setProspects(result);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('prosNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('prosLoadError'),
      );
    }
  }, [t]);

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
      await loadProspects(searchTerm);
    })();
  }, [user, searchTerm, loadProspects, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('prosHeading')}</h1>
      <p style={{ opacity: 0.8 }}>
        {t('prosIntro')}
      </p>

      <form onSubmit={onSearchSubmit} style={{ margin: '0.75rem 0' }}>
        <label htmlFor="prospect-search" style={{ marginInlineEnd: '0.5rem' }}>
          Search
        </label>
        <input
          id="prospect-search"
          dir="auto"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('prosSearchPlaceholder')}
        />
        <button type="submit" style={{ marginInlineStart: '0.5rem', cursor: 'pointer' }}>
          Search
        </button>
      </form>

      {prospects === null && !loadError ? <p>{t('prosLoading')}</p> : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}
      {prospects !== null && !loadError ? (
        prospects.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)' }}>
            {searchTerm ? t('prosNoneMatch') : t('prosNone')}
          </p>
        ) : (
          <div style={listGridStyle}>
            {prospects.map((prospect) => (
              <button
                key={prospect.id}
                type="button"
                style={{ ...cardStyle, textAlign: 'start', width: '100%', cursor: 'pointer' }}
                aria-label={t('prosViewProfileAria', { name: prospect.companyName })}
                onClick={() => router.push(`/prospects/${prospect.id}`)}
              >
                <strong>
                  <bdi>{prospect.companyName}</bdi>
                </strong>
                {prospect.sector ? <div style={cardMetaStyle}>{prospect.sector}</div> : null}
                {prospect.location ? (
                  <div style={cardMetaStyle}>
                    <bdi>{prospect.location}</bdi>
                  </div>
                ) : null}
                <div style={cardMetaStyle}>Status: {t(ENUM_LABEL.ProspectStatus[prospect.status])}</div>
              </button>
            ))}
          </div>
        )
      ) : null}
    </main>
  );
}

'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  listInsurerDirectory,
  type DirectoryEntry,
} from '../../../lib/insurer/insurer-directory-api';
import {
  listInsuranceLines,
  type InsuranceLine,
} from '../../../lib/insurer/insurance-line-api';
import { STRUCTURE_LABEL_KEY } from '../../../lib/insurer/insurer-api';
import { ApiError } from '../../../lib/auth/api-client';
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
import { useLanguage } from '../../../lib/i18n/language-context';

/**
 * The cross-office insurer directory.
 *
 * ## What this screen must never grow
 *
 * These are competing brokerages. The company is public knowledge; the panel is not. So there is no
 * "which offices deal with them", no count of offices, no credit terms, no rating, no named
 * relationship contact — and none of that is enforced here. The API reads a `SECURITY DEFINER` view
 * that has no such column in it, so there is nothing for this file to filter and nothing it could
 * accidentally reveal. The note under the heading says so to the reader, because a screen that
 * shows company contact details looks like it might show more if asked.
 *
 * ## An unknown line code is an ERROR, not an empty list
 *
 * `?lineCode=` refuses a code the managed catalogue does not have, with a 422 naming it. That
 * refusal must reach the user as a refusal: `[]` is indistinguishable from "nobody writes this" and
 * looks like an answer, which is the failure mode the whole filter was designed around. So the
 * picker only offers real catalogue codes, and a 422 renders as its own message rather than as the
 * empty state.
 *
 * ## No action here, deliberately
 *
 * No "register this company" button, no contact-request, no "we approached them" note. Everything
 * after the search happens outside the system — the office finds a company and picks up the phone.
 * An endpoint that recorded an approach would be the first step towards the platform knowing which
 * offices are talking to which companies, which is the fact this boundary exists to keep private.
 */
export default function InsurerDirectoryPage() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [entries, setEntries] = useState<DirectoryEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [lines, setLines] = useState<InsuranceLine[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Set when the API refused the LINE specifically. Kept apart from `loadError` so the message can
   *  say "that is not a line" rather than "could not load", and so it never renders as no-results. */
  const [lineError, setLineError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [lineCode, setLineCode] = useState('');
  const [applied, setApplied] = useState<{ search: string; lineCode: string }>({
    search: '',
    lineCode: '',
  });

  const load = useCallback(
    async (query: { search: string; lineCode: string }) => {
      try {
        const page = await listInsurerDirectory({
          ...(query.search ? { search: query.search } : {}),
          ...(query.lineCode ? { lineCode: query.lineCode } : {}),
        });
        setEntries(page.items);
        setTotal(page.total);
        setLoadError(null);
        setLineError(null);
      } catch (err) {
        setEntries(null);
        if (err instanceof ApiError && err.status === 422) {
          // The one refusal that must not look like "no results". The API's own message names the
          // code it rejected; ours adds what to do, because a person seeing this picked from a list
          // and needs to know the list is the answer.
          setLineError(`${err.message} ${t('insDirUnknownLine')}`);
          setLoadError(null);
          return;
        }
        setLineError(null);
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? t('insDirNoPermission')
            : err instanceof ApiError
              ? err.message
              : t('insDirLoadError'),
        );
      }
    },
    [t],
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setApplied({ search, lineCode });
  }

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      // Standard lines only: `lineCode` is a PLATFORM code and an office addition has none, so
      // offering one would render a choice the API must refuse with a 422.
      const ls = await listInsuranceLines().catch(() => [] as InsuranceLine[]);
      setLines(ls.filter((l) => l.isStandard && l.code !== null));
    })();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load(applied);
    })();
  }, [user, applied, load]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('insDirHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>{t('insDirIntro')}</p>
      <p
        style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem', maxWidth: '46rem' }}
        data-boundary-note=""
      >
        {t('insDirBoundaryNote')}
      </p>

      <form onSubmit={onSubmit} style={formRowStyle}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {t('insDirSearchLabel')}
          <input
            aria-label={t('insDirSearchLabel')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {t('insDirLineLabel')}
          <select
            aria-label={t('insDirLineLabel')}
            data-line-filter=""
            value={lineCode}
            onChange={(e) => setLineCode(e.target.value)}
          >
            <option value="">{t('insDirLineAny')}</option>
            {lines.map((l) => (
              <option key={l.id} value={l.code ?? ''}>
                {language === 'AR' ? l.nameAr : l.nameEn}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">{t('insDirSearchButton')}</button>
      </form>

      {lineError ? (
        <p role="alert" style={errorStyle} data-line-error="">
          {lineError}
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {entries ? (
        entries.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)' }}>
            {/* Two different empty states, because they answer different questions. With a line
                filter applied the honest sentence is "nobody has registered a company that writes
                this" — which is only safe to say BECAUSE an unknown code was refused above rather
                than landing here. */}
            {applied.lineCode ? t('insDirEmptyForLine') : t('insDirEmpty')}
          </p>
        ) : (
          <>
            <p style={cardMetaStyle}>{t('insDirTotal', { count: total })}</p>
            <div style={listGridStyle}>
              {entries.map((entry) => (
                <article key={entry.directoryKey} style={cardStyle} data-directory-entry="">
                  <h2 style={{ fontSize: '1.05rem', margin: 0 }}>
                    <bdi>
                      {(language === 'AR' ? entry.nameAr : entry.name) ??
                        entry.name ??
                        entry.nameAr}
                    </bdi>
                  </h2>
                  {entry.structure ? (
                    <p style={cardMetaStyle}>{t(STRUCTURE_LABEL_KEY[entry.structure])}</p>
                  ) : null}

                  {entry.companyPhone || entry.companyEmail || entry.companyWebsite ? (
                    <ul style={{ margin: '0.35rem 0', paddingInlineStart: '1rem' }}>
                      {entry.companyPhone ? (
                        <li>
                          <bdi>{entry.companyPhone}</bdi>
                        </li>
                      ) : null}
                      {entry.companyEmail ? (
                        <li>
                          <bdi>{entry.companyEmail}</bdi>
                        </li>
                      ) : null}
                      {entry.companyWebsite ? (
                        <li>
                          <bdi>{entry.companyWebsite}</bdi>
                        </li>
                      ) : null}
                    </ul>
                  ) : (
                    <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem' }}>
                      {t('insDirNoContact')}
                    </p>
                  )}

                  {entry.lines.length === 0 ? (
                    <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem' }}>
                      {t('insLinesNone')}
                    </p>
                  ) : (
                    <div>
                      {entry.lines.map((line) => (
                        <span
                          // No id on a directory line — the view returns names and an optional
                          // code, deliberately, since an office line's id is not a fact any other
                          // office may hold. The name is the key.
                          key={`${line.code ?? 'local'}:${line.nameEn}`}
                          style={line.code ? lineChipStyle : lineChipOfficeStyle}
                          title={line.code ? undefined : t('insOfficeLineBadge')}
                        >
                          <bdi>{language === 'AR' ? line.nameAr : line.nameEn}</bdi>
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </>
        )
      ) : loadError || lineError ? null : (
        <p>{t('insDirLoading')}</p>
      )}
    </main>
  );
}

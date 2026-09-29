'use client';

import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { hasPermission } from '../../../../lib/auth/permissions';
import {
  revealEmployeeField,
  searchEmployees,
  type EmployeeSearchResult,
} from '../../../../lib/supporting-operations/employee-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';

/*
 * FIND A NAMED EMPLOYEE, REVEAL THEIR NATIONAL ID — IMPROVEMENTS § 1.83.
 *
 * `employee.national-id.reveal` is held by COMPLIANCE_OFFICER alone, and that role holds NO
 * `employee.read`. The split is deliberate (RBAC Phase 3: the people who administer staff records are not
 * the people who can decrypt a national ID) — and its consequence was that the reveal was unusable by the
 * only person trusted with it, because `/employees` and `/employees/[id]` both need the read.
 *
 * The owner refused granting Compliance `employee.read` and refused leaving it broken. This screen is the
 * narrow answer, and its four conditions are hers:
 *
 *   1. THE SEARCH TERM IS MANDATORY. No results are shown until something is typed, and the server refuses
 *      a term under two characters — "an empty search that returns everyone is browsing with extra steps".
 *      This screen does not fire a search on mount, and there is no "show all" control to add later.
 *   2. RESULTS CARRY THE MINIMUM THAT DISTINGUISHES ONE PERSON FROM ANOTHER. Name in both languages, job
 *      title, and whether they still work here. Not the record.
 *   3. THE SEARCH ITSELF IS AUDITED, server-side, not only the reveal — who searched for whom, and when.
 *   4. GUARDS: `employee-search-narrowness.inventory.spec.ts` fails if a field outside the set appears or
 *      if the trim stops preceding the length check; `employee-narrow-search.e2e-spec.ts` proves the
 *      behaviour through HTTP. Both planted.
 *
 * ## Why the revealed value is held in state and never re-fetched
 *
 * Each reveal is an audited decryption with a mandatory reason. Re-requesting it on a re-render would
 * write a second audit row for one act, making the log say the officer looked twice. It is shown until the
 * search changes, and then it is dropped — a stale plaintext national ID on screen beside a different
 * person's name is worse than asking again.
 */

const REASON_FLOOR = 10;

const row: CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  display: 'grid',
  gap: '0.15rem',
};
const formStyle: CSSProperties = {
  margin: '1rem 0',
  display: 'grid',
  gap: '0.4rem',
  maxWidth: '30rem',
};
const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
};
const revealedStyle: CSSProperties = {
  fontFamily: 'var(--font-mono, monospace)',
  fontVariantNumeric: 'tabular-nums',
};

export default function EmployeeRevealPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [term, setTerm] = useState('');
  /** `null` means "no search has been run" — which is NOT the same as "a search found nobody". */
  const [results, setResults] = useState<EmployeeSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealError, setRevealError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const canReveal = hasPermission(user, 'employee.national-id.reveal');

  const onSearch = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setSearchError(null);
      setRevealError(null);
      // Any new search drops the revealed values: a plaintext national ID sitting beside a different
      // person's name is a worse failure than making somebody reveal again.
      setRevealed({});
      setReasonFor(null);
      setSearching(true);
      try {
        setResults(await searchEmployees(term));
      } catch (err) {
        setResults(null);
        setSearchError(
          err instanceof ApiError ? err.message : t('empRevealSearchError'),
        );
      } finally {
        setSearching(false);
      }
    },
    [term, t],
  );

  async function onReveal(id: string) {
    setRevealError(null);
    setBusy(true);
    try {
      const { value } = await revealEmployeeField(id, reason.trim());
      setRevealed((prev) => ({ ...prev, [id]: value }));
      setReasonFor(null);
      setReason('');
    } catch (err) {
      setRevealError(
        err instanceof ApiError ? err.message : t('empRevealFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <p>{t('empRevealLoading')}</p>;
  if (!user) return null;

  // A role without the grant does not get a search box that will 403. This page exists ONLY to exercise
  // that one capability, so the reader came for the thing being refused — which is where naming the
  // missing permission helps rather than confuses.
  if (!canReveal) {
    return (
      <main style={pageStyle}>
        <h1>{t('empRevealHeading')}</h1>
        <p role="alert" style={errorStyle}>
          {t('empRevealNoPermission')}
        </p>
      </main>
    );
  }

  const termTooShort = term.trim().length < 2;

  return (
    <main style={pageStyle}>
      <h1>{t('empRevealHeading')}</h1>
      <p>{t('empRevealIntro')}</p>

      <form onSubmit={onSearch} style={formStyle}>
        <label style={labelStyle}>
          {t('empRevealSearchLabel')}
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t('empRevealSearchPlaceholder')}
            aria-describedby="emp-reveal-search-hint"
          />
        </label>
        <p id="emp-reveal-search-hint">{t('empRevealSearchHint')}</p>
        {/*
          Disabled below the floor rather than sending a request the server will refuse: a screen must not
          make a 400 the normal way to discover the rule. The server still enforces it — this is the UX
          half, not the control.
        */}
        <button type="submit" disabled={searching || termTooShort}>
          {t('empRevealSearchButton')}
        </button>
      </form>

      {searchError ? (
        <p role="alert" style={errorStyle}>
          {searchError}
        </p>
      ) : null}
      {revealError ? (
        <p role="alert" style={errorStyle}>
          {revealError}
        </p>
      ) : null}

      {/*
        THREE STATES, NOT TWO. "Nothing searched yet" and "searched and found nobody" are different facts
        and must not share a blank space — an empty table under a fresh search box reads as "there are no
        employees", which is a claim this screen is not entitled to make.
      */}
      {searching ? <p>{t('empRevealSearching')}</p> : null}
      {!searching && results === null && !searchError ? (
        <p data-testid="emp-reveal-idle">{t('empRevealNothingSearchedYet')}</p>
      ) : null}
      {!searching && results !== null && results.length === 0 ? (
        <p data-testid="emp-reveal-no-matches">{t('empRevealNoMatches')}</p>
      ) : null}

      {results && results.length > 0 ? (
        <ul
          data-testid="emp-reveal-results"
          style={{ listStyle: 'none', padding: 0, margin: 0, maxWidth: '40rem' }}
        >
          {results.map((r) => (
            <li key={r.id} style={row} data-testid={`emp-reveal-row-${r.id}`}>
              <strong>{r.fullName}</strong>
              {/* The English name only when it is a different string — otherwise it reads as a duplicate. */}
              {r.fullNameEn && r.fullNameEn !== r.fullName ? (
                <span>{r.fullNameEn}</span>
              ) : null}
              <span>
                {r.position ?? t('empRevealNoPosition')}
                {' · '}
                {r.isCurrentEmployee
                  ? t('empRevealCurrent')
                  : t('empRevealFormer')}
              </span>

              {revealed[r.id] ? (
                <span
                  style={revealedStyle}
                  data-testid={`emp-reveal-value-${r.id}`}
                >
                  {t('empRevealNationalIdLabel')} {revealed[r.id]}
                </span>
              ) : reasonFor === r.id ? (
                <div style={{ display: 'grid', gap: '0.3rem' }}>
                  <label style={labelStyle}>
                    {t('empRevealReasonLabel')}
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                    />
                  </label>
                  {/*
                    The reason IS the confirmation step — the same treatment the discard control and the
                    combined-duty field get, and for the same reason: an "are you sure" dialog is a thing
                    people click through without reading.
                  */}
                  <button
                    type="button"
                    disabled={busy || reason.trim().length < REASON_FLOOR}
                    onClick={() => void onReveal(r.id)}
                    data-testid={`emp-reveal-confirm-${r.id}`}
                  >
                    {t('empRevealConfirmButton')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setReasonFor(r.id);
                    setReason('');
                  }}
                  data-testid={`emp-reveal-start-${r.id}`}
                >
                  {t('empRevealStartButton')}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}

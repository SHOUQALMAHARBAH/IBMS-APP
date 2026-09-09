'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  listScreeningMatches,
  reviewScreeningMatch,
  type ScreeningMatch,
  type ScreeningMatchStatus,
} from '../../../lib/screening/screening-match-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';

const REVIEW_ROLES = ['COMPLIANCE_OFFICER'];
const STATUSES: ScreeningMatchStatus[] = ['pending', 'confirmed', 'cleared'];
/** Mirrors the DTO's own floor, so the button disables instead of the server
 * rejecting a too-short reason after a round trip. */
const MIN_REASON = 10;

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};

export default function ScreeningMatchesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language } = useLanguage();
  const isArabic = language === 'AR';
  const canReview = !!user && user.roles.some((r) => REVIEW_ROLES.includes(r));

  const [status, setStatus] = useState<ScreeningMatchStatus>('pending');
  const [rows, setRows] = useState<ScreeningMatch[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(
    async (next: ScreeningMatchStatus) => {
      try {
        setRows(await listScreeningMatches(next));
        setLoadError(null);
      } catch (err) {
        setRows(null);
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? isArabic
              ? 'لا تملك صلاحية sanctions-pep.screen.'
              : "You don't hold the sanctions-pep.screen permission."
            : err instanceof ApiError
              ? err.message
              : isArabic
                ? 'تعذّر تحميل قائمة المطابقات — حاول مرة أخرى.'
                : 'Could not load the match queue — try again.',
        );
      }
    },
    [isArabic],
  );

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load(status);
    })();
  }, [user, status, load]);

  async function decide(
    id: string,
    decision: 'cleared' | 'confirmed',
  ): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      await reviewScreeningMatch(id, decision, reasons[id] ?? '');
      setReasons((r) => ({ ...r, [id]: '' }));
      await load(status);
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : isArabic
            ? 'فشل تسجيل القرار — حاول مرة أخرى.'
            : 'Recording that decision failed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>
        {isArabic ? 'مطابقات العقوبات للمراجعة' : 'Sanctions match review'}
      </h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {isArabic
          ? 'تُقارن الأسماء مع قوائم OFAC والأمم المتحدة المحدَّثة تلقائياً، مع مطابقة تقريبية تشمل اختلافات كتابة الاسم بالحروف اللاتينية والأسماء الرباعية. المطابقة هنا سؤال وليست حكماً — لا يوقف النظام أي عميل تلقائياً؛ القرار قرار مسؤول الامتثال.'
          : 'Names are checked against the synced OFAC and UN sanctions lists using fuzzy matching, which covers romanisation variants (Mohammed / Muhammad) and Jordan’s four-part naming convention against shorter list entries. A match here is a QUESTION, not a verdict — nothing is blocked automatically; the decision is a Compliance Officer’s.'}
      </p>

      <div style={{ display: 'flex', gap: '0.4rem', margin: '1rem 0' }}>
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            disabled={busy}
            style={{ fontWeight: s === status ? 700 : 400 }}
          >
            {s}
          </button>
        ))}
      </div>

      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>
            {status === 'pending'
              ? isArabic
                ? 'لا توجد مطابقات بانتظار المراجعة.'
                : 'Nothing awaiting review.'
              : isArabic
                ? 'لا توجد سجلات.'
                : 'No records.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '62rem' }}>
              <thead>
                <tr>
                  <th style={head}>{isArabic ? 'العميل' : 'Customer'}</th>
                  <th style={head}>
                    {isArabic ? 'الاسم المطابِق' : 'Matched name'}
                  </th>
                  <th style={head}>
                    {isArabic ? 'سجل القائمة' : 'List entry'}
                  </th>
                  <th style={head}>{isArabic ? 'النوع' : 'Type'}</th>
                  <th style={head}>{isArabic ? 'رُصد في' : 'Detected'}</th>
                  <th style={head}>
                    {status === 'pending'
                      ? isArabic
                        ? 'القرار'
                        : 'Decision'
                      : isArabic
                        ? 'المراجعة'
                        : 'Review'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>
                      {r.customerLegalName}
                      {r.isEdd ? (
                        <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                          {isArabic ? 'عناية معززة' : 'EDD'}
                        </div>
                      ) : null}
                    </td>
                    <td style={cell}>{r.subjectName}</td>
                    <td style={cell}>
                      {r.listEntryName}
                      <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                        {r.listSource}
                      </div>
                    </td>
                    <td style={cell}>{r.matchType}</td>
                    <td style={cell}>{r.detectedAt.slice(0, 10)}</td>
                    <td style={cell}>
                      {r.status !== 'pending' ? (
                        <div style={{ fontSize: '0.85rem' }}>
                          <strong>{r.status}</strong>
                          <div style={{ opacity: 0.75 }}>{r.reviewReason}</div>
                        </div>
                      ) : canReview ? (
                        <div style={{ display: 'grid', gap: '0.3rem' }}>
                          <textarea
                            aria-label={`Review reason for ${r.subjectName}`}
                            value={reasons[r.id] ?? ''}
                            onChange={(e) =>
                              setReasons((prev) => ({
                                ...prev,
                                [r.id]: e.target.value,
                              }))
                            }
                            rows={2}
                            placeholder={
                              isArabic
                                ? 'سبب القرار (١٠ أحرف على الأقل)'
                                : 'Reason for the decision (min. 10 characters)'
                            }
                            style={{ minWidth: '18rem' }}
                          />
                          <div style={{ display: 'flex', gap: '0.3rem' }}>
                            <button
                              type="button"
                              disabled={
                                busy ||
                                (reasons[r.id]?.trim().length ?? 0) < MIN_REASON
                              }
                              onClick={() => void decide(r.id, 'cleared')}
                            >
                              {isArabic ? 'مطابقة خاطئة' : 'Clear (false positive)'}
                            </button>
                            <button
                              type="button"
                              disabled={
                                busy ||
                                (reasons[r.id]?.trim().length ?? 0) < MIN_REASON
                              }
                              onClick={() => void decide(r.id, 'confirmed')}
                            >
                              {isArabic ? 'تأكيد المطابقة' : 'Confirm match'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span style={{ opacity: 0.6 }}>
                          {isArabic
                            ? 'مسؤول الامتثال فقط'
                            : 'Compliance Officer only'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </main>
  );
}

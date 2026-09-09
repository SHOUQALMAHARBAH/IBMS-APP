'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  RENEWAL_NEXT_STATUSES,
  listRenewalCases,
  runRenewalSweep,
  setRenewalFlags,
  transitionRenewalCase,
  type RenewalCase,
} from '../../../lib/renewal/renewal-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';

const MANAGE_ROLES = [
  'SALES_RELATIONSHIP_OFFICER',
  'PLACEMENT_TECHNICAL_OFFICER',
  'BRANCH_DEPARTMENT_MANAGER',
];

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

export default function RenewalCasesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language } = useLanguage();
  const isArabic = language === 'AR';
  const canManage = !!user && user.roles.some((r) => MANAGE_ROLES.includes(r));

  const [rows, setRows] = useState<RenewalCase[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sweepMessage, setSweepMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listRenewalCases());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? isArabic
            ? 'لا تملك صلاحية renewal.read.'
            : "You don't hold the renewal.read permission."
          : err instanceof ApiError
            ? err.message
            : isArabic
              ? 'تعذّر تحميل حالات التجديد — حاول مرة أخرى.'
              : 'Could not load renewal cases — try again.',
      );
    }
  }, [isArabic]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : isArabic
            ? 'فشل الإجراء — حاول مرة أخرى.'
            : 'That action failed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function sweep() {
    setSweepMessage(null);
    await run(async () => {
      const result = await runRenewalSweep();
      setSweepMessage(
        isArabic
          ? `تم فحص ${result.scanned} وثيقة — فُتحت ${result.opened} حالة تجديد، وتم تخطي ${result.skippedAlreadyOpen}، وفشلت ${result.failed}.`
          : `Scanned ${result.scanned} policy/policies — opened ${result.opened}, skipped ${result.skippedAlreadyOpen} already open, ${result.failed} failed.`,
      );
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{isArabic ? 'حالات التجديد' : 'Renewal cases'}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {isArabic
          ? 'تُفتح حالة التجديد تلقائياً قبل انتهاء الوثيقة بمدة الإشعار المحددة (٩٠ يوماً افتراضياً). هذه هي الحالة التي يقرأها كل من احتساب نسبة الخسارة وكنس حالات الاحتفاظ ومؤقت اتفاقية مستوى الخدمة.'
          : 'A renewal case opens automatically at the configured lead time before a policy expires (90 days by default). It is the record the loss-ratio recompute, the retention sweep and the renewal SLA timer all key off.'}
      </p>

      {canManage ? (
        <>
          <button type="button" disabled={busy} onClick={() => void sweep()}>
            {isArabic ? 'تشغيل كنس التجديد الآن' : 'Run renewal sweep now'}
          </button>
          {sweepMessage ? (
            <p style={{ opacity: 0.75 }}>{sweepMessage}</p>
          ) : null}
        </>
      ) : null}

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
            {isArabic
              ? 'لا توجد حالات تجديد.'
              : 'No renewal cases — nothing is inside the lead-time window yet.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '58rem' }}>
              <thead>
                <tr>
                  <th style={head}>{isArabic ? 'العميل' : 'Customer'}</th>
                  <th style={head}>{isArabic ? 'الوثيقة' : 'Policy'}</th>
                  <th style={head}>{isArabic ? 'الفرع' : 'Line'}</th>
                  <th style={head}>{isArabic ? 'الانتهاء' : 'Expires'}</th>
                  <th style={head}>{isArabic ? 'الحالة' : 'Status'}</th>
                  <th style={head}>
                    {isArabic ? 'نسبة الخسارة' : 'Loss ratio'}
                  </th>
                  <th style={head}>
                    {isArabic ? 'إعادة التسويق' : 'Re-marketing'}
                  </th>
                  <th style={head}>{isArabic ? 'إجراء' : 'Action'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>{r.customerLegalName}</td>
                    <td style={cell}>{r.policyNumber ?? '—'}</td>
                    <td style={cell}>{r.insuranceLine}</td>
                    <td style={cell}>{r.expiryDate?.slice(0, 10) ?? '—'}</td>
                    <td style={cell}>{r.status}</td>
                    <td style={cell}>{r.lossRatio?.ratio ?? '—'}</td>
                    <td style={cell}>
                      {r.requiresRemarketing
                        ? isArabic
                          ? 'مطلوبة'
                          : 'Required'
                        : '—'}
                    </td>
                    <td style={cell}>
                      {canManage && r.open ? (
                        <div
                          style={{
                            display: 'flex',
                            gap: '0.3rem',
                            flexWrap: 'wrap',
                          }}
                        >
                          {RENEWAL_NEXT_STATUSES[r.status].map((next) => (
                            <button
                              key={next}
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() => transitionRenewalCase(r.id, next))
                              }
                            >
                              {next}
                            </button>
                          ))}
                          {!r.insurerTermsWorsened ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  setRenewalFlags(r.id, {
                                    insurerTermsWorsened: true,
                                  }),
                                )
                              }
                            >
                              {isArabic
                                ? 'شروط المؤمِّن ساءت'
                                : 'Insurer terms worsened'}
                            </button>
                          ) : null}
                          {!r.riskChangedSinceLastRenewal ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  setRenewalFlags(r.id, {
                                    riskChangedSinceLastRenewal: true,
                                  }),
                                )
                              }
                            >
                              {isArabic ? 'تغيّر الخطر' : 'Risk changed'}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
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

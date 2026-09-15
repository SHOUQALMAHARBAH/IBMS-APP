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
import { hasPermission } from '../../../lib/auth/permissions';


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
  const { language, t } = useLanguage();
  const isArabic = language === 'AR';
  const canManage = hasPermission(user, 'renewal.manage');

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
          ? t('renNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('renCouldNotLoadRenewalCases'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

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
          : t('renThatActionFailedTryAgain'),
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
      <h1>{t('renRenewalCases')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('renARenewalCaseOpensAutomatically')}
      </p>

      {canManage ? (
        <>
          <button type="button" disabled={busy} onClick={() => void sweep()}>
            {t('renRunRenewalSweepNow')}
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
          <p style={{ color: 'var(--ink-secondary)' }}>
            {t('renNoRenewalCasesNothingIs')}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '58rem' }}>
              <thead>
                <tr>
                  <th style={head}>{t('renCustomer')}</th>
                  <th style={head}>{t('renPolicy')}</th>
                  <th style={head}>{t('renLine')}</th>
                  <th style={head}>{t('renExpires')}</th>
                  <th style={head}>{t('renStatus')}</th>
                  <th style={head}>
                    {t('renLossRatio')}
                  </th>
                  <th style={head}>
                    {t('renReMarketing')}
                  </th>
                  <th style={head}>{t('renAction')}</th>
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
                        ? t('renRequired')
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
                              {t('renInsurerTermsWorsened')}
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
                              {t('renRiskChanged')}
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
      ) : loadError ? null : (
        <p>{t('renLoading')}</p>
      )}
    </main>
  );
}

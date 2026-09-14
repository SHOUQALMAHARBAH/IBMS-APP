'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getInsurerPayables,
  type InsurerPayablesReport,
} from '../../../lib/insurer-accounting/payables-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDate, formatMoney } from '../../../lib/i18n/format';
import type { Language } from '../../../lib/i18n/translations';

function oldest(
  daysOutstanding: number,
  collectedAt: string | null,
  language: Language,
): string {
  if (daysOutstanding >= 0 && collectedAt)
    return `${daysOutstanding}d (since ${formatDate(collectedAt, language)})`;
  return '—';
}

const cellStyle: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'end',
};
const headCellStyle: CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};

export default function InsurerAccountingPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const { language } = useLanguage();

  const [asOf, setAsOf] = useState('');
  const [data, setData] = useState<InsurerPayablesReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (on: string) => {
    try {
      setData(await getInsurerPayables(on ? { asOf: on } : {}));
      setLoadError(null);
    } catch (err) {
      setData(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('iaNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('iaLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load(asOf);
    })();
  }, [user, asOf, load, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('iaHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '44rem' }}>
        {t('iaIntro')}
      </p>

      <label
        style={{ display: 'inline-flex', gap: '0.5rem', margin: '0.75rem 0' }}
      >
        {t('iaAsOf')}
        <input
          type="date"
          aria-label={t('iaAsOfDateAria')}
          value={asOf}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(ev) => setAsOf(ev.target.value)}
        />
      </label>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {data ? (
        data.rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>
            {t('iaNone')}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '44rem' }}>
              <thead>
                <tr>
                  <th style={{ ...headCellStyle, textAlign: 'start' }}>{t('iaColInsurer')}</th>
                  <th style={headCellStyle}>{t('iaColOutstanding')}</th>
                  <th style={headCellStyle}>{t('iaColInvoices')}</th>
                  <th style={{ ...headCellStyle, textAlign: 'start' }}>{t('iaColOldest')}</th>
                  <th style={headCellStyle}>{t('iaColRemittedToDate')}</th>
                  <th style={headCellStyle}>{t('iaColRemittances')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.insurerId}>
                    <td style={{ ...cellStyle, textAlign: 'start' }}>
                      <bdi>{r.insurerName}</bdi>
                    </td>
                    <td style={cellStyle}>{formatMoney(r.outstandingAmount, language)}</td>
                    <td style={cellStyle}>{r.outstandingCount}</td>
                    <td style={{ ...cellStyle, textAlign: 'start' }}>
                      {oldest(r.oldestDaysOutstanding, r.oldestCollectedAt, language)}
                    </td>
                    <td style={cellStyle}>{formatMoney(r.remittedAmount, language)}</td>
                    <td style={cellStyle}>{r.remittedCount}</td>
                  </tr>
                ))}
                <tr>
                  <td
                    style={{ ...cellStyle, textAlign: 'start', fontWeight: 600 }}
                  >
                    {t('iaColTotal')}
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {formatMoney(data.totals.outstandingAmount, language)}
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {data.totals.outstandingCount}
                  </td>
                  <td style={cellStyle} />
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {formatMoney(data.totals.remittedAmount, language)}
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {data.totals.remittedCount}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        <p>{t('iaLoading')}</p>
      )}
    </main>
  );
}

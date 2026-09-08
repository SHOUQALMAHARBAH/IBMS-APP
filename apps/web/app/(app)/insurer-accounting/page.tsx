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
          ? "You don't hold the insurer-accounting.read permission, so there's nothing to show here."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the payables report — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load(asOf);
    })();
  }, [user, asOf, load]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Insurer accounting</h1>
      <p style={{ opacity: 0.75, maxWidth: '44rem' }}>
        What the broker owes each insurer — the net premium (premium less
        commission) that has been collected from the client but not yet remitted
        — alongside the amount remitted to date. Rows are ordered worst-first
        (the oldest unremitted obligation first).
      </p>

      <label
        style={{ display: 'inline-flex', gap: '0.5rem', margin: '0.75rem 0' }}
      >
        As of
        <input
          type="date"
          aria-label="As of date"
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
            Nothing owed to or remitted from any insurer yet.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '44rem' }}>
              <thead>
                <tr>
                  <th style={{ ...headCellStyle, textAlign: 'start' }}>Insurer</th>
                  <th style={headCellStyle}>Outstanding</th>
                  <th style={headCellStyle}>Invoices</th>
                  <th style={{ ...headCellStyle, textAlign: 'start' }}>Oldest</th>
                  <th style={headCellStyle}>Remitted to date</th>
                  <th style={headCellStyle}>Remittances</th>
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
                    Total
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
        <p>Loading&hellip;</p>
      )}
    </main>
  );
}

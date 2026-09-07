'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  AR_AGEING_BUCKET_KEYS,
  AR_AGEING_BUCKET_LABEL,
  getReceivablesAgeing,
  type ReceivablesAgeingReport,
} from '../../../lib/client-accounting/ageing-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

function money(v: string): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? `JOD ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
    : `JOD ${v}`;
}

function oldest(daysOverdue: number, dueDate: string | null): string {
  if (daysOverdue > 0) return `${daysOverdue}d overdue`;
  if (dueDate) return `due ${dueDate.slice(0, 10)}`;
  return '—';
}

const cellStyle: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'right',
};
const headCellStyle: CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};

export default function ClientAccountingPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [asOf, setAsOf] = useState('');
  const [data, setData] = useState<ReceivablesAgeingReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (on: string) => {
    try {
      setData(await getReceivablesAgeing(on ? { asOf: on } : {}));
      setLoadError(null);
    } catch (err) {
      setData(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the client-accounting.read permission, so there's nothing to show here."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the ageing report — try again.',
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
      <h1>Client accounting</h1>
      <p style={{ opacity: 0.75, maxWidth: '44rem' }}>
        Accounts receivable aged by customer — every premium invoice that has not
        yet been collected in full, split into 30 / 60 / 90-day buckets against
        the reference date. Rows are ordered worst-first (oldest debt first).
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
          <p style={{ opacity: 0.6 }}>No outstanding receivables to report.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '48rem' }}>
              <thead>
                <tr>
                  <th style={{ ...headCellStyle, textAlign: 'left' }}>Client</th>
                  {AR_AGEING_BUCKET_KEYS.map((k) => (
                    <th key={k} style={headCellStyle}>
                      {AR_AGEING_BUCKET_LABEL[k]}
                    </th>
                  ))}
                  <th style={headCellStyle}>Outstanding</th>
                  <th style={headCellStyle}>Invoices</th>
                  <th style={{ ...headCellStyle, textAlign: 'left' }}>Oldest</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.customerId}>
                    <td style={{ ...cellStyle, textAlign: 'left' }}>
                      {r.customerLegalName}
                    </td>
                    {AR_AGEING_BUCKET_KEYS.map((k) => (
                      <td key={k} style={cellStyle}>
                        {money(r[k])}
                      </td>
                    ))}
                    <td style={cellStyle}>{money(r.outstandingTotal)}</td>
                    <td style={cellStyle}>{r.invoiceCount}</td>
                    <td style={{ ...cellStyle, textAlign: 'left' }}>
                      {oldest(r.oldestDaysOverdue, r.oldestDueDate)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td
                    style={{ ...cellStyle, textAlign: 'left', fontWeight: 600 }}
                  >
                    Total
                  </td>
                  {AR_AGEING_BUCKET_KEYS.map((k) => (
                    <td key={k} style={{ ...cellStyle, fontWeight: 600 }}>
                      {money(data.totals[k])}
                    </td>
                  ))}
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {money(data.totals.outstandingTotal)}
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {data.totals.invoiceCount}
                  </td>
                  <td style={cellStyle} />
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

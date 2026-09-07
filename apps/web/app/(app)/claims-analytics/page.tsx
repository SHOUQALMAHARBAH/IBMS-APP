'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getLossRatioBreakdown,
  LOSS_RATIO_GROUP_BY,
  type LossRatioBreakdown,
  type LossRatioGroupBy,
} from '../../../lib/claims-analytics/analytics-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const GROUP_LABEL: Record<LossRatioGroupBy, string> = {
  customer: 'Client',
  policy: 'Policy',
  line: 'Insurance line',
};

function money(v: string): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? `JOD ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
    : `JOD ${v}`;
}

function ratioPct(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : v;
}

const cellStyle: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'right',
};
const headCellStyle: CSSProperties = {
  ...cellStyle,
  textAlign: 'right',
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};

export default function ClaimsAnalyticsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [groupBy, setGroupBy] = useState<LossRatioGroupBy>('line');
  const [data, setData] = useState<LossRatioBreakdown | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (g: LossRatioGroupBy) => {
    try {
      setData(await getLossRatioBreakdown({ groupBy: g }));
      setLoadError(null);
    } catch (err) {
      setData(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the claims-analytics.view permission, so there's nothing to show here."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the loss-ratio breakdown — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load(groupBy);
    })();
  }, [user, groupBy, load]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Claims analytics</h1>
      <p style={{ opacity: 0.75, maxWidth: '44rem' }}>
        Loss Ratio (paid claims &divide; written premium, all-time) aggregated by
        client, policy, or insurance line. A declined claim contributes nothing;
        an open claim is not counted until it settles. Rows are ordered
        worst-first.
      </p>

      <label style={{ display: 'inline-flex', gap: '0.5rem', margin: '0.75rem 0' }}>
        Group by
        <select
          aria-label="Group by"
          value={groupBy}
          onChange={(ev) => setGroupBy(ev.target.value as LossRatioGroupBy)}
        >
          {LOSS_RATIO_GROUP_BY.map((g) => (
            <option key={g} value={g}>
              {GROUP_LABEL[g]}
            </option>
          ))}
        </select>
      </label>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {data ? (
        data.rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No written policies to report on yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
              <thead>
                <tr>
                  <th style={{ ...headCellStyle, textAlign: 'left' }}>
                    {GROUP_LABEL[data.groupBy]}
                  </th>
                  <th style={headCellStyle}>Loss ratio</th>
                  <th style={headCellStyle}>Claims paid</th>
                  <th style={headCellStyle}>Written premium</th>
                  <th style={headCellStyle}>Claims</th>
                  <th style={headCellStyle}>Policies</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ ...cellStyle, textAlign: 'left' }}>{r.label}</td>
                    <td style={cellStyle}>
                      {ratioPct(r.ratio)}
                      {r.ratioCapped ? ' (capped)' : ''}
                    </td>
                    <td style={cellStyle}>{money(r.periodClaims)}</td>
                    <td style={cellStyle}>{money(r.periodPremium)}</td>
                    <td style={cellStyle}>{r.claimCount}</td>
                    <td style={cellStyle}>{r.policyCount}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...cellStyle, textAlign: 'left', fontWeight: 600 }}>
                    Total
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {ratioPct(data.totals.ratio)}
                    {data.totals.ratioCapped ? ' (capped)' : ''}
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {money(data.totals.periodClaims)}
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {money(data.totals.periodPremium)}
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {data.totals.claimCount}
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {data.totals.policyCount}
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

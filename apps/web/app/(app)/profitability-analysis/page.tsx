'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getProfitabilityAnalysis,
  type ProfitabilityAnalysisSummary,
  type ProfitabilityBreakdownRow,
} from '../../../lib/management-reporting/profitability-analysis-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };

function BreakdownTable({ rows }: { rows: ProfitabilityBreakdownRow[] }) {
  if (rows.length === 0) {
    return <p style={{ opacity: 0.6 }}>No written policies yet.</p>;
  }
  return (
    <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
      <thead>
        <tr>
          <th style={head}>Key</th>
          <th style={head}>Commission income (JOD)</th>
          <th style={head}>Cost to serve (JOD)</th>
          <th style={head}>Net profitability (JOD)</th>
          <th style={head}>Policies</th>
          <th style={head}>Claims</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td style={cell}>{row.key}</td>
            <td style={cell}>{row.commissionIncomeJod}</td>
            <td style={cell}>{row.costToServeJod}</td>
            <td style={cell}>{row.netProfitabilityJod}</td>
            <td style={cell}>{row.policyCount}</td>
            <td style={cell}>{row.claimCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ProfitabilityAnalysisPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<ProfitabilityAnalysisSummary | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const load = useCallback(async () => {
    try {
      setSummary(await getProfitabilityAnalysis());
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the profitability-analysis.view permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load profitability analysis — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Profitability Analysis</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Commission income vs. cost-to-serve (claims settlement payouts,
        the closest existing signal for servicing cost) by line and by
        client segment.
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {summary ? (
        <>
          <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>
            Generated {summary.generatedAt.replace('T', ' ').slice(0, 16)}.
          </p>

          <section style={sectionStyle}>
            <h2>By line</h2>
            <BreakdownTable rows={summary.byLine} />
          </section>

          <section style={sectionStyle}>
            <h2>By client segment</h2>
            <BreakdownTable rows={summary.bySegment} />
          </section>
        </>
      ) : loadError ? null : (
        <p>Loading&hellip;</p>
      )}
    </main>
  );
}

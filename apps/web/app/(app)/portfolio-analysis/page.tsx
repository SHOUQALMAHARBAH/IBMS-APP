'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getPortfolioAnalysis,
  type PortfolioAnalysisSummary,
  type PortfolioBreakdownRow,
} from '../../../lib/management-reporting/portfolio-analysis-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };

function BreakdownTable({ rows }: { rows: PortfolioBreakdownRow[] }) {
  if (rows.length === 0) {
    return <p style={{ opacity: 0.6 }}>No issued policies yet.</p>;
  }
  return (
    <table style={{ borderCollapse: 'collapse', minWidth: '26rem' }}>
      <thead>
        <tr>
          <th style={head}>Key</th>
          <th style={head}>Policies</th>
          <th style={head}>Total issued premium (JOD)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td style={cell}>
              <bdi>{row.key}</bdi>
            </td>
            <td style={cell}>{row.policyCount}</td>
            <td style={cell}>{row.totalIssuedPremiumJod}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PortfolioAnalysisPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<PortfolioAnalysisSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const load = useCallback(async () => {
    try {
      setSummary(await getPortfolioAnalysis());
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the portfolio-analysis.view permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load portfolio analysis — try again.',
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
      <h1>Portfolio Analysis</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        The issued book, broken down by line, insurer, client segment, and
        geography (branch).
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
            <h2>By insurer</h2>
            <BreakdownTable rows={summary.byInsurer} />
          </section>

          <section style={sectionStyle}>
            <h2>By client segment</h2>
            <BreakdownTable rows={summary.byClientSegment} />
          </section>

          <section style={sectionStyle}>
            <h2>By geography (branch)</h2>
            <BreakdownTable rows={summary.byGeography} />
          </section>
        </>
      ) : loadError ? null : (
        <p>Loading&hellip;</p>
      )}
    </main>
  );
}

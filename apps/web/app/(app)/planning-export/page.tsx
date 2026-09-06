'use client';

import { type CSSProperties, type FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  generatePlanningExport,
  type PlanningExportBreakdownRow,
  type PlanningExportSummary,
} from '../../../lib/management-reporting/planning-export-api';
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
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

function BreakdownTable({ rows }: { rows: PlanningExportBreakdownRow[] }) {
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
            <td style={cell}>{row.key}</td>
            <td style={cell}>{row.policyCount}</td>
            <td style={cell}>{row.totalIssuedPremiumJod}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PlanningExportPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [periodLabel, setPeriodLabel] = useState('');
  const [summary, setSummary] = useState<PlanningExportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  async function onGenerate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsGenerating(true);
    try {
      setSummary(await generatePlanningExport(periodLabel || undefined));
    } catch (err) {
      setSummary(null);
      setError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the planning-export.generate permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not generate the export — try again.',
      );
    } finally {
      setIsGenerating(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Strategic Planning Inputs</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Exports the current portfolio (by line, insurer, client segment, and
        geography) plus one period&apos;s insurer performance scores, for
        feeding into a planning cycle.
      </p>

      <form onSubmit={onGenerate} style={formStyle}>
        <label style={labelStyle}>
          Market period (optional)
          <input
            value={periodLabel}
            onChange={(e) => setPeriodLabel(e.target.value)}
            placeholder="YYYY-MM"
          />
        </label>
        <p style={{ opacity: 0.7, fontSize: '0.85rem', margin: 0 }}>
          Leave blank to score the UTC calendar month that just ended.
          Portfolio data is always the current book, regardless of period.
        </p>
        <button type="submit" disabled={isGenerating}>
          {isGenerating ? 'Generating…' : 'Generate export'}
        </button>
      </form>

      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}

      {summary ? (
        <>
          <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>
            Generated {summary.generatedAt.replace('T', ' ').slice(0, 16)} —
            market period {summary.periodLabel}.
          </p>

          <section style={sectionStyle}>
            <h2>Portfolio — by line</h2>
            <BreakdownTable rows={summary.portfolio.byLine} />
          </section>

          <section style={sectionStyle}>
            <h2>Portfolio — by insurer</h2>
            <BreakdownTable rows={summary.portfolio.byInsurer} />
          </section>

          <section style={sectionStyle}>
            <h2>Portfolio — by client segment</h2>
            <BreakdownTable rows={summary.portfolio.byClientSegment} />
          </section>

          <section style={sectionStyle}>
            <h2>Portfolio — by geography (branch)</h2>
            <BreakdownTable rows={summary.portfolio.byGeography} />
          </section>

          <section style={sectionStyle}>
            <h2>Market — insurer performance ({summary.periodLabel})</h2>
            {summary.market.length === 0 ? (
              <p style={{ opacity: 0.6 }}>
                No insurer performance scores for this period yet.
              </p>
            ) : (
              <table style={{ borderCollapse: 'collapse', minWidth: '30rem' }}>
                <thead>
                  <tr>
                    <th style={head}>Insurer ID</th>
                    <th style={head}>Quote response</th>
                    <th style={head}>Claims service</th>
                    <th style={head}>Price</th>
                    <th style={head}>Service quality</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.market.map((row) => (
                    <tr key={row.id}>
                      <td style={cell}>{row.insurerId}</td>
                      <td style={cell}>{row.quoteResponseScore}</td>
                      <td style={cell}>{row.claimsServiceScore}</td>
                      <td style={cell}>{row.priceScore}</td>
                      <td style={cell}>{row.serviceQualityScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

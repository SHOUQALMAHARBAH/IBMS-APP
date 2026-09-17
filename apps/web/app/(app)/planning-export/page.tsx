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
import { useLanguage } from '../../../lib/i18n/language-context';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid var(--border-default)' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

function BreakdownTable({ rows }: { rows: PlanningExportBreakdownRow[] }) {
  const { t } = useLanguage();
  if (rows.length === 0) {
    return <p style={{ color: 'var(--ink-secondary)' }}>{t('pexNoPolicies')}</p>;
  }
  return (
    <table style={{ borderCollapse: 'collapse', minWidth: '26rem' }}>
      <thead>
        <tr>
          <th style={head}>{t('dashColKey')}</th>
          <th style={head}>{t('dashColPolicies')}</th>
          <th style={head}>{t('dashTotalIssuedPremium')}</th>
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
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [periodLabel, setPeriodLabel] = useState('');
  const [summary, setSummary] = useState<PlanningExportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

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
          ? t('pexNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('pexExportError'),
      );
    } finally {
      setIsGenerating(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('pexHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('pexIntro')}
      </p>

      <form onSubmit={onGenerate} style={formStyle}>
        <label style={labelStyle}>
          {t('pexMarketPeriodLabel')}
          <input
            value={periodLabel}
            onChange={(e) => setPeriodLabel(e.target.value)}
            placeholder={t('dashMonthPlaceholder')}
          />
        </label>
        <p style={{ opacity: 0.7, fontSize: '0.85rem', margin: 0 }}>
          {t('pexPeriodNote')}
        </p>
        <button type="submit" disabled={isGenerating}>
          {isGenerating ? t('pexGeneratingButton') : t('pexGenerateButton')}
        </button>
      </form>

      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}

      {summary ? (
        <>
          <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem' }}>
            Generated {summary.generatedAt.replace('T', ' ').slice(0, 16)} —
            market period {summary.periodLabel}.
          </p>

          <section style={sectionStyle}>
            <h2>{t('pexPortfolioByLine')}</h2>
            <BreakdownTable rows={summary.portfolio.byLine} />
          </section>

          <section style={sectionStyle}>
            <h2>{t('pexPortfolioByInsurer')}</h2>
            <BreakdownTable rows={summary.portfolio.byInsurer} />
          </section>

          <section style={sectionStyle}>
            <h2>{t('pexPortfolioBySegment')}</h2>
            <BreakdownTable rows={summary.portfolio.byClientSegment} />
          </section>

          <section style={sectionStyle}>
            <h2>{t('pexPortfolioByGeography')}</h2>
            <BreakdownTable rows={summary.portfolio.byGeography} />
          </section>

          <section style={sectionStyle}>
            <h2>Market — insurer performance ({summary.periodLabel})</h2>
            {summary.market.length === 0 ? (
              <p style={{ color: 'var(--ink-secondary)' }}>
                {t('pexNoInsurerScores')}
              </p>
            ) : (
              <table style={{ borderCollapse: 'collapse', minWidth: '30rem' }}>
                <thead>
                  <tr>
                    <th style={head}>{t('diepColInsurerId')}</th>
                    <th style={head}>{t('diepQuoteResponse')}</th>
                    <th style={head}>{t('diepClaimsService')}</th>
                    <th style={head}>{t('diepPrice')}</th>
                    <th style={head}>{t('diepServiceQuality')}</th>
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
      ) : error ? null : (
        <p>{t('pexLoading')}</p>
      )}
    </main>
  );
}

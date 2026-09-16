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
import { useLanguage } from '../../../lib/i18n/language-context';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid var(--border-default)' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };

function BreakdownTable({ rows }: { rows: PortfolioBreakdownRow[] }) {
  const { t } = useLanguage();
  if (rows.length === 0) {
    return <p style={{ color: 'var(--ink-secondary)' }}>{t('paNone')}</p>;
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
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<PortfolioAnalysisSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  const load = useCallback(async () => {
    try {
      setSummary(await getPortfolioAnalysis());
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('paNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('paLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('paHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('paIntro')}
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {summary ? (
        <>
          <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem' }}>
            Generated {summary.generatedAt.replace('T', ' ').slice(0, 16)}.
          </p>

          <section style={sectionStyle}>
            <h2>{t('paByLine')}</h2>
            <BreakdownTable rows={summary.byLine} />
          </section>

          <section style={sectionStyle}>
            <h2>{t('paByInsurer')}</h2>
            <BreakdownTable rows={summary.byInsurer} />
          </section>

          <section style={sectionStyle}>
            <h2>{t('paByClientSegment')}</h2>
            <BreakdownTable rows={summary.byClientSegment} />
          </section>

          <section style={sectionStyle}>
            <h2>{t('paByGeography')}</h2>
            <BreakdownTable rows={summary.byGeography} />
          </section>
        </>
      ) : loadError ? null : (
        <p>{t('dashLoading')}</p>
      )}
    </main>
  );
}

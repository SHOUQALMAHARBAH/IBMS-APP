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
import { useLanguage } from '../../../lib/i18n/language-context';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };

function BreakdownTable({ rows }: { rows: ProfitabilityBreakdownRow[] }) {
  const { t } = useLanguage();
  if (rows.length === 0) {
    return <p style={{ color: 'var(--ink-secondary)' }}>{t('praNone')}</p>;
  }
  return (
    <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
      <thead>
        <tr>
          <th style={head}>{t('dashColKey')}</th>
          <th style={head}>{t('praColCommissionIncome')}</th>
          <th style={head}>{t('praColCostToServe')}</th>
          <th style={head}>{t('praColNetProfitability')}</th>
          <th style={head}>{t('dashColPolicies')}</th>
          <th style={head}>{t('praColClaims')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td style={cell}>
              <bdi>{row.key}</bdi>
            </td>
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
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<ProfitabilityAnalysisSummary | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  const load = useCallback(async () => {
    try {
      setSummary(await getProfitabilityAnalysis());
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('praNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('praLoadError'),
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
      <h1>{t('praHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('praIntro')}
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
            <h2>{t('praByLine')}</h2>
            <BreakdownTable rows={summary.byLine} />
          </section>

          <section style={sectionStyle}>
            <h2>{t('praByClientSegment')}</h2>
            <BreakdownTable rows={summary.bySegment} />
          </section>
        </>
      ) : loadError ? null : (
        <p>{t('dashLoading')}</p>
      )}
    </main>
  );
}

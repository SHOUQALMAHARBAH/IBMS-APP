'use client';

import { type CSSProperties, type FormEvent, useEffect, useState } from 'react';
import { ReportProvenance } from '../../../components/ui/ReportProvenance';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  generatePlanningExport,
  type PlanningExportBreakdownRow,
  type PlanningExportSummary,
} from '../../../lib/management-reporting/planning-export-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const formStyle: CSSProperties = {
  margin: '1rem 0',
  display: 'grid',
  gap: 'var(--space-2)',
  maxWidth: '26rem',
};
const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-1)',
};

function BreakdownTable({ rows }: { rows: PlanningExportBreakdownRow[] }) {
  const { t } = useLanguage();
  if (rows.length === 0) {
    return (
      <EmptyState title={t('pexNoPolicies')} />
    );
  }
  return (
    <Card padded={false}>
            <Table>
      <thead>
        <tr>
          <Th>{t('dashColKey')}</Th>
          <Th>{t('dashColPolicies')}</Th>
          <Th>{t('dashTotalIssuedPremium')}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Tr key={row.key}>
            <Td>{row.key}</Td>
            <Td>{row.policyCount}</Td>
            <Td>{row.totalIssuedPremiumJod}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
          </Card>
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
          ? permissionRefusal(t, 'pexRefusalAct', 'planning-export.generate')
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
    <main style={pageStackStyle}>
      <PageHeader
        title={t('pexHeading')}
        description={t('pexIntro')}
      />

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
        <ErrorState title={error} />
      ) : null}

      {summary ? (
        <>
          <ReportProvenance
            kind="generatedAtWithPeriod"
            at={summary.generatedAt}
            periodLabel={summary.periodLabel}
          />

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
            <h2>{t('pexMarketHeading', { period: summary.periodLabel })}</h2>
            {summary.market.length === 0 ? (
              <p style={{ color: 'var(--ink-secondary)' }}>
                {t('pexNoInsurerScores')}
              </p>
            ) : (
              <Card padded={false}>
            <Table>
                <thead>
                  <tr>
                    <Th>{t('diepColInsurer')}</Th>
                    <Th>{t('diepQuoteResponse')}</Th>
                    <Th>{t('diepClaimsService')}</Th>
                    <Th>{t('diepPrice')}</Th>
                    <Th>{t('diepServiceQuality')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {summary.market.map((row) => (
                    <Tr key={row.id}>
                      {/* ITEM 1 — the company's name. This export's portfolio section beside it
                          already resolved one; the market section rendered a uuid. */}
                      <Td>
                        {row.insurerName ? <bdi>{row.insurerName}</bdi> : t('commonNameNotResolved')}
                      </Td>
                      <Td>{row.quoteResponseScore}</Td>
                      <Td>{row.claimsServiceScore}</Td>
                      <Td>{row.priceScore}</Td>
                      <Td>{row.serviceQualityScore}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
          </Card>
            )}
          </section>
        </>
      ) : error ? null : (
        <SkeletonList rows={4} label={t('pexLoading')} />
      )}
    </main>
  );
}

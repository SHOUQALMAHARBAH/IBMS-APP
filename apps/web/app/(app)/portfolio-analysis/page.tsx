'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { ReportProvenance } from '../../../components/ui/ReportProvenance';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getPortfolioAnalysis,
  type PortfolioAnalysisSummary,
  type PortfolioBreakdownRow,
} from '../../../lib/management-reporting/portfolio-analysis-api';
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

function BreakdownTable({ rows }: { rows: PortfolioBreakdownRow[] }) {
  const { t } = useLanguage();
  if (rows.length === 0) {
    return <EmptyState title={t('paNone')} />;
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
            <Td>
              <bdi>{row.key}</bdi>
            </Td>
            <Td>{row.policyCount}</Td>
            <Td>{row.totalIssuedPremiumJod}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
          </Card>
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
          ? permissionRefusal(t, 'paRefusalAct', 'portfolio-analysis.view')
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
    <main style={pageStackStyle}>
      <PageHeader
        title={t('paHeading')}
        description={t('paIntro')}
      />

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {summary ? (
        <>
          <ReportProvenance kind="generatedAt" at={summary.generatedAt} />

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
        <SkeletonList rows={4} label={t('dashLoading')} />
      )}
    </main>
  );
}

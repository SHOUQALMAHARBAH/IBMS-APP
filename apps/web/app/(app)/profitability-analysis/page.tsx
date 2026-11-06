'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { ReportProvenance } from '../../../components/ui/ReportProvenance';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getProfitabilityAnalysis,
  type ProfitabilityAnalysisSummary,
  type ProfitabilityBreakdownRow,
} from '../../../lib/management-reporting/profitability-analysis-api';
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
import { formatMoney } from '../../../lib/i18n/format';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };

function BreakdownTable({ rows }: { rows: ProfitabilityBreakdownRow[] }) {
  const { language, t } = useLanguage();
  if (rows.length === 0) {
    return <EmptyState title={t('praNone')} />;
  }
  return (
    <Card padded={false}>
            <Table>
      <thead>
        <tr>
          <Th>{t('dashColKey')}</Th>
          <Th>{t('praColCommissionIncome')}</Th>
          <Th>{t('praColCostToServe')}</Th>
          <Th>{t('praColNetProfitability')}</Th>
          <Th>{t('dashColPolicies')}</Th>
          <Th>{t('praColClaims')}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Tr key={row.key}>
            <Td>
              <bdi>{row.key}</bdi>
            </Td>
            {/* ROW 69 — fixed 2026-11-06 (module 0-c batch 6), and NOT the half the brief named.
                 THE NAMING COMPLAINT IS DISPROVED BY MEASUREMENT: the brief said the repo declares
                 the cost-to-serve substitution and the screen does not. The screen DOES, in its own
                 intro paragraph, in both languages — `praIntro` reads *"Commission income vs.
                 cost-to-serve (claims settlement payouts, the closest existing signal for servicing
                 cost) by line and by client segment"*, and the Arabic carries the identical
                 parenthetical. So no relabelling is owed and none was done; renaming the column to
                 «المطالبات المدفوعة» would also have re-decided a metric whose framing the
                 permission description names.
                 WHAT WAS REAL AT THIS SITE: all three money columns rendered the api's raw
                 `Decimal` strings — `5000.000` with no grouping — on the screen that says whether a
                 book makes money. Same class as row 16, needs no words. */}
            <Td>{formatMoney(row.commissionIncomeJod, language)}</Td>
            <Td>{formatMoney(row.costToServeJod, language)}</Td>
            <Td>{formatMoney(row.netProfitabilityJod, language)}</Td>
            <Td>{row.policyCount}</Td>
            <Td>{row.claimCount}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
          </Card>
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
          ? permissionRefusal(t, 'praRefusalAct', 'profitability-analysis.view')
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
    <main style={pageStackStyle}>
      <PageHeader
        title={t('praHeading')}
        description={t('praIntro')}
      />

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {summary ? (
        <>
          <ReportProvenance kind="generatedAt" at={summary.generatedAt} />

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
        <SkeletonList rows={4} label={t('dashLoading')} />
      )}
    </main>
  );
}

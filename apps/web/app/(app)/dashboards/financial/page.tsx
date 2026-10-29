'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { ReportProvenance } from '../../../../components/ui/ReportProvenance';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getFinancialDashboard,
  type FinancialDashboardSummary,
  type ProfitabilityRow,
} from '../../../../lib/management-reporting/financial-dashboard-api';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  Card,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../../components/ui';
import { pageStackStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { formatMoney } from '../../../../lib/i18n/format';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';
import { EntitySearch } from '../../../../components/ui/EntitySearch';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statStyle: CSSProperties = { fontSize: '1.4rem', fontWeight: 600 };

function ProfitabilityTable({
  title,
  rows,
}: {
  title: string;
  rows: ProfitabilityRow[];
}) {
  const { t } = useLanguage();
  return (
    <section style={sectionStyle}>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p>{t('dashNoData')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>
                {t('dashColGroup')}
              </Th>
              <Th>
                {t('dfinColPremium')}
              </Th>
              <Th>
                {t('dfinColClaims')}
              </Th>
              <Th>
                {t('dfinColCommission')}
              </Th>
              <Th>
                {t('dfinColNetPosition')}
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.key}>
                <Td>
                  <bdi>{r.label}</bdi>
                </Td>
                <Td>
                  {r.premiumWritten}
                </Td>
                <Td>{r.claimsPaid}</Td>
                <Td>
                  {r.commissionEarned}
                </Td>
                <Td>{r.netPosition}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}

export default function FinancialDashboardPage() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<FinancialDashboardSummary | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const [branchId, setBranchId] = useState('');
  const [insuranceLine, setInsuranceLine] = useState('');
  const [insurerId, setInsurerId] = useState('');
  const [asOf, setAsOf] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  const load = useCallback(async () => {
    try {
      setSummary(
        await getFinancialDashboard({
          branchId: branchId.trim() || undefined,
          insuranceLine: insuranceLine.trim() || undefined,
          insurerId: insurerId.trim() || undefined,
          asOf: asOf.trim() || undefined,
        }),
      );
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'dfinRefusalAct', 'dashboard.financial.view')
          : err instanceof ApiError
            ? err.message
            : t('dfinLoadError'),
      );
    }
  }, [branchId, insuranceLine, insurerId, asOf, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
    // Filters apply on explicit "Apply filters" submit only — see below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, t]);

  function applyFilters(ev: React.FormEvent) {
    ev.preventDefault();
    void load();
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('dfinHeading')}
        description={t('dfinIntro')}
      />

      <form
        onSubmit={applyFilters}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          alignItems: 'flex-end',
          margin: '0.75rem 0',
        }}
      >
        <EntitySearch
          kind="branch"
          value={branchId}
          onChange={setBranchId}
          label={t('dashBranchIdLabel')}
        />
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
          {t('dashInsuranceLineLabel')}
          <input
            aria-label={t('dashInsuranceLineFilterAria')}
            dir="auto"
            value={insuranceLine}
            onChange={(e) => setInsuranceLine(e.target.value)}
          />
        </label>
        <EntitySearch
          kind="insurer"
          value={insurerId}
          onChange={setInsurerId}
          label={t('dashInsurerIdLabel')}
        />
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
          {t('dashAsOf')}
          <input
            aria-label={t('dashAsOfDateAria')}
            placeholder={t('dashDatePlaceholder')}
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
        <button type="submit">{t('dashApplyFilters')}</button>
      </form>

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {summary ? (
        <>
          <ReportProvenance kind="asOf" at={summary.asOf} />

          <Card title={t('dfinReceivables')}>
            <div style={statStyle}>
              {formatMoney(
                summary.receivables.totals.outstandingTotal,
                language,
              )}
            </div>
            <div style={{ display: 'flex', gap: '2rem', marginTop: '0.5rem' }}>
              <div>
                {t('commonCurrentLabel')} {summary.receivables.totals.current}
              </div>
              <div>1-30d: {summary.receivables.totals.d1_30}</div>
              <div>31-60d: {summary.receivables.totals.d31_60}</div>
              <div>61-90d: {summary.receivables.totals.d61_90}</div>
              <div>90+d: {summary.receivables.totals.d90_plus}</div>
            </div>
          </Card>

          <Card title={t('dfinPayables')}>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>
                  {formatMoney(
                    summary.payables.totals.outstandingAmount,
                    language,
                  )}
                </div>
                <div>
                  {t('dfinOutstandingCount', {
                    count: summary.payables.totals.outstandingCount,
                  })}
                </div>
              </div>
              <div>
                <div style={statStyle}>
                  {formatMoney(
                    summary.payables.totals.remittedAmount,
                    language,
                  )}
                </div>
                <div>
                  {t('dfinRemittedCount', {
                    count: summary.payables.totals.remittedCount,
                  })}
                </div>
              </div>
            </div>
          </Card>

          <Card title={t('dfinCommissionIncome')}>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>
                  {formatMoney(summary.commission.earned, language)}
                </div>
                <div>{t('dfinEarned')}</div>
              </div>
              <div>
                <div style={statStyle}>
                  {formatMoney(summary.commission.outstanding, language)}
                </div>
                <div>{t('dfinOutstanding')}</div>
              </div>
              <div>
                <div style={statStyle}>
                  {formatMoney(summary.commission.paid, language)}
                </div>
                <div>{t('dfinPaid')}</div>
              </div>
            </div>
          </Card>

          <Card title={t('dfinProfitability')}>
            <ProfitabilityTable
              title={t('dfinByLine')}
              rows={summary.profitability.byLine}
            />
            <ProfitabilityTable
              title={t('dfinByClientSegment')}
              rows={summary.profitability.bySegment}
            />
          </Card>
        </>
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('dashLoading')} />
      )}
    </main>
  );
}

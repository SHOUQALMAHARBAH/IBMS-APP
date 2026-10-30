'use client';

import {
  Card,
  DateEcho,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getFinancialReportSummary,
  type FinancialReportSummary,
} from '../../../lib/finance/financial-report-api';
import { ApiError } from '../../../lib/auth/api-client';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatMoney } from '../../../lib/i18n/format';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';


function Figure({ label, value }: { label: string; value: string }) {
  const { language } = useLanguage();
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '2rem',
        padding: '0.3rem 0',
        borderBottom: '1px solid #f0f0f0',
        maxWidth: '28rem',
      }}
    >
      <span style={{ opacity: 0.75 }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatMoney(value, language)}
      </span>
    </div>
  );
}

export default function FinancialReportPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language, t, tPlural } = useLanguage();

  const [asOf, setAsOf] = useState('');
  const [data, setData] = useState<FinancialReportSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (on: string) => {
    try {
      setData(await getFinancialReportSummary(on ? { asOf: on } : {}));
      setLoadError(null);
    } catch (err) {
      setData(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'frRefusalAct', 'financial-report.view')
          : err instanceof ApiError
            ? err.message
            : t('frLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load(asOf);
    })();
  }, [user, asOf, load, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('frHeading')}
        description={t('frIntro')}
      />

      <div
        style={{ display: 'inline-flex', gap: '0.5rem', margin: '0.75rem 0', alignItems: 'baseline' }}
      >
        <label htmlFor="fr-as-of">{t('frAsOf')}</label>
        <input
          id="fr-as-of"
          type="date"
          value={asOf}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(ev) => setAsOf(ev.target.value)}
        />
        <DateEcho value={asOf} />
      </div>

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {!data ? (
        loadError ? null : (
          <SkeletonList rows={4} label={t('frLoading')} />
        )
      ) : (
        <>
          <Card title={t('frClientReceivables')}>
            <Figure
              label={t('frOutstandingTotal')}
              value={data.receivables.outstandingTotal}
            />
            <Figure label={t('frCurrent')} value={data.receivables.current} />
            <Figure label={t('frAgeing1To30')} value={data.receivables.d1_30} />
            <Figure label={t('frAgeing31To60')} value={data.receivables.d31_60} />
            <Figure label={t('frAgeing61To90')} value={data.receivables.d61_90} />
            <Figure label={t('frAgeing90Plus')} value={data.receivables.d90_plus} />
            <p style={{ color: 'var(--ink-secondary)', fontSize: '0.9rem' }}>
              {t('frInvoicesAcrossCustomers', {
                invoices: tPlural('frInvoiceCount', data.receivables.invoiceCount),
                customers: tPlural('frCustomerCount', data.receivables.customerCount),
              })}
            </p>
          </Card>

          <Card title={t('frInsurerPayables')}>
            <Figure
              label={t('frOutstandingCollectedNotRemitted')}
              value={data.payables.outstandingAmount}
            />
            <Figure
              label={t('frRemittedToDate')}
              value={data.payables.remittedAmount}
            />
            <p style={{ color: 'var(--ink-secondary)', fontSize: '0.9rem' }}>
              {t('frAcrossInsurers', {
                insurers: tPlural('frInsurerCount', data.payables.insurerCount),
              })}
            </p>
          </Card>

          <Card title={t('frCommissionIncome')}>
            <Figure label={t('frEarnedGross')} value={data.commission.earned} />
            <Figure label={t('frVat')} value={data.commission.vat} />
            <Figure label={t('frGrossInclVat')} value={data.commission.gross} />
            <Figure label={t('frReversedClawedBack')} value={data.commission.reversed} />
            <Figure
              label={t('frNetEarnedAfterClawbacks')}
              value={data.commission.netEarned}
            />
            <Figure label={t('frPaidReconciled')} value={data.commission.paid} />
            <Figure
              label={t('frOutstandingStillToCollect')}
              value={data.commission.outstanding}
            />
            {data.commission.byInsurer.length > 0 ? (
              <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
                <table
                  style={{ borderCollapse: 'collapse', minWidth: '40rem' }}
                >
                  <thead>
                    <tr>
                      <Th>{t('frColInsurer')}</Th>
                      <Th>{t('frEarned')}</Th>
                      <Th>{t('frPaid')}</Th>
                      <Th>{t('frOutstanding')}</Th>
                      <Th>{t('frReversed')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.commission.byInsurer.map((r) => (
                      <Tr key={r.insurerId}>
                        <Td>
                          <bdi>{r.insurerName}</bdi>
                        </Td>
                        <Td>{formatMoney(r.earned, language)}</Td>
                        <Td>{formatMoney(r.paid, language)}</Td>
                        <Td>{formatMoney(r.outstanding, language)}</Td>
                        <Td>{formatMoney(r.reversed, language)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>

          <Card title={t('frBookResultByLine')}>
            <p style={{ color: 'var(--ink-secondary)', fontSize: '0.9rem', maxWidth: '44rem' }}>
              {t('frNetPositionNote')}
            </p>
            <ProfitTable rows={data.profitability.byLine} />
            <h2 style={{ marginTop: '1.25rem' }}>{t('frBookResultBySegment')}</h2>
            <ProfitTable rows={data.profitability.bySegment} />
          </Card>
        </>
      )}
    </main>
  );
}

function ProfitTable({
  rows,
}: {
  rows: FinancialReportSummary['profitability']['byLine'];
}) {
  const { language, t } = useLanguage();
  if (rows.length === 0)
    return <EmptyState title={t('frNoPolicies')} />;
  return (
    <div style={{ overflowX: 'auto' }}>
      <Table>
        <thead>
          <tr>
            <Th>{t('frColGroup')}</Th>
            <Th>{t('frColPremiumWritten')}</Th>
            <Th>{t('frColClaimsPaid')}</Th>
            <Th>{t('frColCommission')}</Th>
            <Th>{t('frColNetPosition')}</Th>
            <Th>{t('frColPolicies')}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.key}>
              <Td>
                <bdi>{r.label}</bdi>
              </Td>
              <Td>{formatMoney(r.premiumWritten, language)}</Td>
              <Td>{formatMoney(r.claimsPaid, language)}</Td>
              <Td>{formatMoney(r.commissionEarned, language)}</Td>
              <Td>{formatMoney(r.netPosition, language)}</Td>
              <Td>{r.policyCount}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

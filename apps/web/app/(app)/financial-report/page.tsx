'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getFinancialReportSummary,
  type FinancialReportSummary,
} from '../../../lib/finance/financial-report-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatMoney } from '../../../lib/i18n/format';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'end',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};
const sectionStyle: CSSProperties = { margin: '1.5rem 0' };

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
  const { language, t } = useLanguage();

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
          ? t('frNoPermission')
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
    <main style={pageStyle}>
      <h1>{t('frHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('frIntro')}
      </p>

      <label
        style={{ display: 'inline-flex', gap: '0.5rem', margin: '0.75rem 0' }}
      >
        {t('frAsOf')}
        <input
          type="date"
          aria-label={t('frAsOfDateAria')}
          value={asOf}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(ev) => setAsOf(ev.target.value)}
        />
      </label>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {!data ? (
        loadError ? null : (
          <p>{t('frLoading')}</p>
        )
      ) : (
        <>
          <section style={sectionStyle}>
            <h2>{t('frClientReceivables')}</h2>
            <Figure
              label={t('frOutstandingTotal')}
              value={data.receivables.outstandingTotal}
            />
            <Figure label={t('frCurrent')} value={data.receivables.current} />
            <Figure label="1–30 days" value={data.receivables.d1_30} />
            <Figure label="31–60 days" value={data.receivables.d31_60} />
            <Figure label="61–90 days" value={data.receivables.d61_90} />
            <Figure label="90+ days" value={data.receivables.d90_plus} />
            <p style={{ opacity: 0.6, fontSize: '0.9rem' }}>
              {data.receivables.invoiceCount} invoice(s) across{' '}
              {data.receivables.customerCount} customer(s).
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>{t('frInsurerPayables')}</h2>
            <Figure
              label={t('frOutstandingCollectedNotRemitted')}
              value={data.payables.outstandingAmount}
            />
            <Figure
              label={t('frRemittedToDate')}
              value={data.payables.remittedAmount}
            />
            <p style={{ opacity: 0.6, fontSize: '0.9rem' }}>
              Across {data.payables.insurerCount} insurer(s).
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>{t('frCommissionIncome')}</h2>
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
                      <th style={{ ...head, textAlign: 'start' }}>{t('frColInsurer')}</th>
                      <th style={head}>{t('frEarned')}</th>
                      <th style={head}>{t('frPaid')}</th>
                      <th style={head}>{t('frOutstanding')}</th>
                      <th style={head}>{t('frReversed')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.commission.byInsurer.map((r) => (
                      <tr key={r.insurerId}>
                        <td style={{ ...cell, textAlign: 'start' }}>
                          <bdi>{r.insurerName}</bdi>
                        </td>
                        <td style={cell}>{formatMoney(r.earned, language)}</td>
                        <td style={cell}>{formatMoney(r.paid, language)}</td>
                        <td style={cell}>{formatMoney(r.outstanding, language)}</td>
                        <td style={cell}>{formatMoney(r.reversed, language)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section style={sectionStyle}>
            <h2>{t('frBookResultByLine')}</h2>
            <p style={{ opacity: 0.65, fontSize: '0.9rem', maxWidth: '44rem' }}>
              &ldquo;Net position&rdquo; is the book&rsquo;s underwriting result
              &mdash; premium written less claims paid less commission &mdash;
              not the brokerage&rsquo;s own margin (that is
              &ldquo;Commission&rdquo;). A negative figure means the line paid
              out more than it took in premium.
            </p>
            <ProfitTable rows={data.profitability.byLine} />
            <h2 style={{ marginTop: '1.25rem' }}>{t('frBookResultBySegment')}</h2>
            <ProfitTable rows={data.profitability.bySegment} />
          </section>
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
    return <p style={{ opacity: 0.6 }}>{t('frNoPolicies')}</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: '46rem' }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: 'start' }}>{t('frColGroup')}</th>
            <th style={head}>{t('frColPremiumWritten')}</th>
            <th style={head}>{t('frColClaimsPaid')}</th>
            <th style={head}>{t('frColCommission')}</th>
            <th style={head}>{t('frColNetPosition')}</th>
            <th style={head}>{t('frColPolicies')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={{ ...cell, textAlign: 'start' }}>
                <bdi>{r.label}</bdi>
              </td>
              <td style={cell}>{formatMoney(r.premiumWritten, language)}</td>
              <td style={cell}>{formatMoney(r.claimsPaid, language)}</td>
              <td style={cell}>{formatMoney(r.commissionEarned, language)}</td>
              <td style={cell}>{formatMoney(r.netPosition, language)}</td>
              <td style={cell}>{r.policyCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

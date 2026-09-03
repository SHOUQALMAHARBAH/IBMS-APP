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

function money(v: string): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? `JOD ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
    : `JOD ${v}`;
}

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'right',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};
const sectionStyle: CSSProperties = { margin: '1.5rem 0' };

function Figure({ label, value }: { label: string; value: string }) {
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
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(value)}</span>
    </div>
  );
}

export default function FinancialReportPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

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
          ? "You don't hold the financial-report.view permission, so there's nothing to show here."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the financial report — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load(asOf);
    })();
  }, [user, asOf, load]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Financial report</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        The consolidated financial dashboard — client receivables and ageing,
        what is owed to and remitted from insurers, the commission income
        roll-up (earned / paid / outstanding / reversed), and the book&rsquo;s
        result by line of business and client segment.
      </p>

      <label
        style={{ display: 'inline-flex', gap: '0.5rem', margin: '0.75rem 0' }}
      >
        As of
        <input
          type="date"
          aria-label="As of date"
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
          <p>Loading&hellip;</p>
        )
      ) : (
        <>
          <section style={sectionStyle}>
            <h2>Client receivables</h2>
            <Figure
              label="Outstanding total"
              value={data.receivables.outstandingTotal}
            />
            <Figure label="Current" value={data.receivables.current} />
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
            <h2>Insurer payables</h2>
            <Figure
              label="Outstanding (collected, not remitted)"
              value={data.payables.outstandingAmount}
            />
            <Figure
              label="Remitted to date"
              value={data.payables.remittedAmount}
            />
            <p style={{ opacity: 0.6, fontSize: '0.9rem' }}>
              Across {data.payables.insurerCount} insurer(s).
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>Commission income</h2>
            <Figure label="Earned (gross)" value={data.commission.earned} />
            <Figure label="VAT" value={data.commission.vat} />
            <Figure label="Gross (incl. VAT)" value={data.commission.gross} />
            <Figure label="Reversed (clawed back)" value={data.commission.reversed} />
            <Figure
              label="Net earned (after clawbacks)"
              value={data.commission.netEarned}
            />
            <Figure label="Paid (reconciled)" value={data.commission.paid} />
            <Figure
              label="Outstanding (still to collect)"
              value={data.commission.outstanding}
            />
            {data.commission.byInsurer.length > 0 ? (
              <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
                <table
                  style={{ borderCollapse: 'collapse', minWidth: '40rem' }}
                >
                  <thead>
                    <tr>
                      <th style={{ ...head, textAlign: 'left' }}>Insurer</th>
                      <th style={head}>Earned</th>
                      <th style={head}>Paid</th>
                      <th style={head}>Outstanding</th>
                      <th style={head}>Reversed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.commission.byInsurer.map((r) => (
                      <tr key={r.insurerId}>
                        <td style={{ ...cell, textAlign: 'left' }}>
                          {r.insurerName}
                        </td>
                        <td style={cell}>{money(r.earned)}</td>
                        <td style={cell}>{money(r.paid)}</td>
                        <td style={cell}>{money(r.outstanding)}</td>
                        <td style={cell}>{money(r.reversed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section style={sectionStyle}>
            <h2>Book result by line</h2>
            <p style={{ opacity: 0.65, fontSize: '0.9rem', maxWidth: '44rem' }}>
              &ldquo;Net position&rdquo; is the book&rsquo;s underwriting result
              &mdash; premium written less claims paid less commission &mdash;
              not the brokerage&rsquo;s own margin (that is
              &ldquo;Commission&rdquo;). A negative figure means the line paid
              out more than it took in premium.
            </p>
            <ProfitTable rows={data.profitability.byLine} />
            <h2 style={{ marginTop: '1.25rem' }}>Book result by client segment</h2>
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
  if (rows.length === 0)
    return <p style={{ opacity: 0.6 }}>No written policies.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: '46rem' }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: 'left' }}>Group</th>
            <th style={head}>Premium written</th>
            <th style={head}>Claims paid</th>
            <th style={head}>Commission</th>
            <th style={head}>Net position</th>
            <th style={head}>Policies</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={{ ...cell, textAlign: 'left' }}>{r.label}</td>
              <td style={cell}>{money(r.premiumWritten)}</td>
              <td style={cell}>{money(r.claimsPaid)}</td>
              <td style={cell}>{money(r.commissionEarned)}</td>
              <td style={cell}>{money(r.netPosition)}</td>
              <td style={cell}>{r.policyCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

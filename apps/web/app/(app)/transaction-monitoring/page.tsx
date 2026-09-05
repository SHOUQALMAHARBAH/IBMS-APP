'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  TRANSACTION_MONITORING_PATTERN_TYPES,
  closeTransactionMonitoringAlert,
  createTransactionMonitoringAlert,
  escalateTransactionMonitoringAlert,
  listTransactionMonitoringAlerts,
  reportTransactionMonitoringAlertToAuthority,
  runTransactionMonitoringSweep,
  type TransactionMonitoringAlert,
} from '../../../lib/compliance-risk/transaction-monitoring-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const MONITOR_ROLE = 'COMPLIANCE_OFFICER';

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
  verticalAlign: 'top',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};

export default function TransactionMonitoringPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canMonitor = !!user && user.roles.includes(MONITOR_ROLE);

  const [rows, setRows] = useState<TransactionMonitoringAlert[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sweepMessage, setSweepMessage] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState('');
  const [patternType, setPatternType] = useState<string>(
    TRANSACTION_MONITORING_PATTERN_TYPES[4], // 'other'
  );
  const [detailText, setDetailText] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await listTransactionMonitoringAlerts());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the aml.monitor permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load transaction-monitoring alerts — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'That action failed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createTransactionMonitoringAlert({
        customerId: customerId.trim() || undefined,
        patternType,
        detailText: detailText.trim() || undefined,
      });
      setCustomerId('');
      setDetailText('');
    });
  }

  async function sweep() {
    setSweepMessage(null);
    await run(async () => {
      const result = await runTransactionMonitoringSweep();
      setSweepMessage(
        `Scanned ${result.scanned} candidate(s) — created ${result.created} alert(s), ${result.skippedExisting} already flagged, ${result.failed} failed.`,
      );
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>AML/CFT transaction monitoring</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Unusually large premium payments, frequent cancellations/refunds, and
        third-party payment sources are flagged automatically (nightly sweep,
        or run it now). Escalate a flagged pattern to suspicious activity,
        then report it to the competent authority — the record stays here as
        evidence either way.
      </p>

      {canMonitor ? (
        <>
          <form
            onSubmit={submit}
            style={{
              margin: '1rem 0',
              display: 'grid',
              gap: '0.4rem',
              maxWidth: '30rem',
            }}
          >
            <label
              style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
            >
              Customer ID (optional)
              <input
                aria-label="Customer ID"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              />
            </label>
            <label
              style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
            >
              Pattern
              <select
                aria-label="Pattern"
                value={patternType}
                onChange={(e) => setPatternType(e.target.value)}
              >
                {TRANSACTION_MONITORING_PATTERN_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label
              style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
            >
              Detail
              <textarea
                aria-label="Detail"
                value={detailText}
                onChange={(e) => setDetailText(e.target.value)}
                rows={3}
              />
            </label>
            <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
              {busy ? 'Saving…' : 'Log alert'}
            </button>
          </form>
          <button type="button" disabled={busy} onClick={() => void sweep()}>
            Run detection sweep now
          </button>
          {sweepMessage ? <p style={{ opacity: 0.75 }}>{sweepMessage}</p> : null}
        </>
      ) : null}

      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No transaction-monitoring alerts.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '55rem' }}>
              <thead>
                <tr>
                  <th style={head}>Customer</th>
                  <th style={head}>Pattern</th>
                  <th style={head}>Status</th>
                  <th style={head}>Escalated</th>
                  <th style={head}>Reported</th>
                  <th style={head}>Detected</th>
                  <th style={head}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>{r.customerId ? `${r.customerId.slice(0, 8)}…` : '—'}</td>
                    <td style={cell}>{r.patternType}</td>
                    <td style={cell}>{r.status}</td>
                    <td style={cell}>{r.escalatedToSuspiciousActivity ? 'yes' : 'no'}</td>
                    <td style={cell}>{r.reportedToAuthorityAt ? 'yes' : 'no'}</td>
                    <td style={cell}>{r.detectedAt.slice(0, 10)}</td>
                    <td style={cell}>
                      {canMonitor && !r.isClosed ? (
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          {!r.escalatedToSuspiciousActivity ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() => escalateTransactionMonitoringAlert(r.id))
                              }
                            >
                              Escalate
                            </button>
                          ) : !r.reportedToAuthorityAt ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  reportTransactionMonitoringAlertToAuthority(r.id),
                                )
                              }
                            >
                              Report to authority
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => closeTransactionMonitoringAlert(r.id))}
                          >
                            Close
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </main>
  );
}

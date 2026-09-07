'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  RETENTION_CASE_REASONS,
  closeRetentionCase,
  createRetentionCase,
  listRetentionCases,
  runRetentionSweep,
  type RetentionCase,
} from '../../../lib/customer-service/retention-case-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const MANAGE_ROLES = ['SALES_RELATIONSHIP_OFFICER', 'BRANCH_DEPARTMENT_MANAGER'];

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

export default function RetentionCasesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canManage = !!user && user.roles.some((r) => MANAGE_ROLES.includes(r));

  const [rows, setRows] = useState<RetentionCase[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sweepMessage, setSweepMessage] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState('');
  const [reason, setReason] = useState<string>(RETENTION_CASE_REASONS[0]);

  const load = useCallback(async () => {
    try {
      setRows(await listRetentionCases());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the retention-case.manage permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load retention cases — try again.',
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
      await createRetentionCase({ customerId: customerId.trim(), reason });
      setCustomerId('');
    });
  }

  async function sweep() {
    setSweepMessage(null);
    await run(async () => {
      const result = await runRetentionSweep();
      setSweepMessage(
        `Scanned ${result.scanned} renewal case(s) — opened ${result.openedRenewalInactivity} for inactivity, ${result.openedLapseRisk} for lapse risk, ${result.failed} failed.`,
      );
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Customer retention</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Retention cases open automatically when a renewal case shows lapse
        risk or has sat inactive too long (nightly sweep), or can be opened
        manually. A factual log — no workflow, no SLA.
      </p>

      {canManage ? (
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
              Customer ID
              <input
                aria-label="Customer ID"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
              />
            </label>
            <label
              style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
            >
              Reason
              <select
                aria-label="Reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {RETENTION_CASE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
              {busy ? 'Saving…' : 'Open retention case'}
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
          <p style={{ opacity: 0.6 }}>No retention cases.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
              <thead>
                <tr>
                  <th style={head}>Customer</th>
                  <th style={head}>Reason</th>
                  <th style={head}>Status</th>
                  <th style={head}>Opened</th>
                  <th style={head}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>{r.customerId.slice(0, 8)}…</td>
                    <td style={cell}>{r.reason}</td>
                    <td style={cell}>{r.status}</td>
                    <td style={cell}>{r.createdAt.slice(0, 10)}</td>
                    <td style={cell}>
                      {canManage && !r.isClosed ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => closeRetentionCase(r.id))}
                        >
                          Close
                        </button>
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

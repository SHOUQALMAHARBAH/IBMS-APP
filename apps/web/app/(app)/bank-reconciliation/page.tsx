'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  detectReconciliation,
  investigateReconciliationException,
  listReconciliationExceptions,
  resolveReconciliationException,
  type DetectResult,
  type ReconciliationException,
} from '../../../lib/finance/reconciliation-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const FINANCE_ROLE = 'FINANCE_COLLECTIONS_OFFICER';
const MANAGER_ROLE = 'BRANCH_DEPARTMENT_MANAGER';

const cellStyle: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
  verticalAlign: 'top',
};
const headCellStyle: CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};

/** Parse a textarea of `invoiceId, amount` lines into detect-request lines. */
function parseLines(
  raw: string,
): { invoiceId: string; insurerStatementAmount: string }[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [invoiceId, amount] = l.split(/[,\t]/).map((p) => p.trim());
      return { invoiceId: invoiceId ?? '', insurerStatementAmount: amount ?? '' };
    });
}

export default function BankReconciliationPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canReconcile =
    !!user &&
    (user.roles.includes(FINANCE_ROLE) || user.roles.includes(MANAGER_ROLE));

  const [rows, setRows] = useState<ReconciliationException[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statement, setStatement] = useState('');
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [resumes, setResumes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setRows(
        await listReconciliationExceptions().then((r) =>
          r.filter((e) => !e.isResolved),
        ),
      );
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the reconciliation-exception.investigate permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load reconciliation exceptions — try again.',
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

  async function runDetect(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      setDetectResult(await detectReconciliation(parseLines(statement)));
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'Detection failed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

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

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Bank reconciliation</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Compare an insurer&rsquo;s statement against the broker&rsquo;s record
        (net premium = premium &minus; commission). Every non-zero variance
        raises an exception with the exact amount &mdash; it is never written
        off. Investigate and close each one with a written explanation; the
        figure is never adjusted.
      </p>

      {canReconcile ? (
        <form onSubmit={runDetect} style={{ margin: '1rem 0' }}>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}
          >
            Statement lines &mdash; one <code>invoiceId, amount</code> per line
            <textarea
              aria-label="Statement lines"
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              rows={5}
              style={{ fontFamily: 'monospace', minWidth: '28rem' }}
              placeholder={'11111111-1111-1111-1111-111111111111, 105600.000'}
            />
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.5rem' }}>
            {busy ? 'Running…' : 'Run reconciliation'}
          </button>
        </form>
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

      {detectResult ? (
        <p>
          {detectResult.lineCount} line(s): {detectResult.reconciled}{' '}
          reconciled, <strong>{detectResult.exceptionsRaised}</strong>{' '}
          exception(s) raised.
        </p>
      ) : null}

      <h2>Open exceptions</h2>
      {rows ? (
        rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No open reconciliation exceptions.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '46rem' }}>
              <thead>
                <tr>
                  <th style={headCellStyle}>Invoice</th>
                  <th style={{ ...headCellStyle, textAlign: 'right' }}>
                    Statement
                  </th>
                  <th style={{ ...headCellStyle, textAlign: 'right' }}>Broker</th>
                  <th style={{ ...headCellStyle, textAlign: 'right' }}>
                    Variance
                  </th>
                  <th style={headCellStyle}>Status</th>
                  <th style={headCellStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cellStyle}>{r.invoiceId ?? '—'}</td>
                    <td style={{ ...cellStyle, textAlign: 'right' }}>
                      {r.insurerStatementAmount}
                    </td>
                    <td style={{ ...cellStyle, textAlign: 'right' }}>
                      {r.brokerRecordAmount}
                    </td>
                    <td style={{ ...cellStyle, textAlign: 'right' }}>
                      <strong>{r.varianceAmount}</strong>
                    </td>
                    <td style={cellStyle}>{r.status}</td>
                    <td style={cellStyle}>
                      {canReconcile ? (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.35rem',
                          }}
                        >
                          {r.status === 'open' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  investigateReconciliationException(r.id),
                                )
                              }
                            >
                              Investigate
                            </button>
                          ) : null}
                          <input
                            aria-label={`Resolution note for ${r.id}`}
                            placeholder="Resolution note (min 10 chars)"
                            value={notes[r.id] ?? ''}
                            onChange={(e) =>
                              setNotes((n) => ({ ...n, [r.id]: e.target.value }))
                            }
                          />
                          <select
                            aria-label={`Resume invoice as for ${r.id}`}
                            value={resumes[r.id] ?? ''}
                            onChange={(e) =>
                              setResumes((s) => ({
                                ...s,
                                [r.id]: e.target.value,
                              }))
                            }
                          >
                            <option value="">Resume invoice as…</option>
                            <option value="RECONCILED">RECONCILED</option>
                          </select>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(() =>
                                resolveReconciliationException(r.id, {
                                  resolutionNote: (notes[r.id] ?? '').trim(),
                                  ...(resumes[r.id]
                                    ? { resumeInvoiceAs: resumes[r.id] }
                                    : {}),
                                }),
                              )
                            }
                          >
                            Resolve
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
      ) : loadError ? null : (
        <p>Loading&hellip;</p>
      )}
    </main>
  );
}

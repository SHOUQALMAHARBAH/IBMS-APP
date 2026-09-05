'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  applyDsrExtension,
  assignDsr,
  closeDsr,
  createDsr,
  DSR_TYPES,
  fulfilDsr,
  listDsrs,
  partiallyFulfilDsr,
  rejectDsr,
  startDsr,
  verifyDsrIdentity,
  type DataSubjectRequest,
} from '../../../lib/pdpl/dsr-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const LOG_ROLES = [
  'SALES_RELATIONSHIP_OFFICER',
  'FINANCE_COLLECTIONS_OFFICER',
  'CLAIMS_OFFICER',
  'COMPLIANCE_OFFICER',
  'DATA_PROTECTION_OFFICER',
];
const HANDLE_ROLES = ['DATA_PROTECTION_OFFICER'];
const CLOSE_ROLES = ['DATA_PROTECTION_OFFICER'];

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

function hasAny(roles: string[] | undefined, allowed: string[]): boolean {
  return !!roles && roles.some((r) => allowed.includes(r));
}

export default function DsrPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canLog = hasAny(user?.roles, LOG_ROLES);
  const canHandle = hasAny(user?.roles, HANDLE_ROLES);
  const canClose = hasAny(user?.roles, CLOSE_ROLES);

  const [rows, setRows] = useState<DataSubjectRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [type, setType] = useState<string>(DSR_TYPES[0]!);
  const [text, setText] = useState<Record<string, string>>({});
  const [reference, setReference] = useState<Record<string, string>>({});
  const [confirmNoHold, setConfirmNoHold] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      setRows(await listDsrs());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the dsr.log permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load Data Subject Requests — try again.',
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
      await createDsr({ customerId: customerId.trim(), type });
      setCustomerId('');
    });
  }

  const val = (id: string) => (text[id] ?? '').trim();
  const setVal = (id: string, v: string) => setText((t) => ({ ...t, [id]: v }));
  const ref = (id: string) => (reference[id] ?? '').trim();
  const setRef = (id: string, v: string) =>
    setReference((t) => ({ ...t, [id]: v }));

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Data Subject Requests</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Access / Correction / Deletion / Objection requests, logged the
        moment they are received. Tracked against a 15-business-day
        (Access/Deletion) or 10-business-day (Correction/Objection) SLA with
        DPO-then-General-Manager escalation. A Deletion request cannot be
        marked fully fulfilled while a retention hold is open — use partial
        fulfilment instead. Closure needs sign-off from a different DPO
        officer than whoever processed it.
      </p>

      {canLog ? (
        <form
          onSubmit={submit}
          style={{ margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '30rem' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Customer ID
            <input
              aria-label="Customer ID"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Type
            <select
              aria-label="Type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {DSR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy ? 'Saving…' : 'Log request'}
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

      {rows ? (
        rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No Data Subject Requests.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '60rem' }}>
              <thead>
                <tr>
                  <th style={head}>Customer</th>
                  <th style={head}>Type</th>
                  <th style={head}>Status</th>
                  <th style={head}>SLA due</th>
                  <th style={head}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td style={cell}>{(d.customerId ?? d.insuredPersonId ?? '—').slice(0, 8)}…</td>
                    <td style={cell}>{d.type}</td>
                    <td style={cell}>{d.status}</td>
                    <td style={cell}>
                      {d.slaDueAt.slice(0, 10)}
                      {d.isOverdue ? ' (overdue)' : ''}
                    </td>
                    <td style={cell}>
                      {d.status === 'CLOSED' ? (
                        '—'
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '18rem' }}>
                          {canHandle ? (
                            <input
                              aria-label={`Text for ${d.id}`}
                              placeholder="dpo handler id / reason / justification"
                              value={text[d.id] ?? ''}
                              onChange={(e) => setVal(d.id, e.target.value)}
                            />
                          ) : null}
                          {canHandle && d.status === 'IN_PROGRESS' ? (
                            <input
                              aria-label={`Retention schedule reference for ${d.id}`}
                              placeholder="retention schedule reference"
                              value={reference[d.id] ?? ''}
                              onChange={(e) => setRef(d.id, e.target.value)}
                            />
                          ) : null}
                          {canHandle && d.type === 'DELETION' && d.status === 'IN_PROGRESS' ? (
                            <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                              <input
                                type="checkbox"
                                aria-label={`No open retention hold for ${d.id}`}
                                checked={confirmNoHold[d.id] ?? false}
                                onChange={(e) =>
                                  setConfirmNoHold((c) => ({
                                    ...c,
                                    [d.id]: e.target.checked,
                                  }))
                                }
                              />
                              No open retention hold
                            </label>
                          ) : null}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                            {canHandle && d.status === 'RECEIVED' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => verifyDsrIdentity(d.id))}
                              >
                                Verify identity
                              </button>
                            ) : null}
                            {canHandle && d.status === 'IDENTITY_VERIFIED' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => startDsr(d.id))}
                              >
                                Start
                              </button>
                            ) : null}
                            {canHandle &&
                            ['RECEIVED', 'IDENTITY_VERIFIED', 'IN_PROGRESS'].includes(
                              d.status,
                            ) ? (
                              <button
                                type="button"
                                disabled={busy || !val(d.id)}
                                onClick={() => void run(() => assignDsr(d.id, val(d.id)))}
                              >
                                Assign
                              </button>
                            ) : null}
                            {canHandle && d.type === 'ACCESS' && d.status === 'IN_PROGRESS' && !d.accessExtensionAppliedAt ? (
                              <button
                                type="button"
                                disabled={busy || !val(d.id)}
                                onClick={() =>
                                  void run(() => applyDsrExtension(d.id, val(d.id)))
                                }
                              >
                                Apply +15 day extension
                              </button>
                            ) : null}
                            {canHandle && d.status === 'IN_PROGRESS' ? (
                              <button
                                type="button"
                                disabled={busy || (d.type === 'DELETION' && !confirmNoHold[d.id])}
                                onClick={() =>
                                  void run(() => fulfilDsr(d.id, confirmNoHold[d.id]))
                                }
                              >
                                Fulfil
                              </button>
                            ) : null}
                            {canHandle && d.status === 'IN_PROGRESS' ? (
                              <button
                                type="button"
                                disabled={busy || !ref(d.id) || !val(d.id)}
                                onClick={() =>
                                  void run(() =>
                                    partiallyFulfilDsr(d.id, {
                                      retentionScheduleReference: ref(d.id),
                                      partialFulfilmentJustification: val(d.id),
                                    }),
                                  )
                                }
                              >
                                Partially fulfil
                              </button>
                            ) : null}
                            {canHandle &&
                            ['RECEIVED', 'IDENTITY_VERIFIED', 'IN_PROGRESS'].includes(
                              d.status,
                            ) ? (
                              <button
                                type="button"
                                disabled={busy || !val(d.id)}
                                onClick={() => void run(() => rejectDsr(d.id, val(d.id)))}
                              >
                                Reject
                              </button>
                            ) : null}
                            {canClose &&
                            ['FULFILLED', 'PARTIALLY_FULFILLED', 'REJECTED'].includes(
                              d.status,
                            ) ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => closeDsr(d.id))}
                              >
                                Close
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )}
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

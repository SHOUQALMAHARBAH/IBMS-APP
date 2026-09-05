'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  cancelServiceRequest,
  createServiceRequest,
  fulfilServiceRequest,
  listServiceRequests,
  startServiceRequest,
  type ServiceRequest,
} from '../../../lib/customer-service/service-request-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const SALES_ROLE = 'SALES_RELATIONSHIP_OFFICER';
const MANAGER_ROLE = 'BRANCH_DEPARTMENT_MANAGER';
const REQUEST_TYPES = ['certificate', 'copy', 'change', 'other'];

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

function slaLabel(r: ServiceRequest): string {
  if (!r.sla) return '—';
  if (r.sla.resolvedAt) return `resolved`;
  if (r.sla.breached) return `BREACHED (due ${r.sla.dueAt.slice(0, 10)})`;
  return `due ${r.sla.dueAt.slice(0, 10)}`;
}

export default function ServiceRequestsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canManage =
    !!user &&
    (user.roles.includes(SALES_ROLE) || user.roles.includes(MANAGER_ROLE));

  const [rows, setRows] = useState<ServiceRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [requestType, setRequestType] = useState('certificate');
  const [detail, setDetail] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setRows(await listServiceRequests());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the service-request.manage permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load service requests — try again.',
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
      await createServiceRequest({
        customerId: customerId.trim(),
        requestType,
        ...(detail.trim() ? { detail: detail.trim() } : {}),
      });
      setCustomerId('');
      setDetail('');
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Customer requests</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Certificates, copies, changes and other customer service requests. Each
        is tracked against a fulfilment SLA (a 5-business-day working target,
        escalating to the branch manager); the timer clears when the request is
        fulfilled or cancelled.
      </p>

      {canManage ? (
        <form onSubmit={submit} style={{ margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '30rem' }}>
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
            Request type
            <select
              aria-label="Request type"
              value={requestType}
              onChange={(e) => setRequestType(e.target.value)}
            >
              {REQUEST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Detail (optional)
            <input
              aria-label="Detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
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
          <p style={{ opacity: 0.6 }}>No service requests.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '48rem' }}>
              <thead>
                <tr>
                  <th style={head}>Customer</th>
                  <th style={head}>Type</th>
                  <th style={head}>Detail</th>
                  <th style={head}>Status</th>
                  <th style={head}>SLA</th>
                  <th style={head}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>{r.customerId.slice(0, 8)}…</td>
                    <td style={cell}>{r.requestType}</td>
                    <td style={cell}>{r.detail ?? '—'}</td>
                    <td style={cell}>{r.status}</td>
                    <td style={cell}>{slaLabel(r)}</td>
                    <td style={cell}>
                      {canManage && !r.isClosed ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                          {r.status === 'open' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void run(() => startServiceRequest(r.id))}
                            >
                              Start
                            </button>
                          ) : null}
                          <input
                            aria-label={`Outcome note for ${r.id}`}
                            placeholder="Outcome note (min 3 chars)"
                            value={notes[r.id] ?? ''}
                            onChange={(e) =>
                              setNotes((n) => ({ ...n, [r.id]: e.target.value }))
                            }
                          />
                          <div style={{ display: 'flex', gap: '0.3rem' }}>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  fulfilServiceRequest(r.id, (notes[r.id] ?? '').trim()),
                                )
                              }
                            >
                              Fulfil
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  cancelServiceRequest(r.id, (notes[r.id] ?? '').trim()),
                                )
                              }
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        (r.outcomeNote ?? '—')
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

'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  addComplaintAction,
  assignComplaint,
  closeComplaint,
  COMPLAINT_CATEGORIES,
  createComplaint,
  escalateComplaint,
  listComplaints,
  resolveComplaint,
  startComplaint,
  type Complaint,
} from '../../../lib/customer-service/complaint-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const LOG_ROLES = [
  'SALES_RELATIONSHIP_OFFICER',
  'CLAIMS_OFFICER',
  'FINANCE_COLLECTIONS_OFFICER',
  'COMPLIANCE_OFFICER',
  'BRANCH_DEPARTMENT_MANAGER',
];
const ESCALATE_ROLES = ['BRANCH_DEPARTMENT_MANAGER', 'COMPLIANCE_OFFICER'];
const CLOSE_ROLES = ['BRANCH_DEPARTMENT_MANAGER'];

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

function slaLabel(c: Complaint): string {
  if (!c.sla) return '—';
  if (c.sla.resolvedAt) return 'resolved';
  if (c.sla.breached) return `BREACHED (due ${c.sla.dueAt.slice(0, 10)})`;
  return `due ${c.sla.dueAt.slice(0, 10)}`;
}

function hasAny(roles: string[] | undefined, allowed: string[]): boolean {
  return !!roles && roles.some((r) => allowed.includes(r));
}

export default function ComplaintsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canLog = hasAny(user?.roles, LOG_ROLES);
  const canEscalate = hasAny(user?.roles, ESCALATE_ROLES);
  const canClose = hasAny(user?.roles, CLOSE_ROLES);

  const [rows, setRows] = useState<Complaint[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [issue, setIssue] = useState('');
  const [category, setCategory] = useState('');
  const [claimId, setClaimId] = useState('');
  const [text, setText] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setRows(await listComplaints());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the complaint.log permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load complaints — try again.',
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
      await createComplaint({
        customerId: customerId.trim(),
        issue: issue.trim(),
        ...(category ? { category } : {}),
        ...(claimId.trim() ? { claimId: claimId.trim() } : {}),
      });
      setCustomerId('');
      setIssue('');
      setCategory('');
      setClaimId('');
    });
  }

  const val = (id: string) => (text[id] ?? '').trim();
  const setVal = (id: string, v: string) =>
    setText((t) => ({ ...t, [id]: v }));

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Complaints</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Customer complaints, optionally linked to a claim under dispute. Each is
        tracked against a resolution SLA (a 10-business-day working target). A
        complaint that cannot be resolved internally is escalated to the
        Insurance Dispute Resolution Committee. Closure needs a supervisor
        sign-off by a different person than the one who resolved it.
      </p>

      {canLog ? (
        <form
          onSubmit={submit}
          style={{ margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '32rem' }}
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
            Issue
            <textarea
              aria-label="Issue"
              value={issue}
              onChange={(e) => setIssue(e.target.value)}
              required
              rows={2}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Category (optional)
            <select
              aria-label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">—</option>
              {COMPLAINT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Disputed claim ID (optional)
            <input
              aria-label="Disputed claim ID"
              value={claimId}
              onChange={(e) => setClaimId(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy ? 'Saving…' : 'Log complaint'}
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
          <p style={{ opacity: 0.6 }}>No complaints.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '52rem' }}>
              <thead>
                <tr>
                  <th style={head}>Customer</th>
                  <th style={head}>Issue</th>
                  <th style={head}>Status</th>
                  <th style={head}>SLA</th>
                  <th style={head}>Escalations</th>
                  <th style={head}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td style={cell}>{c.customerId.slice(0, 8)}…</td>
                    <td style={cell}>{c.issue}</td>
                    <td style={cell}>{c.status}</td>
                    <td style={cell}>{slaLabel(c)}</td>
                    <td style={cell}>{c.escalations.length || '—'}</td>
                    <td style={cell}>
                      {c.isClosed ? (
                        (c.resolution ?? '—')
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '16rem' }}>
                          <input
                            aria-label={`Text for ${c.id}`}
                            placeholder="assignee id / action / resolution / reason"
                            value={text[c.id] ?? ''}
                            onChange={(e) => setVal(c.id, e.target.value)}
                          />
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                            {canLog && c.status === 'LOGGED' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(() => assignComplaint(c.id, val(c.id)))
                                }
                              >
                                Assign
                              </button>
                            ) : null}
                            {canLog &&
                            (c.status === 'ASSIGNED' ||
                              c.status === 'ESCALATED') ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => startComplaint(c.id))}
                              >
                                Start
                              </button>
                            ) : null}
                            {canLog && c.status === 'IN_PROGRESS' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(() =>
                                    addComplaintAction(c.id, val(c.id)),
                                  )
                                }
                              >
                                Add action
                              </button>
                            ) : null}
                            {canLog &&
                            (c.status === 'IN_PROGRESS' ||
                              c.status === 'ESCALATED') ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(() => resolveComplaint(c.id, val(c.id)))
                                }
                              >
                                Resolve
                              </button>
                            ) : null}
                            {canEscalate && c.status === 'IN_PROGRESS' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(() =>
                                    escalateComplaint(c.id, {
                                      reason: val(c.id) || undefined,
                                    }),
                                  )
                                }
                              >
                                Escalate
                              </button>
                            ) : null}
                            {canClose && c.status === 'RESOLVED' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => closeComplaint(c.id))}
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

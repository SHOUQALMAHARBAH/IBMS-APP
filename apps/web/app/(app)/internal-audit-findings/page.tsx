'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  closeInternalAuditFinding,
  createInternalAuditFinding,
  listInternalAuditFindings,
  recordInternalAuditFindingRemediation,
  type InternalAuditFinding,
} from '../../../lib/compliance-risk/internal-audit-finding-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const RECORD_ROLE = ['COMPLIANCE_OFFICER'];
const CLOSE_ROLE = ['COMPLIANCE_OFFICER', 'BRANCH_DEPARTMENT_MANAGER'];

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
  verticalAlign: 'top',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '30rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

function hasAny(roles: string[] | undefined, allowed: string[]): boolean {
  return !!roles && roles.some((r) => allowed.includes(r));
}

export default function InternalAuditFindingsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canRecord = hasAny(user?.roles, RECORD_ROLE);
  const canClose = hasAny(user?.roles, CLOSE_ROLE);

  const [findings, setFindings] = useState<InternalAuditFinding[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [auditPeriodLabel, setAuditPeriodLabel] = useState('');
  const [finding, setFinding] = useState('');
  const [remediationDrafts, setRemediationDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setFindings(await listInternalAuditFindings());
      setLoadError(null);
    } catch (err) {
      setFindings(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the internal-audit.record/internal-audit.close permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load internal audit findings — try again.',
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
      setActionError(err instanceof ApiError ? err.message : 'That action failed — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createInternalAuditFinding({ auditPeriodLabel, finding });
      setAuditPeriodLabel('');
      setFinding('');
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Internal Audit Findings</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Record audit findings, track the remediation path, and close once
        resolved. Only Compliance may record a finding or update its
        remediation plan; Compliance or a Branch/Department Manager may
        close it.
      </p>

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

      {canRecord ? (
        <form onSubmit={submit} style={formStyle}>
          <label style={labelStyle}>
            Audit period
            <input
              aria-label="Audit period label"
              value={auditPeriodLabel}
              onChange={(e) => setAuditPeriodLabel(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            Finding
            <input
              aria-label="Finding"
              value={finding}
              onChange={(e) => setFinding(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Record finding'}
          </button>
        </form>
      ) : null}

      {findings ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: '60rem' }}>
            <thead>
              <tr>
                <th style={head}>Audit period</th>
                <th style={head}>Finding</th>
                <th style={head}>Remediation</th>
                <th style={head}>Status</th>
                <th style={head}>Action</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.id}>
                  <td style={cell}>{f.auditPeriodLabel}</td>
                  <td style={cell}>{f.finding}</td>
                  <td style={cell}>{f.remediationAction ?? '—'}</td>
                  <td style={cell}>{f.status}</td>
                  <td style={cell}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '16rem' }}>
                      {canRecord && f.status === 'open' ? (
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <input
                            aria-label={`Remediation action for ${f.id}`}
                            placeholder="remediation action"
                            value={remediationDrafts[f.id] ?? ''}
                            onChange={(e) =>
                              setRemediationDrafts((d) => ({ ...d, [f.id]: e.target.value }))
                            }
                          />
                          <button
                            type="button"
                            disabled={busy || !(remediationDrafts[f.id] ?? '').trim()}
                            onClick={() =>
                              void run(() =>
                                recordInternalAuditFindingRemediation(
                                  f.id,
                                  (remediationDrafts[f.id] ?? '').trim(),
                                ),
                              )
                            }
                          >
                            Save remediation
                          </button>
                        </div>
                      ) : null}
                      {canClose && f.status === 'open' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => closeInternalAuditFinding(f.id))}
                        >
                          Close
                        </button>
                      ) : null}
                      {f.status === 'closed' ? '—' : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}

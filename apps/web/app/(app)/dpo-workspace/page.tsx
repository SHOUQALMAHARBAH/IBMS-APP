'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getDpoWorkspaceSummary,
  type DpoWorkspaceSummary,
} from '../../../lib/pdpl/dpo-workspace-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const ROLES = ['DATA_PROTECTION_OFFICER'];

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const sectionStyle: CSSProperties = { margin: '2rem 0' };

function hasAny(roles: string[] | undefined, allowed: string[]): boolean {
  return !!roles && roles.some((r) => allowed.includes(r));
}

export default function DpoWorkspacePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canView = hasAny(user?.roles, ROLES);

  const [summary, setSummary] = useState<DpoWorkspaceSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSummary(await getDpoWorkspaceSummary());
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(
        err instanceof ApiError
          ? err.message
          : 'Could not load the DPO Workspace — try again.',
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

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>DPO Workspace</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Consent status, the open DSR queue with SLA countdowns, the
        incident/breach register, the DPIA register, the active Legal Hold
        register, and the cross-border transfer register — on one screen.
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {!canView ? null : !summary ? (
        loadError ? null : (
          <p>Loading&hellip;</p>
        )
      ) : (
        <>
          <section style={sectionStyle}>
            <h2>Consent status</h2>
            <div style={{ display: 'flex', gap: '1.5rem' }}>
              <span>Active: {summary.consentStatus.activeCount}</span>
              <span>Withdrawn: {summary.consentStatus.withdrawnCount}</span>
              <span>Declined: {summary.consentStatus.declinedCount}</span>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>DSR queue</h2>
            {summary.dsrQueue.length === 0 ? (
              <p style={{ opacity: 0.6 }}>No open Data Subject Requests.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '48rem' }}>
                  <thead>
                    <tr>
                      <th style={head}>Type</th>
                      <th style={head}>Status</th>
                      <th style={head}>SLA due</th>
                      <th style={head}>Days until due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.dsrQueue.map((d) => (
                      <tr key={d.id}>
                        <td style={cell}>{d.type}</td>
                        <td style={cell}>{d.status}</td>
                        <td style={cell}>{d.slaDueAt.slice(0, 10)}</td>
                        <td style={cell}>
                          {d.daysUntilDue < 0
                            ? `Overdue by ${Math.abs(d.daysUntilDue)}d`
                            : `${d.daysUntilDue}d`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <h2>Incident / breach register</h2>
            {summary.incidentRegister.length === 0 ? (
              <p style={{ opacity: 0.6 }}>No open incidents.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
                  <thead>
                    <tr>
                      <th style={head}>Title</th>
                      <th style={head}>Severity</th>
                      <th style={head}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.incidentRegister.map((i) => (
                      <tr key={i.id}>
                        <td style={cell}>{i.title}</td>
                        <td style={cell}>{i.severity}</td>
                        <td style={cell}>{i.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <h2>DPIA register (awaiting review)</h2>
            {summary.dpiaRegister.length === 0 ? (
              <p style={{ opacity: 0.6 }}>No DPIA screenings awaiting review.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
                  <thead>
                    <tr>
                      <th style={head}>Subject</th>
                      <th style={head}>Outcome</th>
                      <th style={head}>Review due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.dpiaRegister.map((d) => (
                      <tr key={d.id}>
                        <td style={cell}>{d.subjectDescription}</td>
                        <td style={cell}>{d.outcome}</td>
                        <td style={cell}>{d.dpoReviewDueAt ? d.dpoReviewDueAt.slice(0, 10) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <h2>Legal Hold register (active)</h2>
            {summary.legalHoldRegister.length === 0 ? (
              <p style={{ opacity: 0.6 }}>No active Legal Holds.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
                  <thead>
                    <tr>
                      <th style={head}>Scope</th>
                      <th style={head}>Next review due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.legalHoldRegister.map((h) => (
                      <tr key={h.id}>
                        <td style={cell}>{h.scope}</td>
                        <td style={cell}>{h.nextReviewDueAt.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <h2>Cross-border transfer register</h2>
            {summary.crossBorderTransferRegister.length === 0 ? (
              <p style={{ opacity: 0.6 }}>No cross-border transfers logged yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
                  <thead>
                    <tr>
                      <th style={head}>Destination</th>
                      <th style={head}>Legal basis</th>
                      <th style={head}>Transferred at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.crossBorderTransferRegister.map((t) => (
                      <tr key={t.id}>
                        <td style={cell}>{t.destinationCountry}</td>
                        <td style={cell}>{t.legalBasis}</td>
                        <td style={cell}>{t.transferredAt.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

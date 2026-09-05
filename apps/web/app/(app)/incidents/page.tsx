'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  assessIncidentImpact,
  classifyIncident,
  closeIncident,
  containIncident,
  coSignIncident,
  createIncident,
  INCIDENT_REGULATORS,
  INCIDENT_SEVERITIES,
  listIncidents,
  notifyIncidentAffectedSubjects,
  notifyIncidentRegulators,
  notifyIncidentSeniorManagement,
  recoverIncident,
  type IncidentReport,
} from '../../../lib/compliance-risk/incident-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const REPORT_ROLES = [
  'SALES_RELATIONSHIP_OFFICER',
  'PLACEMENT_TECHNICAL_OFFICER',
  'CLAIMS_OFFICER',
  'FINANCE_COLLECTIONS_OFFICER',
  'COMPLIANCE_OFFICER',
  'BRANCH_DEPARTMENT_MANAGER',
  'SYSTEM_SECURITY_ADMINISTRATOR',
  'DATA_PROTECTION_OFFICER',
];
const CONTAIN_ROLES = ['SYSTEM_SECURITY_ADMINISTRATOR', 'COMPLIANCE_OFFICER'];
const CLASSIFY_ROLES = ['DATA_PROTECTION_OFFICER', 'EXECUTIVE_MANAGEMENT'];
const NOTIFY_REGULATOR_ROLES = ['DATA_PROTECTION_OFFICER', 'COMPLIANCE_OFFICER'];

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

export default function IncidentsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canReport = hasAny(user?.roles, REPORT_ROLES);
  const canContain = hasAny(user?.roles, CONTAIN_ROLES);
  const canClassify = hasAny(user?.roles, CLASSIFY_ROLES);
  // incident.classify is shared by DPO (classify) and Executive Management
  // (co-sign) — a review MINOR: showing the Classify buttons to an
  // Executive-Management-only user (or the Co-sign button to a DPO-only
  // user) offers a control the server will always 403, since the role
  // split is enforced beyond the coarse permission. Split visibility by the
  // SPECIFIC role each sub-action actually needs.
  const isDpo = hasAny(user?.roles, ['DATA_PROTECTION_OFFICER']);
  const isExec = hasAny(user?.roles, ['EXECUTIVE_MANAGEMENT']);
  const canNotifyRegulators = hasAny(user?.roles, NOTIFY_REGULATOR_ROLES);

  const [incidents, setIncidents] = useState<IncidentReport[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState(INCIDENT_SEVERITIES[2]);

  const [rootCauseDrafts, setRootCauseDrafts] = useState<Record<string, string>>({});
  const [regulatorDrafts, setRegulatorDrafts] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    try {
      setIncidents(await listIncidents());
      setLoadError(null);
    } catch (err) {
      setIncidents(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the incident.report permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load incidents — try again.',
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
      await createIncident({ title, description, severity });
      setTitle('');
      setDescription('');
    });
  }

  function toggleRegulator(incidentId: string, regulator: string) {
    setRegulatorDrafts((d) => {
      const current = d[incidentId] ?? [];
      const next = current.includes(regulator)
        ? current.filter((r) => r !== regulator)
        : [...current, regulator];
      return { ...d, [incidentId]: next };
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Incident Management</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Reported &rarr; Contained (4-hour target for critical) &rarr; Impact
        Assessed &rarr; Classified (Material needs a Data Protection Officer
        AND a separate Executive Management co-sign) &rarr; Notified &rarr;
        Recovered &rarr; Closed (root cause mandatory). One incident may
        trigger more than one regulator&apos;s notification obligation.
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

      {canReport ? (
        <form onSubmit={submit} style={formStyle}>
          <label style={labelStyle}>
            Title
            <input
              aria-label="Incident title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            Description
            <input
              aria-label="Incident description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            Severity
            <select
              aria-label="Severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              {INCIDENT_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Report incident'}
          </button>
        </form>
      ) : null}

      {incidents ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: '70rem' }}>
            <thead>
              <tr>
                <th style={head}>Title</th>
                <th style={head}>Severity</th>
                <th style={head}>Status</th>
                <th style={head}>Classification</th>
                <th style={head}>Action</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((inc) => (
                <tr key={inc.id}>
                  <td style={cell}>{inc.title}</td>
                  <td style={cell}>
                    {inc.severity}
                    {inc.isContainmentOverdue ? ' (containment overdue)' : ''}
                  </td>
                  <td style={cell}>{inc.status}</td>
                  <td style={cell}>{inc.classification}</td>
                  <td style={cell}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '20rem' }}>
                      {canContain && inc.status === 'REPORTED' ? (
                        <button type="button" disabled={busy} onClick={() => void run(() => containIncident(inc.id))}>
                          Contain
                        </button>
                      ) : null}
                      {canContain && inc.status === 'CONTAINED' ? (
                        <button type="button" disabled={busy} onClick={() => void run(() => assessIncidentImpact(inc.id))}>
                          Assess impact
                        </button>
                      ) : null}
                      {isDpo && inc.status === 'IMPACT_ASSESSED' ? (
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => classifyIncident(inc.id, 'MATERIAL'))}
                          >
                            Classify Material
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => classifyIncident(inc.id, 'NON_MATERIAL'))}
                          >
                            Classify Non-Material
                          </button>
                        </div>
                      ) : null}
                      {isExec &&
                      inc.status === 'CLASSIFIED' &&
                      inc.classification === 'MATERIAL' &&
                      !inc.seniorManagementCoSignUserId ? (
                        <button type="button" disabled={busy} onClick={() => void run(() => coSignIncident(inc.id))}>
                          Co-sign (Senior Management)
                        </button>
                      ) : null}
                      {canClassify &&
                      inc.classification === 'MATERIAL' &&
                      !inc.seniorManagementNotifiedAt ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => notifyIncidentSeniorManagement(inc.id))}
                        >
                          Notify Senior Management
                        </button>
                      ) : null}
                      {canNotifyRegulators && inc.status === 'CLASSIFIED' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          {INCIDENT_REGULATORS.map((r) => (
                            <label key={r} style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                              <input
                                type="checkbox"
                                aria-label={`Notify ${r} for ${inc.id}`}
                                checked={(regulatorDrafts[inc.id] ?? []).includes(r)}
                                onChange={() => toggleRegulator(inc.id, r)}
                              />
                              {r}
                            </label>
                          ))}
                          <button
                            type="button"
                            disabled={busy || (regulatorDrafts[inc.id] ?? []).length === 0}
                            onClick={() =>
                              void run(() =>
                                notifyIncidentRegulators(inc.id, regulatorDrafts[inc.id] ?? []),
                              )
                            }
                          >
                            Notify regulators
                          </button>
                        </div>
                      ) : null}
                      {canNotifyRegulators &&
                      inc.classification !== 'NOT_YET_CLASSIFIED' &&
                      !inc.affectedDataSubjectsNotifiedAt ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => notifyIncidentAffectedSubjects(inc.id))}
                        >
                          Notify affected subjects
                        </button>
                      ) : null}
                      {canContain && inc.status === 'NOTIFIED' ? (
                        <button type="button" disabled={busy} onClick={() => void run(() => recoverIncident(inc.id))}>
                          Recover
                        </button>
                      ) : null}
                      {canContain && inc.status === 'RECOVERED' ? (
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <input
                            aria-label={`Root cause analysis for ${inc.id}`}
                            placeholder="root cause analysis"
                            value={rootCauseDrafts[inc.id] ?? ''}
                            onChange={(e) =>
                              setRootCauseDrafts((d) => ({ ...d, [inc.id]: e.target.value }))
                            }
                          />
                          <button
                            type="button"
                            disabled={busy || !(rootCauseDrafts[inc.id] ?? '').trim()}
                            onClick={() =>
                              void run(() =>
                                closeIncident(inc.id, (rootCauseDrafts[inc.id] ?? '').trim()),
                              )
                            }
                          >
                            Close
                          </button>
                        </div>
                      ) : null}
                      {inc.status === 'CLOSED' ? '—' : null}
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

'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import type { IncidentSeverity } from '../../../lib/compliance-risk/incident-api';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
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
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';

const REPORT_ROLES = [
  'incident.report',
];
const CONTAIN_ROLES = [
  'incident.contain',
];
const CLASSIFY_ROLES = [
  'incident.classify',
];
const NOTIFY_REGULATOR_ROLES = [
  'incident.notify-regulator',
];

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid var(--border-default)' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '30rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };


export default function IncidentsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canReport = hasAnyPermission(user, REPORT_ROLES);
  const canContain = hasAnyPermission(user, CONTAIN_ROLES);
  const canClassify = hasAnyPermission(user, CLASSIFY_ROLES);
  // §10.4 has exactly one documented exception in this app, and it is here.
  // Classify and co-sign BOTH require incident.classify, so the permission
  // cannot distinguish them — but they are a maker/checker pair (DPO
  // classifies, Executive Management co-signs, assertDifferentActors enforces
  // it). Gating both on the shared permission would offer each user a control
  // the server will always refuse, which is the very thing §10.4 exists to
  // prevent. So these two stay ROLE checks deliberately: the role is the
  // finer-grained fact here, not a stale copy of the grid.
  const isDpo = !!user && user.roles.includes('DATA_PROTECTION_OFFICER');
  const isExec = !!user && user.roles.includes('EXECUTIVE_MANAGEMENT');
  const canNotifyRegulators = hasAnyPermission(user, NOTIFY_REGULATOR_ROLES);

  const [incidents, setIncidents] = useState<IncidentReport[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>(
    INCIDENT_SEVERITIES[2],
  );

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
          ? t('incNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('incLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('incActionError'));
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
      <h1>{t('incHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('incIntro')}
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
            {t('incTitleFieldLabel')}
            <input
              aria-label={t('incTitleLabel')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            {t('incDescriptionLabel')}
            <input
              aria-label={t('incDescriptionLabel')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            {t('incColSeverity')}
            <select
              aria-label={t('incColSeverity')}
              value={severity}
              onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
            >
              {INCIDENT_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {t(ENUM_LABEL.IncidentSeverity[s])}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy}>
            {busy ? t('incSavingButton') : t('incReportButton')}
          </button>
        </form>
      ) : null}

      {incidents ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: '70rem' }}>
            <thead>
              <tr>
                <th style={head}>{t('incColTitle')}</th>
                <th style={head}>{t('incColSeverity')}</th>
                <th style={head}>{t('incColStatus')}</th>
                <th style={head}>{t('incColClassification')}</th>
                <th style={head}>{t('incColAction')}</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((inc) => (
                <tr key={inc.id}>
                  <td style={cell}>{inc.title}</td>
                  <td style={cell}>
                    {t(ENUM_LABEL.IncidentSeverity[inc.severity])}
                    {inc.isContainmentOverdue ? ' (containment overdue)' : ''}
                  </td>
                  <td style={cell}>{t(ENUM_LABEL.IncidentStatus[inc.status])}</td>
                  <td style={cell}>{t(ENUM_LABEL.IncidentClassification[inc.classification])}</td>
                  <td style={cell}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '20rem' }}>
                      {canContain && inc.status === 'REPORTED' ? (
                        <button type="button" disabled={busy} onClick={() => void run(() => containIncident(inc.id))}>
                          {t('incContainButton')}
                        </button>
                      ) : null}
                      {canContain && inc.status === 'CONTAINED' ? (
                        <button type="button" disabled={busy} onClick={() => void run(() => assessIncidentImpact(inc.id))}>
                          {t('incAssessButton')}
                        </button>
                      ) : null}
                      {isDpo && inc.status === 'IMPACT_ASSESSED' ? (
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => classifyIncident(inc.id, 'MATERIAL'))}
                          >
                            {t('incClassifyMaterialButton')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => classifyIncident(inc.id, 'NON_MATERIAL'))}
                          >
                            {t('incClassifyNonMaterialButton')}
                          </button>
                        </div>
                      ) : null}
                      {isExec &&
                      inc.status === 'CLASSIFIED' &&
                      inc.classification === 'MATERIAL' &&
                      !inc.seniorManagementCoSignUserId ? (
                        <button type="button" disabled={busy} onClick={() => void run(() => coSignIncident(inc.id))}>
                          {t('incCoSignButton')}
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
                          {t('incNotifySeniorButton')}
                        </button>
                      ) : null}
                      {canNotifyRegulators && inc.status === 'CLASSIFIED' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          {INCIDENT_REGULATORS.map((r) => (
                            <label key={r} style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                              <input
                                type="checkbox"
                                aria-label={t('incNotifyRoleAria', { role: r, id: inc.id })}
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
                            {t('incNotifyRegulatorsButton')}
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
                          {t('incNotifySubjectsButton')}
                        </button>
                      ) : null}
                      {canContain && inc.status === 'NOTIFIED' ? (
                        <button type="button" disabled={busy} onClick={() => void run(() => recoverIncident(inc.id))}>
                          {t('incRecoverButton')}
                        </button>
                      ) : null}
                      {canContain && inc.status === 'RECOVERED' ? (
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <input
                            aria-label={t('incRootCauseAria', { id: inc.id })}
                            placeholder={t('incRootCauseLabel')}
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
                            {t('incCloseButton')}
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
      ) : loadError ? null : (
        // The loading state directive §2 requires; this page rendered
        // nothing at all while fetching. Guarded on loadError so an error
        // and a "Loading…" line never appear together.
        <p>{t('incLoading')}</p>
      )}
    </main>
  );
}

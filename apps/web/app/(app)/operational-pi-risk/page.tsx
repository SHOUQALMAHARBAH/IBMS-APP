'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import type { RiskRegisterType } from '../../../lib/compliance-risk/risk-register-api';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  closeRiskRegisterItem,
  createRiskRegisterItem,
  listRiskRegisterItems,
  recordRiskRegisterMitigation,
  RISK_REGISTER_TYPES,
  type RiskRegisterItem,
} from '../../../lib/compliance-risk/risk-register-api';
import {
  createPiPolicy,
  listPiPolicies,
  recordPiClaimsHistory,
  type PiPolicy,
} from '../../../lib/compliance-risk/pi-policy-api';
import {
  listPiRiskEvents,
  logPiRiskEvent,
  recordPiRiskEventMitigation,
  type PiRiskEvent,
} from '../../../lib/compliance-risk/pi-risk-event-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';

const RISK_REGISTER_ROLE = [
  'risk-register.manage',
];
const PI_POLICY_ROLE = [
  'pi-policy.manage',
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


export default function OperationalPiRiskPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canManageRiskRegister = hasAnyPermission(user, RISK_REGISTER_ROLE);
  const canManagePiPolicy = hasAnyPermission(user, PI_POLICY_ROLE);

  const [risks, setRisks] = useState<RiskRegisterItem[] | null>(null);
  const [risksError, setRisksError] = useState<string | null>(null);
  const [policies, setPolicies] = useState<PiPolicy[] | null>(null);
  const [policiesError, setPoliciesError] = useState<string | null>(null);
  const [events, setEvents] = useState<PiRiskEvent[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [riskType, setRiskType] = useState<RiskRegisterType>(
    RISK_REGISTER_TYPES[0],
  );
  const [riskDescription, setRiskDescription] = useState('');
  const [mitigationDrafts, setMitigationDrafts] = useState<Record<string, string>>({});

  const [insurerName, setInsurerName] = useState('');
  const [coverageLimit, setCoverageLimit] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [claimsHistoryDrafts, setClaimsHistoryDrafts] = useState<Record<string, string>>({});

  const [eventDescription, setEventDescription] = useState('');
  const [eventPiPolicyId, setEventPiPolicyId] = useState('');
  const [eventMitigationDrafts, setEventMitigationDrafts] = useState<Record<string, string>>({});

  const loadRisks = useCallback(async () => {
    try {
      setRisks(await listRiskRegisterItems());
      setRisksError(null);
    } catch (err) {
      setRisks(null);
      setRisksError(
        err instanceof ApiError && err.status === 403
          ? t('opNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('opRegisterLoadError'),
      );
    }
  }, [t]);

  const loadPolicies = useCallback(async () => {
    try {
      setPolicies(await listPiPolicies());
      setPoliciesError(null);
    } catch (err) {
      setPolicies(null);
      setPoliciesError(
        err instanceof ApiError && err.status === 403
          ? t('opNoPermissionPi')
          : err instanceof ApiError
            ? err.message
            : t('opPiLoadError'),
      );
    }
  }, [t]);

  const loadEvents = useCallback(async () => {
    try {
      setEvents(await listPiRiskEvents());
      setEventsError(null);
    } catch (err) {
      setEvents(null);
      setEventsError(
        err instanceof ApiError && err.status === 403
          ? t('opNoPermissionPi')
          : err instanceof ApiError
            ? err.message
            : t('opEventsLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadRisks();
      await loadPolicies();
      await loadEvents();
    })();
  }, [user, loadRisks, loadPolicies, loadEvents, t]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await loadRisks();
      await loadPolicies();
      await loadEvents();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('opActionError'));
    } finally {
      setBusy(false);
    }
  }

  async function submitRisk(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createRiskRegisterItem({ riskType, description: riskDescription });
      setRiskDescription('');
    });
  }

  async function submitPolicy(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createPiPolicy({ insurerName, coverageLimit, expiresAt });
      setInsurerName('');
      setCoverageLimit('');
      setExpiresAt('');
    });
  }

  async function submitEvent(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await logPiRiskEvent({
        description: eventDescription,
        piPolicyId: eventPiPolicyId.trim() || undefined,
      });
      setEventDescription('');
      setEventPiPolicyId('');
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('opHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('opIntro')}
      </p>

      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}

      <h2>{t('opRegisterHeading')}</h2>
      {risksError ? (
        <p role="alert" style={errorStyle}>
          {risksError}
        </p>
      ) : null}
      {canManageRiskRegister ? (
        <form onSubmit={submitRisk} style={formStyle}>
          <label style={labelStyle}>
            {t('opRiskTypeLabel')}
            <select
              aria-label={t('opRiskTypeLabel')}
              value={riskType}
              onChange={(e) => setRiskType(e.target.value as RiskRegisterType)}
            >
              {RISK_REGISTER_TYPES.map((opt) => (
                <option key={opt} value={opt}>
                  {t(ENUM_LABEL.RiskRegisterType[opt])}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            {t('opRiskDescriptionFieldLabel')}
            <input
              aria-label={t('opRiskDescriptionLabel')}
              value={riskDescription}
              onChange={(e) => setRiskDescription(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? t('opSavingButton') : t('opLogRiskButton')}
          </button>
        </form>
      ) : null}
      {risks ? (
        <table style={{ borderCollapse: 'collapse', minWidth: '50rem' }}>
          <thead>
            <tr>
              <th style={head}>{t('opColType')}</th>
              <th style={head}>{t('opRiskDescriptionLabel')}</th>
              <th style={head}>{t('opColMitigation')}</th>
              <th style={head}>{t('opColStatus')}</th>
              <th style={head}>{t('opColAction')}</th>
            </tr>
          </thead>
          <tbody>
            {risks.length === 0 ? (
              <tr>
                <td style={cell} colSpan={5}>
                  {t('opNoRisks')}
                </td>
              </tr>
            ) : null}
            {risks.map((r) => (
              <tr key={r.id}>
                <td style={cell}>{r.riskType}</td>
                <td style={cell}>{r.description}</td>
                <td style={cell}>{r.mitigationAction ?? '—'}</td>
                <td style={cell}>{t(ENUM_LABEL.TransactionMonitoringStatus[r.status])}</td>
                <td style={cell}>
                  {canManageRiskRegister && r.status === 'open' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '14rem' }}>
                      <input
                        aria-label={t('opMitigationRowAria', { id: r.id })}
                        placeholder={t('opMitigationActionLabel')}
                        value={mitigationDrafts[r.id] ?? ''}
                        onChange={(e) =>
                          setMitigationDrafts((d) => ({ ...d, [r.id]: e.target.value }))
                        }
                      />
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <button
                          type="button"
                          disabled={busy || !(mitigationDrafts[r.id] ?? '').trim()}
                          onClick={() =>
                            void run(() =>
                              recordRiskRegisterMitigation(r.id, (mitigationDrafts[r.id] ?? '').trim()),
                            )
                          }
                        >
                          {t('opSaveMitigationButton')}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => closeRiskRegisterItem(r.id))}
                        >
                          {t('opCloseButton')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h2>{t('opPiHeading')}</h2>
      {policiesError ? (
        <p role="alert" style={errorStyle}>
          {policiesError}
        </p>
      ) : null}
      {canManagePiPolicy ? (
        <form onSubmit={submitPolicy} style={formStyle}>
          <label style={labelStyle}>
            {t('opPiInsurerFieldLabel')}
            <input
              aria-label={t('opPiInsurerLabel')}
              dir="auto"
              value={insurerName}
              onChange={(e) => setInsurerName(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            {t('opPiCoverageLimitLabel')}
            <input
              aria-label={t('opPiCoverageLimitLabel')}
              value={coverageLimit}
              onChange={(e) => setCoverageLimit(e.target.value)}
              placeholder="1000000.000"
              required
            />
          </label>
          <label style={labelStyle}>
            {t('opPiExpiresFieldLabel')}
            <input
              aria-label={t('opPiExpiresAtLabel')}
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? t('commonSaving') : t('opLogPiButton')}
          </button>
        </form>
      ) : null}
      {policies ? (
        <table style={{ borderCollapse: 'collapse', minWidth: '55rem' }}>
          <thead>
            <tr>
              <th style={head}>{t('opColInsurer')}</th>
              <th style={head}>{t('opColCoverageLimit')}</th>
              <th style={head}>{t('opExpires')}</th>
              <th style={head}>{t('opColClaimsHistory')}</th>
              <th style={head}>{t('opColStatus')}</th>
              {canManagePiPolicy ? <th style={head}>{t('opColAction')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {policies.length === 0 ? (
              <tr>
                <td style={cell} colSpan={5}>
                  {t('opNoPiPolicy')}
                </td>
              </tr>
            ) : null}
            {policies.map((p) => (
              <tr key={p.id}>
                <td style={cell}>
                  <bdi>{p.insurerName}</bdi>
                </td>
                <td style={cell}>{p.coverageLimit}</td>
                <td style={cell}>{p.expiresAt.slice(0, 10)}</td>
                <td style={cell}>{p.claimsHistorySummary ?? '—'}</td>
                <td style={cell}>
                  {p.isCurrent ? 'current' : 'past'}
                  {p.isCurrentlyLapsed ? ' (lapsed)' : ''}
                </td>
                {canManagePiPolicy ? (
                  <td style={cell}>
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      <input
                        aria-label={t('opClaimsHistoryRowAria', { id: p.id })}
                        placeholder={t('opClaimsHistoryLabel')}
                        value={claimsHistoryDrafts[p.id] ?? ''}
                        onChange={(e) =>
                          setClaimsHistoryDrafts((d) => ({ ...d, [p.id]: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        disabled={busy || !(claimsHistoryDrafts[p.id] ?? '').trim()}
                        onClick={() =>
                          void run(() =>
                            recordPiClaimsHistory(p.id, (claimsHistoryDrafts[p.id] ?? '').trim()),
                          )
                        }
                      >
                        {t('opSaveButton')}
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h2>{t('opEventsHeading')}</h2>
      {eventsError ? (
        <p role="alert" style={errorStyle}>
          {eventsError}
        </p>
      ) : null}
      {canManagePiPolicy ? (
        <form onSubmit={submitEvent} style={formStyle}>
          <label style={labelStyle}>
            {t('opEventDescriptionFieldLabel')}
            <input
              aria-label={t('opEventDescriptionLabel')}
              value={eventDescription}
              onChange={(e) => setEventDescription(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            {t('opEventPolicyIdLabel')}
            <input
              aria-label={t('opEventPolicyIdLabel')}
              value={eventPiPolicyId}
              onChange={(e) => setEventPiPolicyId(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? t('commonSaving') : t('opLogEventButton')}
          </button>
        </form>
      ) : null}
      {events ? (
        <table style={{ borderCollapse: 'collapse', minWidth: '55rem' }}>
          <thead>
            <tr>
              <th style={head}>{t('opRiskDescriptionLabel')}</th>
              <th style={head}>{t('opColSource')}</th>
              <th style={head}>{t('opColMitigation')}</th>
              {canManagePiPolicy ? <th style={head}>{t('opColAction')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td style={cell} colSpan={4}>
                  {t('opNoEvents')}
                </td>
              </tr>
            ) : null}
            {events.map((ev) => (
              <tr key={ev.id}>
                <td style={cell}>{ev.description}</td>
                <td style={cell}>
                  {ev.isAutoLogged ? t('opSourcePolicyCheckingDiscrepancy') : 'manual'}
                </td>
                <td style={cell}>{ev.mitigationAction ?? '—'}</td>
                {canManagePiPolicy ? (
                  <td style={cell}>
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      <input
                        aria-label={t('opEventMitigationAria', { id: ev.id })}
                        placeholder={t('opMitigationActionLabel')}
                        value={eventMitigationDrafts[ev.id] ?? ''}
                        onChange={(e) =>
                          setEventMitigationDrafts((d) => ({ ...d, [ev.id]: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        disabled={busy || !(eventMitigationDrafts[ev.id] ?? '').trim()}
                        onClick={() =>
                          void run(() =>
                            recordPiRiskEventMitigation(
                              ev.id,
                              (eventMitigationDrafts[ev.id] ?? '').trim(),
                            ),
                          )
                        }
                      >
                        Save
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : eventsError ? null : (
        // The loading state directive §2 requires; this page rendered
        // nothing at all while fetching. Guarded on loadError so an error
        // and a "Loading…" line never appear together.
        <p>{t('opLoading')}</p>
      )}
    </main>
  );
}

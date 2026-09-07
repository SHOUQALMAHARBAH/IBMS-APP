'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
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

const RISK_REGISTER_ROLE = ['COMPLIANCE_OFFICER', 'BRANCH_DEPARTMENT_MANAGER'];
const PI_POLICY_ROLE = ['COMPLIANCE_OFFICER'];

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

export default function OperationalPiRiskPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canManageRiskRegister = hasAny(user?.roles, RISK_REGISTER_ROLE);
  const canManagePiPolicy = hasAny(user?.roles, PI_POLICY_ROLE);

  const [risks, setRisks] = useState<RiskRegisterItem[] | null>(null);
  const [risksError, setRisksError] = useState<string | null>(null);
  const [policies, setPolicies] = useState<PiPolicy[] | null>(null);
  const [policiesError, setPoliciesError] = useState<string | null>(null);
  const [events, setEvents] = useState<PiRiskEvent[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [riskType, setRiskType] = useState(RISK_REGISTER_TYPES[0]);
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
          ? "You don't hold the risk-register.manage permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the risk register — try again.',
      );
    }
  }, []);

  const loadPolicies = useCallback(async () => {
    try {
      setPolicies(await listPiPolicies());
      setPoliciesError(null);
    } catch (err) {
      setPolicies(null);
      setPoliciesError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the pi-policy.manage permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the PI policy record — try again.',
      );
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      setEvents(await listPiRiskEvents());
      setEventsError(null);
    } catch (err) {
      setEvents(null);
      setEventsError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the pi-policy.manage permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load PI risk events — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadRisks();
      await loadPolicies();
      await loadEvents();
    })();
  }, [user, loadRisks, loadPolicies, loadEvents]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await loadRisks();
      await loadPolicies();
      await loadEvents();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'That action failed — try again.');
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
      <h1>Operational &amp; Professional Indemnity Risk</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        A generic risk register across operational / cyber / financial /
        compliance / reputational exposures, plus the broker&apos;s own
        Professional Indemnity policy and the risk events tracked against
        it — a broker without valid PI cover is itself a licensing breach.
      </p>

      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}

      <h2>Risk register</h2>
      {risksError ? (
        <p role="alert" style={errorStyle}>
          {risksError}
        </p>
      ) : null}
      {canManageRiskRegister ? (
        <form onSubmit={submitRisk} style={formStyle}>
          <label style={labelStyle}>
            Risk type
            <select
              aria-label="Risk type"
              value={riskType}
              onChange={(e) => setRiskType(e.target.value)}
            >
              {RISK_REGISTER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Description
            <input
              aria-label="Risk description"
              value={riskDescription}
              onChange={(e) => setRiskDescription(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Log risk'}
          </button>
        </form>
      ) : null}
      {risks ? (
        <table style={{ borderCollapse: 'collapse', minWidth: '50rem' }}>
          <thead>
            <tr>
              <th style={head}>Type</th>
              <th style={head}>Description</th>
              <th style={head}>Mitigation</th>
              <th style={head}>Status</th>
              <th style={head}>Action</th>
            </tr>
          </thead>
          <tbody>
            {risks.map((r) => (
              <tr key={r.id}>
                <td style={cell}>{r.riskType}</td>
                <td style={cell}>{r.description}</td>
                <td style={cell}>{r.mitigationAction ?? '—'}</td>
                <td style={cell}>{r.status}</td>
                <td style={cell}>
                  {canManageRiskRegister && r.status === 'open' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '14rem' }}>
                      <input
                        aria-label={`Mitigation for ${r.id}`}
                        placeholder="mitigation action"
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
                          Save mitigation
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => closeRiskRegisterItem(r.id))}
                        >
                          Close
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

      <h2>Professional Indemnity policy</h2>
      {policiesError ? (
        <p role="alert" style={errorStyle}>
          {policiesError}
        </p>
      ) : null}
      {canManagePiPolicy ? (
        <form onSubmit={submitPolicy} style={formStyle}>
          <label style={labelStyle}>
            Insurer
            <input
              aria-label="PI insurer name"
              value={insurerName}
              onChange={(e) => setInsurerName(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            Coverage limit (JOD)
            <input
              aria-label="PI coverage limit"
              value={coverageLimit}
              onChange={(e) => setCoverageLimit(e.target.value)}
              placeholder="1000000.000"
              required
            />
          </label>
          <label style={labelStyle}>
            Expires
            <input
              aria-label="PI expires at"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Log PI policy'}
          </button>
        </form>
      ) : null}
      {policies ? (
        <table style={{ borderCollapse: 'collapse', minWidth: '55rem' }}>
          <thead>
            <tr>
              <th style={head}>Insurer</th>
              <th style={head}>Coverage limit</th>
              <th style={head}>Expires</th>
              <th style={head}>Claims history</th>
              <th style={head}>Status</th>
              {canManagePiPolicy ? <th style={head}>Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.id}>
                <td style={cell}>{p.insurerName}</td>
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
                        aria-label={`Claims history for ${p.id}`}
                        placeholder="claims history summary"
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
                        Save
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h2>PI risk events</h2>
      {eventsError ? (
        <p role="alert" style={errorStyle}>
          {eventsError}
        </p>
      ) : null}
      {canManagePiPolicy ? (
        <form onSubmit={submitEvent} style={formStyle}>
          <label style={labelStyle}>
            Description
            <input
              aria-label="PI risk event description"
              value={eventDescription}
              onChange={(e) => setEventDescription(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            PI policy id (optional — defaults to the current one)
            <input
              aria-label="PI risk event policy id"
              value={eventPiPolicyId}
              onChange={(e) => setEventPiPolicyId(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Log risk event'}
          </button>
        </form>
      ) : null}
      {events ? (
        <table style={{ borderCollapse: 'collapse', minWidth: '55rem' }}>
          <thead>
            <tr>
              <th style={head}>Description</th>
              <th style={head}>Source</th>
              <th style={head}>Mitigation</th>
              {canManagePiPolicy ? <th style={head}>Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id}>
                <td style={cell}>{ev.description}</td>
                <td style={cell}>
                  {ev.isAutoLogged ? 'Policy Checking discrepancy' : 'manual'}
                </td>
                <td style={cell}>{ev.mitigationAction ?? '—'}</td>
                {canManagePiPolicy ? (
                  <td style={cell}>
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      <input
                        aria-label={`Mitigation for event ${ev.id}`}
                        placeholder="mitigation action"
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
      ) : null}
    </main>
  );
}

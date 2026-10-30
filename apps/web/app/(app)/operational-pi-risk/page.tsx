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
import {
  Card,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

const RISK_REGISTER_ROLE = [
  'risk-register.manage',
];
const PI_POLICY_ROLE = [
  'pi-policy.manage',
];

const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: 'var(--space-2)', maxWidth: '30rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' };


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
          ? permissionRefusal(t, 'opRefusalAct', 'risk-register.manage')
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
          ? permissionRefusal(t, 'opPiRefusalAct', 'pi-policy.manage')
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
          ? permissionRefusal(t, 'opPiRefusalAct', 'pi-policy.manage')
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
    <main style={pageStackStyle}>
      <PageHeader
        title={t('opHeading')}
        description={t('opIntro')}
      />

      {actionError ? (
        <ErrorState title={actionError} />
      ) : null}

      <h2>{t('opRegisterHeading')}</h2>
      {risksError ? (
        <ErrorState title={risksError} />
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
            {t('opRiskDescriptionLabel')}
            <input
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
        <Card padded={false}>
            <Table>
          <thead>
            <tr>
              <Th>{t('opColType')}</Th>
              <Th>{t('opRiskDescriptionLabel')}</Th>
              <Th>{t('opColMitigation')}</Th>
              <Th>{t('opColStatus')}</Th>
              <Th>{t('opColAction')}</Th>
            </tr>
          </thead>
          <tbody>
            {risks.length === 0 ? (
              <Tr>
                <Td colSpan={5}>
                  {t('opNoRisks')}
                </Td>
              </Tr>
            ) : null}
            {risks.map((r) => (
              <Tr key={r.id}>
                <Td>{r.riskType}</Td>
                <Td>{r.description}</Td>
                <Td>{r.mitigationAction ?? '—'}</Td>
                <Td>{t(ENUM_LABEL.TransactionMonitoringStatus[r.status])}</Td>
                <Td>
                  {canManageRiskRegister && r.status === 'open' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: '14rem' }}>
                      <input
                        aria-label={t('opMitigationRowAria')}
                        placeholder={t('opMitigationActionLabel')}
                        value={mitigationDrafts[r.id] ?? ''}
                        onChange={(e) =>
                          setMitigationDrafts((d) => ({ ...d, [r.id]: e.target.value }))
                        }
                      />
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
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
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
          </Card>
      ) : null}

      <h2>{t('opPiHeading')}</h2>
      {policiesError ? (
        <ErrorState title={policiesError} />
      ) : null}
      {canManagePiPolicy ? (
        <form onSubmit={submitPolicy} style={formStyle}>
          <label style={labelStyle}>
            {t('opPiInsurerLabel')}
            <input
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
        <Card padded={false}>
            <Table>
          <thead>
            <tr>
              <Th>{t('opColInsurer')}</Th>
              <Th>{t('opColCoverageLimit')}</Th>
              <Th>{t('opExpires')}</Th>
              <Th>{t('opColClaimsHistory')}</Th>
              <Th>{t('opColStatus')}</Th>
              {canManagePiPolicy ? <Th>{t('opColAction')}</Th> : null}
            </tr>
          </thead>
          <tbody>
            {policies.length === 0 ? (
              <Tr>
                <Td colSpan={5}>
                  {t('opNoPiPolicy')}
                </Td>
              </Tr>
            ) : null}
            {policies.map((p) => (
              <Tr key={p.id}>
                <Td>
                  <bdi>{p.insurerName}</bdi>
                </Td>
                <Td>{p.coverageLimit}</Td>
                <Td>{p.expiresAt.slice(0, 10)}</Td>
                <Td>{p.claimsHistorySummary ?? '—'}</Td>
                <Td>
                  {/* OWNER DECISION 55's WORDING TRAP, and it must not be 'improved' away: a PI record
                      can be the CURRENT one while its cover has LAPSED — which is exactly the state
                      the marker below reports. «الحالية» speaks about the RECORD; «سارية» would
                      speak about the COVER, and «سارية (التغطية منتهية)» is a contradiction on one
                      line. */}
                  {p.isCurrent ? t('statusRecordCurrent') : t('statusRecordPast')}
                  {p.isCurrentlyLapsed ? ` ${t('statusCoverLapsed')}` : ''}
                </Td>
                {canManagePiPolicy ? (
                  <Td>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <input
                        aria-label={t('opClaimsHistoryRowAria')}
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
                  </Td>
                ) : null}
              </Tr>
            ))}
          </tbody>
        </Table>
          </Card>
      ) : null}

      <h2>{t('opEventsHeading')}</h2>
      {eventsError ? (
        <ErrorState title={eventsError} />
      ) : null}
      {canManagePiPolicy ? (
        <form onSubmit={submitEvent} style={formStyle}>
          <label style={labelStyle}>
            {t('opEventDescriptionLabel')}
            <input
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
        <Card padded={false}>
            <Table>
          <thead>
            <tr>
              <Th>{t('opRiskDescriptionLabel')}</Th>
              <Th>{t('opColSource')}</Th>
              <Th>{t('opColMitigation')}</Th>
              {canManagePiPolicy ? <Th>{t('opColAction')}</Th> : null}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <Tr>
                <Td colSpan={4}>
                  {t('opNoEvents')}
                </Td>
              </Tr>
            ) : null}
            {events.map((ev) => (
              <Tr key={ev.id}>
                <Td>{ev.description}</Td>
                <Td>
                  {ev.isAutoLogged
                    ? t('opSourcePolicyCheckingDiscrepancy')
                    : t('opSourceManual')}
                </Td>
                <Td>{ev.mitigationAction ?? '—'}</Td>
                {canManagePiPolicy ? (
                  <Td>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <input
                        aria-label={t('opEventMitigationAria')}
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
                        {t('commonSave')}
                      </button>
                    </div>
                  </Td>
                ) : null}
              </Tr>
            ))}
          </tbody>
        </Table>
          </Card>
      ) : eventsError ? null : (
        // The loading state directive §2 requires; this page rendered
        // nothing at all while fetching. Guarded on loadError so an error
        // and a "Loading…" line never appear together.
        <SkeletonList rows={4} label={t('opLoading')} />
      )}
    </main>
  );
}

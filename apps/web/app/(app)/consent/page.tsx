'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  CONSENT_PURPOSES,
  confirmConsentWithdrawal,
  createConsentRecord,
  listConsentRecords,
  requestConsentWithdrawal,
  type ConsentRecord,
} from '../../../lib/pdpl/consent-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';


const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};

export default function ConsentPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canManage = hasPermission(user, 'consent.manage');

  const [rows, setRows] = useState<ConsentRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [ownerKind, setOwnerKind] = useState<
    'customer' | 'insuredPerson' | 'lead'
  >('customer');
  const [ownerId, setOwnerId] = useState('');
  const [purpose, setPurpose] = useState<string>(CONSENT_PURPOSES[2]); // MARKETING
  const [decision, setDecision] = useState<'grant' | 'decline'>('grant');
  const [consentTextVersion, setConsentTextVersion] = useState('');
  const [filterCustomerId, setFilterCustomerId] = useState('');

  const load = useCallback(async (customerId?: string) => {
    try {
      setRows(await listConsentRecords(customerId ? { customerId } : {}));
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('consNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('consLoadError'),
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

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await createConsentRecord({
        ...(ownerKind === 'customer'
          ? { customerId: ownerId.trim() }
          : ownerKind === 'insuredPerson'
            ? { insuredPersonId: ownerId.trim() }
            : { leadId: ownerId.trim() }),
        purpose,
        granted: decision === 'grant',
        consentTextVersion: consentTextVersion.trim(),
      });
      setOwnerId('');
      setConsentTextVersion('');
      await load(filterCustomerId.trim() || undefined);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('consSubmitError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function onRequestWithdrawal(id: string) {
    setBusyId(id);
    setActionError(null);
    setNotice(null);
    try {
      const res = await requestConsentWithdrawal(id);
      setNotice(
        `Withdrawal request logged for ${id.slice(0, 8)}… — reflect it in the register by ${
          res.dueAt ? res.dueAt.slice(0, 10) : 'the SLA deadline'
        }.`,
      );
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('consRequestError'),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function onConfirmWithdrawal(id: string) {
    setBusyId(id);
    setActionError(null);
    setNotice(null);
    try {
      await confirmConsentWithdrawal(id);
      await load(filterCustomerId.trim() || undefined);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('consWithdrawError'),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function onFilter(ev: React.FormEvent) {
    ev.preventDefault();
    await load(filterCustomerId.trim() || undefined);
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('consHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('consIntro')}
      </p>

      {canManage ? (
        <form
          onSubmit={submit}
          style={{
            margin: '1rem 0',
            display: 'grid',
            gap: '0.4rem',
            maxWidth: '30rem',
          }}
        >
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            {t('consDataSubjectFieldLabel')}
            <select
              aria-label={t('consDataSubjectKindLabel')}
              value={ownerKind}
              onChange={(e) =>
                setOwnerKind(
                  e.target.value as 'customer' | 'insuredPerson' | 'lead',
                )
              }
            >
              <option value="customer">{t('consKindCustomer')}</option>
              <option value="insuredPerson">{t('consKindInsuredPerson')}</option>
              <option value="lead">{t('consKindLead')}</option>
            </select>
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            {ownerKind === 'customer'
              ? t('consCustomerIdLabel')
              : ownerKind === 'insuredPerson'
                ? t('consInsuredPersonIdLabel')
                : t('consLeadIdLabel')}
            <input
              aria-label={
                ownerKind === 'customer'
                  ? 'Customer ID'
                  : ownerKind === 'insuredPerson'
                    ? 'Insured person ID'
                    : 'Lead ID'
              }
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              required
            />
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            {t('consPurposeLabel')}
            <select
              aria-label={t('consPurposeLabel')}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            >
              {CONSENT_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            {t('consDecisionLabel')}
            <select
              aria-label={t('consDecisionLabel')}
              value={decision}
              onChange={(e) => setDecision(e.target.value as 'grant' | 'decline')}
            >
              <option value="grant">{t('consGrant')}</option>
              <option value="decline">{t('consDecline')}</option>
            </select>
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            {t('consTextVersionLabel')}
            <input
              aria-label={t('consTextVersionLabel')}
              placeholder={t('consTextVersionPlaceholder')}
              value={consentTextVersion}
              onChange={(e) => setConsentTextVersion(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy ? t('consSavingButton') : t('consRecordButton')}
          </button>
        </form>
      ) : null}

      <form
        onSubmit={onFilter}
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', margin: '1rem 0' }}
      >
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
        >
          {t('consFilterLabel')}
          <input
            aria-label={t('consFilterLabel')}
            value={filterCustomerId}
            onChange={(e) => setFilterCustomerId(e.target.value)}
          />
        </label>
        <button type="submit">{t('consFilterButton')}</button>
      </form>

      {notice ? <p style={{ opacity: 0.8 }}>{notice}</p> : null}
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
          <p style={{ color: 'var(--ink-secondary)' }}>{t('consNone')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '56rem' }}>
              <thead>
                <tr>
                  <th style={head}>{t('consDataSubjectLabel')}</th>
                  <th style={head}>{t('consPurposeLabel')}</th>
                  <th style={head}>{t('consColMarketing')}</th>
                  <th style={head}>{t('consDecisionLabel')}</th>
                  <th style={head}>{t('consColStatus')}</th>
                  <th style={head}>{t('consColTextVersion')}</th>
                  <th style={head}>{t('consColActions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>
                      {r.leadId
                        ? `Lead ${r.leadId.slice(0, 8)}…`
                        : `${(r.customerId ?? r.insuredPersonId ?? '—').slice(0, 8)}…`}
                    </td>
                    <td style={cell}>{r.purpose}</td>
                    <td style={cell}>{r.isMarketing ? 'Yes' : 'No'}</td>
                    <td style={cell}>{r.granted ? t('consStatusGranted') : t('consStatusDeclined')}</td>
                    <td style={cell}>
                      {r.withdrawnAt
                        ? `Withdrawn ${r.withdrawnAt.slice(0, 10)}`
                        : r.isActive
                          ? 'Active'
                          : t('consStatusNeverGranted')}
                    </td>
                    <td style={cell}>{r.consentTextVersion}</td>
                    <td style={cell}>
                      {canManage && r.isActive ? (
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void onRequestWithdrawal(r.id)}
                          >
                            {t('consRequestWithdrawal')}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void onConfirmWithdrawal(r.id)}
                          >
                            {t('consConfirmWithdrawal')}
                          </button>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        // This page previously rendered NOTHING while fetching — one of the
        // four states directive §2 requires. Guarded on loadError so the
        // error and a "Loading…" line cannot appear together.
        <p>{t('consLoading')}</p>
      )}
    </main>
  );
}

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

const CONSENT_ROLES = [
  'SALES_RELATIONSHIP_OFFICER',
  'PLACEMENT_TECHNICAL_OFFICER',
  'CLAIMS_OFFICER',
  'DATA_PROTECTION_OFFICER',
];

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

export default function ConsentPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canManage = !!user && user.roles.some((r) => CONSENT_ROLES.includes(r));

  const [rows, setRows] = useState<ConsentRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [ownerKind, setOwnerKind] = useState<'customer' | 'insuredPerson'>(
    'customer',
  );
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
          ? "You don't hold the consent.manage permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load consent records — try again.',
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

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await createConsentRecord({
        ...(ownerKind === 'customer'
          ? { customerId: ownerId.trim() }
          : { insuredPersonId: ownerId.trim() }),
        purpose,
        granted: decision === 'grant',
        consentTextVersion: consentTextVersion.trim(),
      });
      setOwnerId('');
      setConsentTextVersion('');
      await load(filterCustomerId.trim() || undefined);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'The submit failed — try again.',
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
        err instanceof ApiError ? err.message : 'The request failed — try again.',
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
        err instanceof ApiError ? err.message : 'The withdrawal failed — try again.',
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
      <h1>Consent management</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Capture a consent decision (grant or explicit decline) at a defined
        touchpoint. Consent and contractual-necessity processing are always
        two separate, independently-actionable controls (PRIV-SOP-04) —
        marketing consent is never combined with any other purpose. Withdrawal
        is a two-step flow: request it (starts a 2-business-day SLA clock),
        then confirm it (reflects it in the register and, for a MARKETING
        consent, immediately blocks further marketing sends).
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
            Data subject
            <select
              aria-label="Data subject kind"
              value={ownerKind}
              onChange={(e) =>
                setOwnerKind(e.target.value as 'customer' | 'insuredPerson')
              }
            >
              <option value="customer">Customer</option>
              <option value="insuredPerson">Insured person</option>
            </select>
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            {ownerKind === 'customer' ? 'Customer ID' : 'Insured person ID'}
            <input
              aria-label={ownerKind === 'customer' ? 'Customer ID' : 'Insured person ID'}
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              required
            />
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            Purpose
            <select
              aria-label="Purpose"
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
            Decision
            <select
              aria-label="Decision"
              value={decision}
              onChange={(e) => setDecision(e.target.value as 'grant' | 'decline')}
            >
              <option value="grant">Grant</option>
              <option value="decline">Decline</option>
            </select>
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            Consent text version
            <input
              aria-label="Consent text version"
              placeholder="e.g. privacy-notice-v1.2"
              value={consentTextVersion}
              onChange={(e) => setConsentTextVersion(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy ? 'Saving…' : 'Record decision'}
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
          Filter by customer ID
          <input
            aria-label="Filter by customer ID"
            value={filterCustomerId}
            onChange={(e) => setFilterCustomerId(e.target.value)}
          />
        </label>
        <button type="submit">Filter</button>
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
          <p style={{ opacity: 0.6 }}>No consent records.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '56rem' }}>
              <thead>
                <tr>
                  <th style={head}>Data subject</th>
                  <th style={head}>Purpose</th>
                  <th style={head}>Marketing</th>
                  <th style={head}>Decision</th>
                  <th style={head}>Status</th>
                  <th style={head}>Text version</th>
                  <th style={head}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>
                      {(r.customerId ?? r.insuredPersonId ?? '—').slice(0, 8)}…
                    </td>
                    <td style={cell}>{r.purpose}</td>
                    <td style={cell}>{r.isMarketing ? 'Yes' : 'No'}</td>
                    <td style={cell}>{r.granted ? 'Granted' : 'Declined'}</td>
                    <td style={cell}>
                      {r.withdrawnAt
                        ? `Withdrawn ${r.withdrawnAt.slice(0, 10)}`
                        : r.isActive
                          ? 'Active'
                          : 'Never granted'}
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
                            Request withdrawal
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void onConfirmWithdrawal(r.id)}
                          >
                            Confirm withdrawal
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
      ) : null}
    </main>
  );
}

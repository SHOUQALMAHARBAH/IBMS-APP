'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth/auth-context';
import {
  confirmConsentWithdrawal,
  createConsentRecord,
  listConsentRecords,
  requestConsentWithdrawal,
  type ConsentRecord,
} from '../../lib/pdpl/consent-api';
import { ApiError } from '../../lib/auth/api-client';

// Part D §5.1 — the shared, reusable consent-capture control mounted at each
// of the backlog's named touchpoints that already has an existing customer-
// scoped screen (onboarding/KYC, needs & risk assessment, RFQ/market
// placement, cross-sell, up-sell). Lead capture is wired separately, at
// creation time (LeadIntakeForm), since a Lead pre-dates a Customer row.
// Claims and Group Medical/Life & Motor Fleet remain deliberate, documented
// gaps — see README § Known gaps — no Claims web UI and no InsuredPerson
// CRUD exist yet for a widget to attach to.
const CONSENT_ROLES = [
  'SALES_RELATIONSHIP_OFFICER',
  'PLACEMENT_TECHNICAL_OFFICER',
  'CLAIMS_OFFICER',
  'DATA_PROTECTION_OFFICER',
];

interface Props {
  purpose: string;
  label: string;
  defaultConsentTextVersion: string;
  customerId?: string;
  insuredPersonId?: string;
}

export function ConsentCaptureWidget({
  purpose,
  label,
  defaultConsentTextVersion,
  customerId,
  insuredPersonId,
}: Props) {
  const { user } = useAuth();
  const canManage = !!user && user.roles.some((r) => CONSENT_ROLES.includes(r));

  // undefined = still loading (avoids a flash of "not captured yet").
  const [record, setRecord] = useState<ConsentRecord | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consentTextVersion, setConsentTextVersion] = useState(
    defaultConsentTextVersion,
  );

  const load = useCallback(async () => {
    try {
      const rows = await listConsentRecords({
        customerId,
        insuredPersonId,
        purpose,
      });
      setRecord(rows[0] ?? null); // newest first (API's own ordering)
      setError(null);
    } catch (err) {
      setRecord(null);
      setError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the consent.manage permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load consent status.',
      );
    }
  }, [customerId, insuredPersonId, purpose]);

  useEffect(() => {
    if (!canManage) return;
    void (async () => {
      await load();
    })();
  }, [canManage, load]);

  async function capture(decision: 'grant' | 'decline') {
    setBusy(true);
    setError(null);
    try {
      await createConsentRecord({
        customerId,
        insuredPersonId,
        purpose,
        granted: decision === 'grant',
        consentTextVersion: consentTextVersion.trim(),
      });
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'The capture failed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!record) return;
    setBusy(true);
    setError(null);
    try {
      await requestConsentWithdrawal(record.id);
      await confirmConsentWithdrawal(record.id);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'The withdrawal failed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <section
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: '0.75rem 1rem',
          margin: '0.75rem 0',
        }}
      >
        <h3 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>{label}</h3>
        <p style={{ fontSize: '0.85rem', opacity: 0.6 }}>
          You don&apos;t hold the consent.manage permission.
        </p>
      </section>
    );
  }

  return (
    <section
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '0.75rem 1rem',
        margin: '0.75rem 0',
      }}
    >
      <h3 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>{label}</h3>
      {error ? (
        <p role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem' }}>
          {error}
        </p>
      ) : null}
      {record === undefined ? (
        <p style={{ fontSize: '0.85rem', opacity: 0.6 }}>Loading…</p>
      ) : record?.isActive ? (
        <div
          style={{
            display: 'flex',
            gap: '0.6rem',
            alignItems: 'center',
            fontSize: '0.85rem',
          }}
        >
          <span>
            Granted {record.grantedAt ? record.grantedAt.slice(0, 10) : '—'} (
            {record.consentTextVersion})
          </span>
          <button type="button" disabled={busy} onClick={() => void withdraw()}>
            {busy ? 'Withdrawing…' : 'Withdraw'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.4rem', maxWidth: '24rem' }}>
          <p style={{ fontSize: '0.85rem', opacity: 0.7, margin: 0 }}>
            {record?.withdrawnAt
              ? `Previously withdrawn ${record.withdrawnAt.slice(0, 10)}.`
              : record
                ? 'Previously declined.'
                : 'No decision captured yet.'}
          </p>
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.2rem',
              fontSize: '0.85rem',
            }}
          >
            Consent text version
            <input
              aria-label={`${label} — consent text version`}
              value={consentTextVersion}
              onChange={(e) => setConsentTextVersion(e.target.value)}
            />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              disabled={busy || !consentTextVersion.trim()}
              onClick={() => void capture('grant')}
            >
              Grant
            </button>
            <button
              type="button"
              disabled={busy || !consentTextVersion.trim()}
              onClick={() => void capture('decline')}
            >
              Decline
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

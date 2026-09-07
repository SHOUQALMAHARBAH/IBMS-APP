'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createBrokerLicense,
  getBrokerLicense,
  markBrokerLicenseLapsed,
  renewBrokerLicense,
  type BrokerLicense,
} from '../../../lib/compliance-risk/broker-license-api';
import {
  createComplianceCalendarItem,
  listComplianceCalendarItems,
  recordComplianceSubmission,
  type ComplianceCalendarItem,
} from '../../../lib/compliance-risk/compliance-calendar-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const MANAGE_ROLE = 'COMPLIANCE_OFFICER';

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
const formStyle: CSSProperties = {
  margin: '1rem 0',
  display: 'grid',
  gap: '0.4rem',
  maxWidth: '30rem',
};
const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
};

export default function RegulatoryCompliancePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canManage = !!user && user.roles.includes(MANAGE_ROLE);

  const [license, setLicense] = useState<BrokerLicense | null>(null);
  const [licenseLoadError, setLicenseLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<ComplianceCalendarItem[] | null>(null);
  const [itemsLoadError, setItemsLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [licenseNumber, setLicenseNumber] = useState('');
  const [scopeOfAuthorization, setScopeOfAuthorization] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [obligationName, setObligationName] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [evidenceDrafts, setEvidenceDrafts] = useState<Record<string, string>>(
    {},
  );

  const loadLicense = useCallback(async () => {
    try {
      setLicense(await getBrokerLicense());
      setLicenseLoadError(null);
    } catch (err) {
      setLicense(null);
      setLicenseLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the license.manage permission."
          : err instanceof ApiError && err.status === 404
            ? 'No broker license record exists yet.'
            : err instanceof ApiError
              ? err.message
              : 'Could not load the broker license — try again.',
      );
    }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      setItems(await listComplianceCalendarItems());
      setItemsLoadError(null);
    } catch (err) {
      setItems(null);
      setItemsLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the compliance-calendar.manage permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the compliance calendar — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadLicense();
      await loadItems();
    })();
  }, [user, loadLicense, loadItems]);
  // A @code-reviewer MINOR: renew() replaces every field, so pre-filling
  // the form from the current record (rather than starting blank) stops an
  // officer who only means to push out expiresAt from silently wiping a
  // previously recorded scopeOfAuthorization/issuedAt they didn't touch.
  // Adjusted during render (React's own recommended pattern for "sync state
  // from a prop/fetch once it arrives"), not in a useEffect — a `licenseForm
  // Initialized` guard runs this exactly once, so it never fights with
  // whatever the officer is actively typing on a later reload.
  const [licenseFormInitialized, setLicenseFormInitialized] = useState(false);
  if (license && !licenseFormInitialized) {
    setLicenseFormInitialized(true);
    setLicenseNumber(license.licenseNumber);
    setScopeOfAuthorization(license.scopeOfAuthorization ?? '');
    setIssuedAt(license.issuedAt ? license.issuedAt.slice(0, 10) : '');
    setExpiresAt(license.expiresAt.slice(0, 10));
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await loadLicense();
      await loadItems();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'That action failed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitLicense(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      const payload = {
        licenseNumber,
        scopeOfAuthorization: scopeOfAuthorization.trim() || undefined,
        issuedAt: issuedAt || undefined,
        expiresAt,
      };
      if (license) {
        await renewBrokerLicense(payload);
      } else {
        await createBrokerLicense(payload);
      }
    });
  }

  async function submitItem(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createComplianceCalendarItem({
        obligationName,
        ownerUserId: ownerUserId.trim(),
        dueDate,
      });
      setObligationName('');
      setOwnerUserId('');
      setDueDate('');
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Regulatory compliance</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        The broker&apos;s own CBJ license status — new business is
        automatically blocked once it lapses — plus a calendar of regulatory
        obligations with owner, due date, and evidence-of-submission
        tracking.
      </p>

      <h2>Broker license</h2>
      {licenseLoadError ? (
        <p role="alert" style={errorStyle}>
          {licenseLoadError}
        </p>
      ) : null}
      {license ? (
        <div style={{ margin: '0.5rem 0' }}>
          <table style={{ borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={cell}>License number</td>
                <td style={cell}>{license.licenseNumber}</td>
              </tr>
              <tr>
                <td style={cell}>Status</td>
                <td style={cell}>
                  {license.status}
                  {license.isCurrentlyLapsed ? ' (currently lapsed)' : ''}
                </td>
              </tr>
              <tr>
                <td style={cell}>Expires</td>
                <td style={cell}>{license.expiresAt.slice(0, 10)}</td>
              </tr>
            </tbody>
          </table>
          {canManage && !license.isCurrentlyLapsed ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => markBrokerLicenseLapsed())}
              style={{ marginTop: '0.5rem' }}
            >
              Mark lapsed
            </button>
          ) : null}
        </div>
      ) : null}

      {canManage ? (
        <form onSubmit={submitLicense} style={formStyle}>
          <label style={labelStyle}>
            License number
            <input
              aria-label="License number"
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            Scope of authorization
            <input
              aria-label="Scope of authorization"
              value={scopeOfAuthorization}
              onChange={(e) => setScopeOfAuthorization(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            Issued at
            <input
              aria-label="Issued at"
              type="date"
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            Expires at
            <input
              aria-label="Expires at"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy ? 'Saving…' : license ? 'Renew license' : 'Create license'}
          </button>
        </form>
      ) : null}

      <h2 style={{ marginTop: '2rem' }}>Compliance calendar</h2>
      {canManage ? (
        <form onSubmit={submitItem} style={formStyle}>
          <label style={labelStyle}>
            Obligation
            <input
              aria-label="Obligation"
              value={obligationName}
              onChange={(e) => setObligationName(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            Owner user ID
            <input
              aria-label="Owner user ID"
              value={ownerUserId}
              onChange={(e) => setOwnerUserId(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            Due date
            <input
              aria-label="Due date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy ? 'Saving…' : 'Add obligation'}
          </button>
        </form>
      ) : null}

      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}
      {itemsLoadError ? (
        <p role="alert" style={errorStyle}>
          {itemsLoadError}
        </p>
      ) : null}

      {items ? (
        items.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No compliance calendar items.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '46rem' }}>
              <thead>
                <tr>
                  <th style={head}>Obligation</th>
                  <th style={head}>Due</th>
                  <th style={head}>Status</th>
                  <th style={head}>Evidence</th>
                  <th style={head}>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td style={cell}>{it.obligationName}</td>
                    <td style={cell}>
                      {it.dueDate.slice(0, 10)}
                      {it.isOverdue ? ' (overdue)' : ''}
                    </td>
                    <td style={cell}>
                      {it.isSubmitted ? 'submitted' : 'pending'}
                    </td>
                    <td style={cell}>{it.evidenceOfSubmissionRef ?? '—'}</td>
                    <td style={cell}>
                      {canManage && !it.isSubmitted ? (
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <input
                            aria-label={`Evidence reference for ${it.obligationName}`}
                            value={evidenceDrafts[it.id] ?? ''}
                            onChange={(e) =>
                              setEvidenceDrafts((prev) => ({
                                ...prev,
                                [it.id]: e.target.value,
                              }))
                            }
                            placeholder="Evidence ref"
                            style={{ width: '9rem' }}
                          />
                          <button
                            type="button"
                            disabled={busy || !evidenceDrafts[it.id]?.trim()}
                            onClick={() =>
                              void run(() =>
                                recordComplianceSubmission(it.id, {
                                  evidenceOfSubmissionRef:
                                    evidenceDrafts[it.id]!.trim(),
                                }),
                              )
                            }
                          >
                            Record submission
                          </button>
                        </div>
                      ) : null}
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

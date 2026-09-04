'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  COMMUNICATION_CHANNELS,
  createCommunication,
  getMarketingConsentStatus,
  listCommunications,
  type Communication,
  type MarketingConsentStatus,
} from '../../../lib/customer-service/communication-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const SEND_ROLES = [
  'SALES_RELATIONSHIP_OFFICER',
  'PLACEMENT_TECHNICAL_OFFICER',
  'CLAIMS_OFFICER',
  'FINANCE_COLLECTIONS_OFFICER',
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

export default function CommunicationsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canSend =
    !!user && user.roles.some((r) => SEND_ROLES.includes(r));

  const [rows, setRows] = useState<Communication[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [channel, setChannel] = useState('');
  const [isMarketing, setIsMarketing] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [consent, setConsent] = useState<MarketingConsentStatus | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listCommunications());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the communication.send permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load communications — try again.',
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

  async function checkConsent() {
    setConsent(null);
    setConsentError(null);
    if (!customerId.trim()) {
      setConsentError('Enter a customer ID first.');
      return;
    }
    try {
      setConsent(await getMarketingConsentStatus(customerId.trim()));
    } catch (err) {
      setConsentError(
        err instanceof ApiError ? err.message : 'Consent check failed.',
      );
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await createCommunication({
        customerId: customerId.trim(),
        body: body.trim(),
        ...(channel ? { channel } : {}),
        ...(subject.trim() ? { subject: subject.trim() } : {}),
        isMarketing,
      });
      setSubject('');
      setBody('');
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'The send failed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Communications</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Outbound customer communications. Channel and language default to the
        customer&apos;s recorded preferences (an explicit value that disagrees is
        rejected). A <strong>marketing</strong> send is allowed only while the
        customer&apos;s marketing consent is granted and not withdrawn.
      </p>

      {canSend ? (
        <form
          onSubmit={submit}
          style={{
            margin: '1rem 0',
            display: 'grid',
            gap: '0.4rem',
            maxWidth: '34rem',
          }}
        >
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            Customer ID
            <input
              aria-label="Customer ID"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
            />
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            Channel (blank = the customer&apos;s recorded preference)
            <select
              aria-label="Channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="">(recorded preference)</option>
              {COMMUNICATION_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              aria-label="Marketing"
              checked={isMarketing}
              onChange={(e) => setIsMarketing(e.target.checked)}
            />
            Marketing communication (consent-gated)
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            Subject (optional)
            <input
              aria-label="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            Message
            <textarea
              aria-label="Message"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              rows={3}
            />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Log communication'}
            </button>
            <button type="button" onClick={() => void checkConsent()}>
              Check marketing consent
            </button>
          </div>
          {consent ? (
            <p
              style={{
                opacity: 0.8,
                color: consent.marketing.allowed ? '#15803d' : '#b45309',
              }}
            >
              Marketing consent:{' '}
              {consent.marketing.allowed
                ? 'granted — a marketing send is allowed'
                : `blocked (${consent.marketing.reason.replace('_', ' ')})`}
            </p>
          ) : null}
          {consentError ? (
            <p role="alert" style={errorStyle}>
              {consentError}
            </p>
          ) : null}
        </form>
      ) : null}

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
          <p style={{ opacity: 0.6 }}>No communications.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '52rem' }}>
              <thead>
                <tr>
                  <th style={head}>Customer</th>
                  <th style={head}>Channel</th>
                  <th style={head}>Lang</th>
                  <th style={head}>Marketing</th>
                  <th style={head}>Subject</th>
                  <th style={head}>Sent</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>
                      {r.customerId ? `${r.customerId.slice(0, 8)}…` : '—'}
                    </td>
                    <td style={cell}>{r.channel}</td>
                    <td style={cell}>{r.languageUsed ?? '—'}</td>
                    <td style={cell}>{r.isMarketing ? 'yes' : 'no'}</td>
                    <td style={cell}>{r.subject ?? '—'}</td>
                    <td style={cell}>{r.sentAt.slice(0, 10)}</td>
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

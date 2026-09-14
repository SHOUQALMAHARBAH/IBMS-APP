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
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../lib/i18n/translations';

const CHANNEL_LABEL_KEY: Record<string, TranslationKey> = {
  EMAIL: 'commChannelEmail',
  SMS: 'commChannelSms',
  WHATSAPP: 'commChannelWhatsapp',
  CALL: 'commChannelCall',
  PORTAL: 'commChannelPortal',
  OTHER: 'commChannelOther',
};


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

export default function CommunicationsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canSend =
    hasPermission(user, 'communication.send');

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
          ? t('commNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('commLoadError'),
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

  async function checkConsent() {
    setConsent(null);
    setConsentError(null);
    if (!customerId.trim()) {
      setConsentError(t('commEnterCustomerFirst'));
      return;
    }
    try {
      setConsent(await getMarketingConsentStatus(customerId.trim()));
    } catch (err) {
      setConsentError(
        err instanceof ApiError ? err.message : t('commConsentCheckFailed'),
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
        err instanceof ApiError ? err.message : t('commSendError'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('commHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('commIntro')}
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
            {t('commCustomerIdLabel')}
            <input
              aria-label={t('commCustomerIdLabel')}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
            />
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            {t('commChannelLabel')}
            <select
              aria-label={t('commColChannel')}
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="">{t('commChannelDefaultOption')}</option>
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
              aria-label={t('commColMarketing')}
              checked={isMarketing}
              onChange={(e) => setIsMarketing(e.target.checked)}
            />
            {t('commMarketingLabel')}
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            {t('commSubjectLabel')}
            <input
              aria-label={t('commColSubject')}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            {t('commMessageLabel')}
            <textarea
              aria-label={t('commMessageLabel')}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              rows={3}
            />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button type="submit" disabled={busy}>
              {busy ? t('commSendingButton') : t('commLogButton')}
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
              {t('commConsentLabel')}{' '}
              {consent.marketing.allowed
                ? t('commConsentAllowed')
                : t('commConsentBlocked', {
                    reason: consent.marketing.reason.replace('_', ' '),
                  })}
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
          <p style={{ opacity: 0.6 }}>{t('commNone')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '52rem' }}>
              <thead>
                <tr>
                  <th style={head}>{t('commColCustomer')}</th>
                  <th style={head}>{t('commColChannel')}</th>
                  <th style={head}>{t('commColLang')}</th>
                  <th style={head}>{t('commColMarketing')}</th>
                  <th style={head}>{t('commColSubject')}</th>
                  <th style={head}>{t('commColSent')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>
                      {r.customerId ? `${r.customerId.slice(0, 8)}…` : '—'}
                    </td>
                    <td style={cell}>
                      {CHANNEL_LABEL_KEY[r.channel] ? t(CHANNEL_LABEL_KEY[r.channel]) : r.channel}
                    </td>
                    <td style={cell}>{r.languageUsed ?? '—'}</td>
                    <td style={cell}>{r.isMarketing ? t('commYes') : t('commNo')}</td>
                    <td style={cell}>{r.subject ?? '—'}</td>
                    <td style={cell}>{r.sentAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        <p>{t('commLoading')}</p>
      )}
    </main>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { EntitySearch } from '../../../components/ui/EntitySearch';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
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
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../lib/i18n/translations';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

const CHANNEL_LABEL_KEY: Record<string, TranslationKey> = {
  EMAIL: 'commChannelEmail',
  SMS: 'commChannelSms',
  WHATSAPP: 'commChannelWhatsapp',
  CALL: 'commChannelCall',
  PORTAL: 'commChannelPortal',
  OTHER: 'commChannelOther',
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
          ? permissionRefusal(t, 'commRefusalAct', 'communication.send')
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
    <main style={pageStackStyle}>
      <PageHeader
        title={t('commHeading')}
        description={t('commIntro')}
      />

      {canSend ? (
        <form
          onSubmit={submit}
          style={{
            margin: '1rem 0',
            display: 'grid',
            gap: 'var(--space-2)',
            maxWidth: '34rem',
          }}
        >
          <EntitySearch
            kind="customer"
            value={customerId}
            onChange={setCustomerId}
            label={t('commCustomerIdLabel')}
            required
          />
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
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
                  {t(ENUM_LABEL.CommunicationChannel[c])}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <input
              type="checkbox"
              aria-label={t('commColMarketing')}
              checked={isMarketing}
              onChange={(e) => setIsMarketing(e.target.checked)}
            />
            {t('commMarketingLabel')}
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
          >
            {t('commSubjectLabel')}
            <input
              aria-label={t('commColSubject')}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
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
              {t('commCheckConsentButton')}
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
            <ErrorState title={consentError} />
          ) : null}
        </form>
      ) : null}

      {actionError ? (
        <ErrorState title={actionError} />
      ) : null}
      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <EmptyState title={t('commNone')} />
        ) : (
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('commColCustomer')}</Th>
                  <Th>{t('commColChannel')}</Th>
                  <Th>{t('commColLang')}</Th>
                  <Th>{t('commColMarketing')}</Th>
                  <Th>{t('commColSubject')}</Th>
                  <Th>{t('commColSent')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      {/* RULE 2 — the name, never the id. The em dash covers a log against
                          no customer AND one whose customerId resolves to nothing: this is
                          the one model in the group whose column has no foreign key, so both
                          are reachable, and a LIST cell cannot usefully tell them apart. */}
                      {r.customerName === null ? (
                        '—'
                      ) : (
                        <bdi>{r.customerName}</bdi>
                      )}
                    </Td>
                    <Td>
                      {CHANNEL_LABEL_KEY[r.channel] ? t(CHANNEL_LABEL_KEY[r.channel]) : r.channel}
                    </Td>
                    <Td>{r.languageUsed ?? '—'}</Td>
                    <Td>{r.isMarketing ? t('commYes') : t('commNo')}</Td>
                    <Td>{r.subject ?? '—'}</Td>
                    <Td>{r.sentAt.slice(0, 10)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('commLoading')} />
      )}
    </main>
  );
}

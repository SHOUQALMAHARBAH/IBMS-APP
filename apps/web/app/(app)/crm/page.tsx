'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import type { TranslationKey } from '../../../lib/i18n/translations';
import type { TimelineEvent } from '../../../lib/crm/crm-api';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { SentenceWithLink } from '../../../components/ui/SentenceWithLink';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getCustomer360,
  INTERACTION_CHANNELS,
  logInteraction,
  type Customer360View,
  type InteractionChannel,
} from '../../../lib/crm/crm-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  buttonStyle,
  errorStyle,
} from '../../../components/auth/auth-form.styles';
import { cardMetaStyle, pageStyle } from '../../../components/lead/lead.styles';
import {
  crmCountRowStyle,
  crmFormRowStyle,
  crmKindBadgeStyle,
  crmPanelStyle,
  crmTimelineItemStyle,
  crmTimelineWhenStyle,
} from '../../../components/crm/crm.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDateTime } from '../../../lib/i18n/format';
import { hasPermission } from '../../../lib/auth/permissions';

// Client-side hint only — the API enforces `interaction.log` on write
// regardless. Matches the seeded grant list for that permission (a superset
// of the `customer.360-view.read` roles: Placement/Claims/Finance can log a
// touchpoint but cannot read the 360° timeline back).

/**
 * A timeline row's status comes from whichever module raised it, so one
 * lookup table cannot serve it: a POLICY row carries a PolicyStatus, a CLAIM
 * row a ClaimStatus, a COMPLAINT row a ComplaintStatus, and an INTERACTION
 * row has no status at all. `kind` is what says which — this picks the map
 * from it rather than guessing from the value, which would collide the moment
 * two vocabularies share a word (CLOSED is in two of these three).
 */
function timelineStatusLabel(event: TimelineEvent): TranslationKey | null {
  if (!event.status) return null;
  const map =
    event.kind === 'POLICY'
      ? ENUM_LABEL.PolicyStatus
      : event.kind === 'CLAIM'
        ? ENUM_LABEL.ClaimStatus
        : event.kind === 'COMPLAINT'
          ? ENUM_LABEL.ComplaintStatus
          : null;
  // An unknown value is rendered as-is rather than crashing or blanking: the
  // server owns these vocabularies and may add one before the UI knows it.
  return (map as Record<string, TranslationKey> | null)?.[event.status] ?? null;
}

function TimelineList({ view }: { view: Customer360View }) {
  const { language, t } = useLanguage();
  if (view.timeline.length === 0) {
    return (
      <p style={{ color: 'var(--ink-secondary)', marginTop: '1rem' }}>
        {t('crmTimelineEmpty')}
      </p>
    );
  }
  return (
    <div style={{ marginTop: '1rem' }}>
      {view.timeline.map((event) => (
        <div key={`${event.kind}-${event.refId}`} style={crmTimelineItemStyle}>
          <span style={crmKindBadgeStyle}>
            {t(ENUM_LABEL.TimelineEventKind[event.kind])}
          </span>
          <div>
            <div>
              <strong>{event.title}</strong>
              {timelineStatusLabel(event) ? (
                <span style={{ opacity: 0.7 }}>
                  {' '}
                  — {t(timelineStatusLabel(event)!)}
                </span>
              ) : null}
            </div>
            {event.detail ? <div>{event.detail}</div> : null}
            <div style={crmTimelineWhenStyle}>
              {formatDateTime(event.at, language)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface ViewError {
  status: number | null;
  message: string;
}

function CrmForCustomer({ customerId }: { customerId: string }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const canLog = hasPermission(user, 'interaction.log');

  const [view, setView] = useState<Customer360View | null>(null);
  const [viewError, setViewError] = useState<ViewError | null>(null);

  const [channel, setChannel] = useState<InteractionChannel>('CALL');
  const [summary, setSummary] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logOk, setLogOk] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await getCustomer360(customerId));
      setViewError(null);
    } catch (err) {
      setView(null);
      const status = err instanceof ApiError ? err.status : null;
      setViewError({
        status,
        message:
          status === 403
            ? t('crmNoPermission')
            : status === 404
              ? t('crmCustomerNotFound')
              : err instanceof ApiError
                ? err.message
                : t('crmLoadError'),
      });
    }
  }, [customerId, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load, t]);

  async function submit() {
    setLogError(null);
    setLogOk(false);

    let occurredAtIso: string | undefined;
    if (occurredAt) {
      const parsed = new Date(occurredAt);
      if (Number.isNaN(parsed.getTime())) {
        setLogError(t('crmInvalidDate'));
        return;
      }
      occurredAtIso = parsed.toISOString();
    }

    setSubmitting(true);
    try {
      await logInteraction(customerId, {
        channel,
        summary: summary.trim(),
        occurredAt: occurredAtIso,
      });
      setSummary('');
      setOccurredAt('');
      setLogOk(true);
      await load();
    } catch (err) {
      setLogError(
        err instanceof ApiError && err.status === 403
          ? t('crmNoPermissionLog')
          : err instanceof ApiError
            ? err.message
            : t('crmLogError'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  // A 404 (or an unexpected error) leaves nothing to do on this screen.
  // A 403 on the 360° view does not: a role that holds `interaction.log`
  // but not `customer.360-view.read` still logs interactions here.
  if (viewError && viewError.status !== 403) {
    return (
      <p role="alert" style={errorStyle}>
        {viewError.message}
      </p>
    );
  }
  if (!view && !viewError) return <p>{t('crmLoading')}</p>;

  return (
    <div style={{ marginTop: '1rem' }}>
      {view ? (
        <>
          <h2 style={{ marginBottom: 0 }}>
            <bdi>{view.customer.legalName}</bdi>
          </h2>
          <p style={{ opacity: 0.8, marginTop: '0.2rem' }}>
            {view.customer.customerType} — Status: {t(ENUM_LABEL.CustomerStatus[view.customer.status])}
          </p>
          <div style={crmCountRowStyle}>
            <span>Interactions: {view.counts.interactions}</span>
            <span>Policies: {view.counts.policies}</span>
            <span>Claims: {view.counts.claims}</span>
            <span>Complaints: {view.counts.complaints}</span>
          </div>
        </>
      ) : null}

      {canLog ? (
        <div style={crmPanelStyle}>
          <strong>{t('crmLogHeading')}</strong>
          <div style={crmFormRowStyle}>
            <div>
              <label htmlFor="crm-channel" style={cardMetaStyle}>
                Channel
              </label>
              <br />
              <select
                id="crm-channel"
                value={channel}
                onChange={(e) =>
                  setChannel(e.target.value as InteractionChannel)
                }
              >
                {INTERACTION_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {t(ENUM_LABEL.InteractionChannel[c])}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 20rem' }}>
              <label htmlFor="crm-summary" style={cardMetaStyle}>
                {t('crmWhatHappened')}
              </label>
              <br />
              <input
                id="crm-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder={t('crmDetailPlaceholder')}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label htmlFor="crm-occurred" style={cardMetaStyle}>
                {t('crmWhenOptional')}
              </label>
              <br />
              <input
                id="crm-occurred"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </div>
            <button
              type="button"
              disabled={submitting || summary.trim().length === 0}
              style={{ ...buttonStyle, width: 'auto' }}
              onClick={() => void submit()}
            >
              {submitting ? t('crmLogging') : t('crmLogButton')}
            </button>
          </div>
          {logOk ? (
            <p style={{ ...cardMetaStyle, opacity: 1 }}>{t('crmLogged')}</p>
          ) : null}
          {logError ? (
            <p role="alert" style={errorStyle}>
              {logError}
            </p>
          ) : null}
        </div>
      ) : viewError?.status === 403 ? (
        <p role="alert" style={errorStyle}>
          {viewError.message}
        </p>
      ) : null}

      <h3 style={{ marginTop: '1.5rem' }}>{t('crmTimeline')}</h3>
      {view ? (
        <TimelineList view={view} />
      ) : (
        <p style={{ color: 'var(--ink-secondary)', marginTop: '1rem' }}>
          {t('crmTimelineNeedsPermission')}
        </p>
      )}
    </div>
  );
}

function CrmFlow() {
  const router = useRouter();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const customerId = searchParams.get('customerId') ?? '';

  if (!customerId) {
    return (
      <p role="alert" style={errorStyle}>
        <SentenceWithLink
          sentence={t('crmNoCustomerSelected')}
          linkLabel={t('navCustomers')}
          onLinkClick={() => router.push('/customers')}
        />
      </p>
    );
  }

  return <CrmForCustomer customerId={customerId} />;
}

export default function CrmPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('crmHeading')}</h1>
      <p style={{ opacity: 0.8 }}>
        {t('crmIntro')}
      </p>
      <Suspense fallback={null}>
        <CrmFlow />
      </Suspense>
    </main>
  );
}

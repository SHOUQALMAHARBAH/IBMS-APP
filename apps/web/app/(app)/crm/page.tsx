'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
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

// Client-side hint only — the API enforces `interaction.log` on write
// regardless. Matches the seeded grant list for that permission (a superset
// of the `customer.360-view.read` roles: Placement/Claims/Finance can log a
// touchpoint but cannot read the 360° timeline back).
const CAN_LOG_ROLES = [
  'SALES_RELATIONSHIP_OFFICER',
  'PLACEMENT_TECHNICAL_OFFICER',
  'CLAIMS_OFFICER',
  'FINANCE_COLLECTIONS_OFFICER',
  'COMPLIANCE_OFFICER',
  'BRANCH_DEPARTMENT_MANAGER',
];

function TimelineList({ view }: { view: Customer360View }) {
  if (view.timeline.length === 0) {
    return (
      <p style={{ opacity: 0.6, marginTop: '1rem' }}>
        Nothing on this customer&apos;s timeline yet. Log the first interaction
        above — policies, claims and complaints will appear here too once those
        modules exist.
      </p>
    );
  }
  return (
    <div style={{ marginTop: '1rem' }}>
      {view.timeline.map((event) => (
        <div key={`${event.kind}-${event.refId}`} style={crmTimelineItemStyle}>
          <span style={crmKindBadgeStyle}>{event.kind}</span>
          <div>
            <div>
              <strong>{event.title}</strong>
              {event.status ? (
                <span style={{ opacity: 0.7 }}> — {event.status}</span>
              ) : null}
            </div>
            {event.detail ? <div>{event.detail}</div> : null}
            <div style={crmTimelineWhenStyle}>
              {new Date(event.at).toLocaleString()}
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
  const { user } = useAuth();
  const canLog = user?.roles.some((role) => CAN_LOG_ROLES.includes(role)) ?? false;

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
            ? "You don't hold the customer.360-view.read permission, so the 360° timeline isn't shown here."
            : status === 404
              ? 'This customer could not be found — it may not exist, or you may not have access to it.'
              : err instanceof ApiError
                ? err.message
                : 'Could not load this customer view — try again.',
      });
    }
  }, [customerId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function submit() {
    setLogError(null);
    setLogOk(false);

    let occurredAtIso: string | undefined;
    if (occurredAt) {
      const parsed = new Date(occurredAt);
      if (Number.isNaN(parsed.getTime())) {
        setLogError('Enter a valid date and time, or leave the date blank.');
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
          ? "You don't hold the interaction.log permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not log the interaction — try again.',
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
  if (!view && !viewError) return <p>Loading…</p>;

  return (
    <div style={{ marginTop: '1rem' }}>
      {view ? (
        <>
          <h2 style={{ marginBottom: 0 }}>{view.customer.legalName}</h2>
          <p style={{ opacity: 0.8, marginTop: '0.2rem' }}>
            {view.customer.customerType} — Status: {view.customer.status}
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
          <strong>Log an interaction</strong>
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
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 20rem' }}>
              <label htmlFor="crm-summary" style={cardMetaStyle}>
                What happened?
              </label>
              <br />
              <input
                id="crm-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="e.g. Called to confirm the renewal terms"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label htmlFor="crm-occurred" style={cardMetaStyle}>
                When (optional — defaults to now)
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
              {submitting ? 'Logging…' : 'Log interaction'}
            </button>
          </div>
          {logOk ? (
            <p style={{ ...cardMetaStyle, opacity: 1 }}>Interaction logged.</p>
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

      <h3 style={{ marginTop: '1.5rem' }}>Timeline</h3>
      {view ? (
        <TimelineList view={view} />
      ) : (
        <p style={{ opacity: 0.6, marginTop: '1rem' }}>
          The 360° timeline needs the <code>customer.360-view.read</code>{' '}
          permission. You can still log interactions above.
        </p>
      )}
    </div>
  );
}

function CrmFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerId = searchParams.get('customerId') ?? '';

  if (!customerId) {
    return (
      <p role="alert" style={errorStyle}>
        No customer selected — open a customer from{' '}
        <button
          type="button"
          onClick={() => router.push('/customers')}
          style={{ textDecoration: 'underline', cursor: 'pointer' }}
        >
          Customers
        </button>{' '}
        and open its relationship timeline from there.
      </p>
    );
  }

  return <CrmForCustomer customerId={customerId} />;
}

export default function CrmPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Relationship (CRM)</h1>
      <p style={{ opacity: 0.8 }}>
        Process 10 — log every customer touchpoint (meeting, call, email,
        WhatsApp, visit, proposal, renewal, claim, complaint) and see the
        360° timeline: interactions today, plus policies, claims and complaints
        once those modules land.
      </p>
      <Suspense fallback={null}>
        <CrmFlow />
      </Suspense>
    </main>
  );
}

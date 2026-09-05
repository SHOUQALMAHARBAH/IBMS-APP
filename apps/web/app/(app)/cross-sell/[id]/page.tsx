'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  convertCrossSellOpportunity,
  dismissCrossSellOpportunity,
  getCrossSellOpportunity,
  type CrossSellOpportunity,
} from '../../../../lib/cross-sell/cross-sell-api';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  buttonStyle,
  errorStyle,
} from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import {
  profileFieldLabelStyle,
  profileFieldValueStyle,
} from '../../../../components/prospect/prospect.styles';
import {
  crossSellActionsStyle,
  crossSellBadgeStyle,
} from '../../../../components/cross-sell/cross-sell.styles';

const CAN_CONVERT_ROLE = 'SALES_RELATIONSHIP_OFFICER';

export default function CrossSellOpportunityDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();

  const [opportunity, setOpportunity] = useState<CrossSellOpportunity | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [dismissing, setDismissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setOpportunity(await getCrossSellOpportunity(params.id));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? 'This cross-sell opportunity could not be found — it may not exist, or you may not have access to it.'
          : err instanceof ApiError
            ? err.message
            : 'Could not load this cross-sell opportunity — try again.',
      );
    }
  }, [params.id]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  async function run(
    fn: () => Promise<CrossSellOpportunity>,
    fallback: string,
  ) {
    setActionError(null);
    setBusy(true);
    try {
      setOpportunity(await fn());
      setDismissing(false);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  const canConvert = user.roles.includes(CAN_CONVERT_ROLE);

  return (
    <main style={pageStyle}>
      <button
        type="button"
        onClick={() =>
          router.push(
            opportunity
              ? `/cross-sell?customerId=${opportunity.customerId}`
              : '/cross-sell',
          )
        }
        style={{ cursor: 'pointer' }}
      >
        ← All cross-sell opportunities
      </button>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {opportunity ? (
        <>
          <h1>{opportunity.gapLine}</h1>
          <p style={{ opacity: 0.8 }}>
            <span style={crossSellBadgeStyle}>{opportunity.status}</span>
          </p>

          <div
            style={{
              display: 'flex',
              gap: '2rem',
              flexWrap: 'wrap',
              marginTop: '1rem',
            }}
          >
            <div>
              <div style={profileFieldLabelStyle}>Flagged</div>
              <div style={profileFieldValueStyle}>
                {new Date(opportunity.detectedAt).toLocaleString()}
              </div>
            </div>
            {opportunity.resolvedAt ? (
              <div>
                <div style={profileFieldLabelStyle}>Resolved</div>
                <div style={profileFieldValueStyle}>
                  {new Date(opportunity.resolvedAt).toLocaleString()}
                </div>
              </div>
            ) : null}
            {opportunity.dismissReason ? (
              <div>
                <div style={profileFieldLabelStyle}>Dismiss reason</div>
                <div style={profileFieldValueStyle}>
                  {opportunity.dismissReason}
                </div>
              </div>
            ) : null}
          </div>

          {opportunity.status === 'OPEN' && canConvert ? (
            <div style={crossSellActionsStyle}>
              <button
                type="button"
                disabled={busy}
                style={{ ...buttonStyle, width: 'auto' }}
                onClick={() =>
                  void run(
                    () => convertCrossSellOpportunity(opportunity.id),
                    'Could not convert — try again.',
                  )
                }
              >
                {busy ? 'Working…' : 'Convert'}
              </button>
              {dismissing ? (
                <>
                  <input
                    aria-label="Why is this gap not being pursued?"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. covered under a group policy elsewhere"
                    style={{ minWidth: '18rem' }}
                  />
                  <button
                    type="button"
                    disabled={busy || reason.trim().length < 3}
                    style={{ ...buttonStyle, width: 'auto' }}
                    onClick={() =>
                      void run(
                        () =>
                          dismissCrossSellOpportunity(
                            opportunity.id,
                            reason.trim(),
                          ),
                        'Could not dismiss — try again.',
                      )
                    }
                  >
                    Confirm dismiss
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonStyle, width: 'auto' }}
                    onClick={() => setDismissing(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  style={{ ...buttonStyle, width: 'auto' }}
                  onClick={() => setDismissing(true)}
                >
                  Dismiss…
                </button>
              )}
            </div>
          ) : null}

          {actionError ? (
            <p role="alert" style={errorStyle}>
              {actionError}
            </p>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

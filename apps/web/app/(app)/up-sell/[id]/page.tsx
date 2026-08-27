'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  convertUpSellRecommendation,
  dismissUpSellRecommendation,
  getUpSellRecommendation,
  type UpSellRecommendation,
} from '../../../../lib/up-sell/up-sell-api';
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
  upSellActionsStyle,
  upSellBadgeStyle,
  upSellFigureRowStyle,
} from '../../../../components/up-sell/up-sell.styles';

const CAN_CONVERT_ROLE = 'SALES_RELATIONSHIP_OFFICER';

export default function UpSellRecommendationDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();

  const [recommendation, setRecommendation] =
    useState<UpSellRecommendation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [dismissing, setDismissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setRecommendation(await getUpSellRecommendation(params.id));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? 'This up-sell recommendation could not be found — it may not exist, or you may not have access to it.'
          : err instanceof ApiError
            ? err.message
            : 'Could not load this up-sell recommendation — try again.',
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
    fn: () => Promise<UpSellRecommendation>,
    fallback: string,
  ) {
    setActionError(null);
    setBusy(true);
    try {
      setRecommendation(await fn());
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
            recommendation
              ? `/up-sell?customerId=${recommendation.customerId}`
              : '/up-sell',
          )
        }
        style={{ cursor: 'pointer' }}
      >
        ← All up-sell recommendations
      </button>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {recommendation ? (
        <>
          <h1>Under-insurance recommendation</h1>
          <p style={{ opacity: 0.8 }}>
            <span style={upSellBadgeStyle}>{recommendation.status}</span>
          </p>

          <div style={upSellFigureRowStyle}>
            <div>
              <div style={profileFieldLabelStyle}>
                Designed Sum Insured (JOD)
              </div>
              <div style={profileFieldValueStyle}>
                {recommendation.currentSumInsured}
              </div>
            </div>
            <div>
              <div style={profileFieldLabelStyle}>
                Current asset value (JOD)
              </div>
              <div style={profileFieldValueStyle}>
                {recommendation.currentAssetValue}
              </div>
            </div>
          </div>

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
                {new Date(recommendation.detectedAt).toLocaleString()}
              </div>
            </div>
            {recommendation.resolvedAt ? (
              <div>
                <div style={profileFieldLabelStyle}>Resolved</div>
                <div style={profileFieldValueStyle}>
                  {new Date(recommendation.resolvedAt).toLocaleString()}
                </div>
              </div>
            ) : null}
            {recommendation.dismissReason ? (
              <div>
                <div style={profileFieldLabelStyle}>Dismiss reason</div>
                <div style={profileFieldValueStyle}>
                  {recommendation.dismissReason}
                </div>
              </div>
            ) : null}
          </div>

          {recommendation.status === 'OPEN' && canConvert ? (
            <div style={upSellActionsStyle}>
              <button
                type="button"
                disabled={busy}
                style={{ ...buttonStyle, width: 'auto' }}
                onClick={() =>
                  void run(
                    () => convertUpSellRecommendation(recommendation.id),
                    'Could not convert — try again.',
                  )
                }
              >
                {busy ? 'Working…' : 'Convert'}
              </button>
              {dismissing ? (
                <>
                  <input
                    aria-label="Why is the increase not being pursued?"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. client declined the increase"
                    style={{ minWidth: '18rem' }}
                  />
                  <button
                    type="button"
                    disabled={busy || reason.trim().length < 3}
                    style={{ ...buttonStyle, width: 'auto' }}
                    onClick={() =>
                      void run(
                        () =>
                          dismissUpSellRecommendation(
                            recommendation.id,
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

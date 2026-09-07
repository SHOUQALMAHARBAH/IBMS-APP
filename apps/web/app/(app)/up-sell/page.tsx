'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  convertUpSellRecommendation,
  detectUpSell,
  dismissUpSellRecommendation,
  listUpSellRecommendations,
  type UpSellDetectionResult,
  type UpSellRecommendation,
} from '../../../lib/up-sell/up-sell-api';
import { ApiError } from '../../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../../../components/auth/auth-form.styles';
import { cardMetaStyle, pageStyle } from '../../../components/lead/lead.styles';
import {
  upSellActionsStyle,
  upSellBadgeStyle,
  upSellCardStyle,
  upSellFigureRowStyle,
  upSellPanelStyle,
} from '../../../components/up-sell/up-sell.styles';

const CAN_CONVERT_ROLE = 'SALES_RELATIONSHIP_OFFICER';
const CAN_SCAN_ROLES = ['SALES_RELATIONSHIP_OFFICER', 'BRANCH_DEPARTMENT_MANAGER'];

function RecommendationRow({
  recommendation,
  canConvert,
  onChanged,
}: {
  recommendation: UpSellRecommendation;
  canConvert: boolean;
  onChanged: (updated: UpSellRecommendation) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function run(
    fn: () => Promise<UpSellRecommendation>,
    fallback: string,
  ) {
    setError(null);
    setBusy(true);
    try {
      onChanged(await fn());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={upSellCardStyle}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <strong>Under-insurance flagged</strong>
        <span style={upSellBadgeStyle}>{recommendation.status}</span>
      </div>
      <div style={upSellFigureRowStyle}>
        <span>Designed Sum Insured (JOD): {recommendation.currentSumInsured}</span>
        <span>Current asset value (JOD): {recommendation.currentAssetValue}</span>
      </div>
      <div style={cardMetaStyle}>
        Flagged {new Date(recommendation.detectedAt).toLocaleDateString()}
      </div>
      {recommendation.status === 'DISMISSED' && recommendation.dismissReason ? (
        <div style={cardMetaStyle}>Reason: {recommendation.dismissReason}</div>
      ) : null}

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
              <label
                htmlFor={`reason-${recommendation.id}`}
                style={cardMetaStyle}
              >
                Why is the increase not being pursued?
              </label>
              <input
                id={`reason-${recommendation.id}`}
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

      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function UpSellForCustomer({ customerId }: { customerId: string }) {
  const { user } = useAuth();
  const canConvert = user?.roles.includes(CAN_CONVERT_ROLE) ?? false;
  const canScan =
    user?.roles.some((role) => CAN_SCAN_ROLES.includes(role)) ?? false;

  const [recommendations, setRecommendations] = useState<
    UpSellRecommendation[] | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scan, setScan] = useState<UpSellDetectionResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    try {
      setRecommendations(await listUpSellRecommendations(customerId));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the up-sell.read permission, so there's nothing to show here."
          : err instanceof ApiError && err.status === 404
            ? 'This customer could not be found — it may not exist, or you may not have access to it.'
            : err instanceof ApiError
              ? err.message
              : 'Could not load up-sell recommendations — try again.',
      );
    }
  }, [customerId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function runScan() {
    setScanError(null);
    setScanning(true);
    try {
      setScan(await detectUpSell(customerId));
      await load();
    } catch (err) {
      setScanError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the up-sell.detect permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not run the scan — try again.',
      );
    } finally {
      setScanning(false);
    }
  }

  function applyUpdate(updated: UpSellRecommendation) {
    setRecommendations((prev) =>
      (prev ?? []).map((r) => (r.id === updated.id ? updated : r)),
    );
  }

  if (loadError) {
    return (
      <p role="alert" style={errorStyle}>
        {loadError}
      </p>
    );
  }
  if (!recommendations) return <p>Loading…</p>;

  return (
    <div style={{ marginTop: '1rem' }}>
      {canScan ? (
        <button
          type="button"
          disabled={scanning}
          style={{ ...buttonStyle, width: 'auto' }}
          onClick={() => void runScan()}
        >
          {scanning ? 'Scanning…' : 'Scan for under-insurance now'}
        </button>
      ) : null}
      {scanError ? (
        <p role="alert" style={errorStyle}>
          {scanError}
        </p>
      ) : null}

      {scan ? (
        <div style={upSellPanelStyle}>
          <strong>Last scan</strong>
          <div style={upSellFigureRowStyle}>
            <span>Designed Sum Insured (JOD): {scan.currentSumInsured}</span>
            <span>Current asset value (JOD): {scan.currentAssetValue}</span>
            <span>Shortfall (JOD): {scan.shortfall}</span>
          </div>
          <div style={cardMetaStyle}>
            {scan.currentSumInsured === '0.000'
              ? 'No designed property Sum Insured to compare against — assemble an insurance program first.'
              : scan.isUnderinsured
                ? scan.flagged
                  ? `Under-insured by more than ${scan.thresholdPercent}% — a recommendation was raised.`
                  : scan.suppressedByPriorResolution
                    ? 'Under-insured, but a prior recommendation at this asset value was already actioned — not re-raised.'
                    : 'Under-insured — a recommendation is already open.'
                : `Adequately insured (within ${scan.thresholdPercent}% of asset value).`}
          </div>
        </div>
      ) : null}

      {recommendations.length === 0 ? (
        <p style={{ opacity: 0.6, marginTop: '1rem' }}>
          No up-sell recommendations for this customer. The nightly scan raises
          one when a customer&apos;s surveyed asset value grows materially past
          their designed property Sum Insured.
        </p>
      ) : (
        <div style={{ marginTop: '1rem' }}>
          {recommendations.map((recommendation) => (
            <RecommendationRow
              key={recommendation.id}
              recommendation={recommendation}
              canConvert={canConvert}
              onChanged={applyUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UpSellFlow() {
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
        and open its up-sell recommendations from there.
      </p>
    );
  }

  return <UpSellForCustomer customerId={customerId} />;
}

export default function UpSellPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Up-sell</h1>
      <p style={{ opacity: 0.8 }}>
        Process 9 — a nightly job compares each customer&apos;s designed
        property Sum Insured against the current value of their surveyed assets
        and proposes an increase where the gap is material. Convert a
        recommendation to take the increase forward, or dismiss it with a
        reason.
      </p>
      <Suspense fallback={null}>
        <UpSellFlow />
      </Suspense>
    </main>
  );
}

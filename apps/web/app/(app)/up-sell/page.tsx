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
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDate } from '../../../lib/i18n/format';
import { hasPermission } from '../../../lib/auth/permissions';


function RecommendationRow({
  recommendation,
  canConvert,
  onChanged,
}: {
  recommendation: UpSellRecommendation;
  canConvert: boolean;
  onChanged: (updated: UpSellRecommendation) => void;
}) {
  const { language, t } = useLanguage();
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
        <strong>{t('upsUnderInsuranceFlagged')}</strong>
        <span style={upSellBadgeStyle}>{recommendation.status}</span>
      </div>
      <div style={upSellFigureRowStyle}>
        <span>Designed Sum Insured (JOD): {recommendation.currentSumInsured}</span>
        <span>Current asset value (JOD): {recommendation.currentAssetValue}</span>
      </div>
      <div style={cardMetaStyle}>
        Flagged {formatDate(recommendation.detectedAt, language)}
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
                t('upsConvertError'),
              )
            }
          >
            {busy ? t('upsWorking') : t('upsConvertButton')}
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
                placeholder={t('upsDismissPlaceholder')}
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
                    t('upsDismissError'),
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
  const { t } = useLanguage();
  const { user } = useAuth();
  const canConvert = hasPermission(user, 'up-sell.convert');
  const canScan =
    hasPermission(user, 'up-sell.detect');

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
            ? t('upsCustomerNotFound')
            : err instanceof ApiError
              ? err.message
              : t('upsLoadError'),
      );
    }
  }, [customerId, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load, t]);

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
            : t('upsScanError'),
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
  if (!recommendations) return <p>{t('upsLoading')}</p>;

  return (
    <div style={{ marginTop: '1rem' }}>
      {canScan ? (
        <button
          type="button"
          disabled={scanning}
          style={{ ...buttonStyle, width: 'auto' }}
          onClick={() => void runScan()}
        >
          {scanning ? t('upsScanning') : t('upsScanButton')}
        </button>
      ) : null}
      {scanError ? (
        <p role="alert" style={errorStyle}>
          {scanError}
        </p>
      ) : null}

      {scan ? (
        <div style={upSellPanelStyle}>
          <strong>{t('upsLastScan')}</strong>
          <div style={upSellFigureRowStyle}>
            <span>Designed Sum Insured (JOD): {scan.currentSumInsured}</span>
            <span>Current asset value (JOD): {scan.currentAssetValue}</span>
            <span>Shortfall (JOD): {scan.shortfall}</span>
          </div>
          <div style={cardMetaStyle}>
            {scan.currentSumInsured === '0.000'
              ? t('upsNoDesignedSi')
              : scan.isUnderinsured
                ? scan.flagged
                  ? `Under-insured by more than ${scan.thresholdPercent}% — a recommendation was raised.`
                  : scan.suppressedByPriorResolution
                    ? t('upsAlreadyActioned')
                    : t('upsAlreadyOpen')
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
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('upsHeading')}</h1>
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

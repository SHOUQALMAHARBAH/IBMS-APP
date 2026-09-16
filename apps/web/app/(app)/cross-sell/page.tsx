'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { SentenceWithLink } from '../../../components/ui/SentenceWithLink';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  convertCrossSellOpportunity,
  detectCrossSell,
  dismissCrossSellOpportunity,
  listCrossSellOpportunities,
  type CrossSellDetectionResult,
  type CrossSellOpportunity,
} from '../../../lib/cross-sell/cross-sell-api';
import { ApiError } from '../../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../../../components/auth/auth-form.styles';
import { cardMetaStyle, pageStyle } from '../../../components/lead/lead.styles';
import {
  crossSellActionsStyle,
  crossSellBadgeStyle,
  crossSellCardStyle,
  crossSellPanelStyle,
} from '../../../components/cross-sell/cross-sell.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDate } from '../../../lib/i18n/format';
import { hasPermission } from '../../../lib/auth/permissions';


function OpportunityRow({
  opportunity,
  canConvert,
  onChanged,
}: {
  opportunity: CrossSellOpportunity;
  canConvert: boolean;
  onChanged: (updated: CrossSellOpportunity) => void;
}) {
  const { language, t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<CrossSellOpportunity>, fallback: string) {
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
    <div style={crossSellCardStyle}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <strong>{opportunity.gapLine}</strong>
        <span style={crossSellBadgeStyle}>{opportunity.status}</span>
      </div>
      <div style={cardMetaStyle}>
        Flagged {formatDate(opportunity.detectedAt, language)}
      </div>
      {opportunity.status === 'DISMISSED' && opportunity.dismissReason ? (
        <div style={cardMetaStyle}>Reason: {opportunity.dismissReason}</div>
      ) : null}

      {opportunity.status === 'OPEN' && canConvert ? (
        <div style={crossSellActionsStyle}>
          <button
            type="button"
            disabled={busy}
            style={{ ...buttonStyle, width: 'auto' }}
            onClick={() =>
              void run(
                () => convertCrossSellOpportunity(opportunity.id),
                t('xsConvertError'),
              )
            }
          >
            {busy ? t('xsWorking') : t('xsConvertButton')}
          </button>
          {dismissing ? (
            <>
              <label htmlFor={`reason-${opportunity.id}`} style={cardMetaStyle}>
                {t('xsWhyNotPursued')}
              </label>
              <input
                id={`reason-${opportunity.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('xsDismissPlaceholder')}
                style={{ minWidth: '18rem' }}
              />
              <button
                type="button"
                disabled={busy || reason.trim().length < 3}
                style={{ ...buttonStyle, width: 'auto' }}
                onClick={() =>
                  void run(
                    () =>
                      dismissCrossSellOpportunity(opportunity.id, reason.trim()),
                    t('xsDismissError'),
                  )
                }
              >
                {t('xsConfirmDismiss')}
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

function CrossSellForCustomer({ customerId }: { customerId: string }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const canConvert = hasPermission(user, 'cross-sell.convert');
  const canScan =
    hasPermission(user, 'cross-sell.detect');

  const [opportunities, setOpportunities] = useState<
    CrossSellOpportunity[] | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scan, setScan] = useState<CrossSellDetectionResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    try {
      setOpportunities(await listCrossSellOpportunities(customerId));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('xsNoPermission')
          : err instanceof ApiError && err.status === 404
            ? t('xsCustomerNotFound')
            : err instanceof ApiError
              ? err.message
              : t('xsLoadError'),
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
      const result = await detectCrossSell(customerId);
      setScan(result);
      await load();
    } catch (err) {
      setScanError(
        err instanceof ApiError && err.status === 403
          ? t('xsNoPermissionDetect')
          : err instanceof ApiError
            ? err.message
            : t('xsScanError'),
      );
    } finally {
      setScanning(false);
    }
  }

  function applyUpdate(updated: CrossSellOpportunity) {
    setOpportunities((prev) =>
      (prev ?? []).map((o) => (o.id === updated.id ? updated : o)),
    );
  }

  if (loadError) {
    return (
      <p role="alert" style={errorStyle}>
        {loadError}
      </p>
    );
  }
  if (!opportunities) return <p>{t('xsLoading')}</p>;

  return (
    <div style={{ marginTop: '1rem' }}>
      {canScan ? (
        <button
          type="button"
          disabled={scanning}
          style={{ ...buttonStyle, width: 'auto' }}
          onClick={() => void runScan()}
        >
          {scanning ? t('xsScanning') : t('xsScanButton')}
        </button>
      ) : null}
      {scanError ? (
        <p role="alert" style={errorStyle}>
          {scanError}
        </p>
      ) : null}

      {scan ? (
        <div style={crossSellPanelStyle}>
          <strong>{t('xsLastScan')}</strong>
          <div style={cardMetaStyle}>
            In-force lines held:{' '}
            {scan.heldLines.length ? scan.heldLines.join(', ') : 'none'}
          </div>
          <div style={cardMetaStyle}>
            Benchmark: {scan.benchmarkLines.join(', ')}
          </div>
          <div style={cardMetaStyle}>
            {scan.heldLines.length === 0
              ? t('xsNoInForceCover')
              : `Gaps: ${scan.gapLines.length ? scan.gapLines.join(', ') : 'none'} · ${scan.newlyFlagged.length} newly flagged`}
          </div>
        </div>
      ) : null}

      {opportunities.length === 0 ? (
        <p style={{ color: 'var(--ink-secondary)', marginTop: '1rem' }}>
          {t('xsNoOpportunities')}
        </p>
      ) : (
        <div style={{ marginTop: '1rem' }}>
          {opportunities.map((opportunity) => (
            <OpportunityRow
              key={opportunity.id}
              opportunity={opportunity}
              canConvert={canConvert}
              onChanged={applyUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CrossSellFlow() {
  const router = useRouter();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const customerId = searchParams.get('customerId') ?? '';

  if (!customerId) {
    return (
      <p role="alert" style={errorStyle}>
        <SentenceWithLink
          sentence={t('xsNoCustomerSelected')}
          linkLabel={t('navCustomers')}
          onLinkClick={() => router.push('/customers')}
        />
      </p>
    );
  }

  return <CrossSellForCustomer customerId={customerId} />;
}

export default function CrossSellPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('xsHeading')}</h1>
      <p style={{ opacity: 0.8 }}>
        {t('xsIntro')}
      </p>
      <Suspense fallback={null}>
        <CrossSellFlow />
      </Suspense>
    </main>
  );
}

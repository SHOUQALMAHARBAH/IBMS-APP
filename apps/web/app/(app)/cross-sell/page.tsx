'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
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

const CAN_CONVERT_ROLE = 'SALES_RELATIONSHIP_OFFICER';
const CAN_SCAN_ROLES = ['SALES_RELATIONSHIP_OFFICER', 'BRANCH_DEPARTMENT_MANAGER'];

function OpportunityRow({
  opportunity,
  canConvert,
  onChanged,
}: {
  opportunity: CrossSellOpportunity;
  canConvert: boolean;
  onChanged: (updated: CrossSellOpportunity) => void;
}) {
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
        Flagged {new Date(opportunity.detectedAt).toLocaleDateString()}
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
                'Could not convert — try again.',
              )
            }
          >
            {busy ? 'Working…' : 'Convert'}
          </button>
          {dismissing ? (
            <>
              <label htmlFor={`reason-${opportunity.id}`} style={cardMetaStyle}>
                Why is this gap not being pursued?
              </label>
              <input
                id={`reason-${opportunity.id}`}
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
                      dismissCrossSellOpportunity(opportunity.id, reason.trim()),
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

function CrossSellForCustomer({ customerId }: { customerId: string }) {
  const { user } = useAuth();
  const canConvert = user?.roles.includes(CAN_CONVERT_ROLE) ?? false;
  const canScan =
    user?.roles.some((role) => CAN_SCAN_ROLES.includes(role)) ?? false;

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
          ? "You don't hold the cross-sell.read permission, so there's nothing to show here."
          : err instanceof ApiError && err.status === 404
            ? 'This customer could not be found — it may not exist, or you may not have access to it.'
            : err instanceof ApiError
              ? err.message
              : 'Could not load cross-sell opportunities — try again.',
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
      const result = await detectCrossSell(customerId);
      setScan(result);
      await load();
    } catch (err) {
      setScanError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the cross-sell.detect permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not run the scan — try again.',
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
  if (!opportunities) return <p>Loading…</p>;

  return (
    <div style={{ marginTop: '1rem' }}>
      {canScan ? (
        <button
          type="button"
          disabled={scanning}
          style={{ ...buttonStyle, width: 'auto' }}
          onClick={() => void runScan()}
        >
          {scanning ? 'Scanning…' : 'Scan for gaps now'}
        </button>
      ) : null}
      {scanError ? (
        <p role="alert" style={errorStyle}>
          {scanError}
        </p>
      ) : null}

      {scan ? (
        <div style={crossSellPanelStyle}>
          <strong>Last scan</strong>
          <div style={cardMetaStyle}>
            In-force lines held:{' '}
            {scan.heldLines.length ? scan.heldLines.join(', ') : 'none'}
          </div>
          <div style={cardMetaStyle}>
            Benchmark: {scan.benchmarkLines.join(', ')}
          </div>
          <div style={cardMetaStyle}>
            {scan.heldLines.length === 0
              ? 'No in-force cover — not a cross-sell target yet.'
              : `Gaps: ${scan.gapLines.length ? scan.gapLines.join(', ') : 'none'} · ${scan.newlyFlagged.length} newly flagged`}
          </div>
        </div>
      ) : null}

      {opportunities.length === 0 ? (
        <p style={{ opacity: 0.6, marginTop: '1rem' }}>
          No cross-sell opportunities for this customer. The nightly scan flags
          a gap when the customer holds an in-force policy but is missing a
          benchmark line.
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
        and open its cross-sell opportunities from there.
      </p>
    );
  }

  return <CrossSellForCustomer customerId={customerId} />;
}

export default function CrossSellPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Cross-sell</h1>
      <p style={{ opacity: 0.8 }}>
        Process 8 — a nightly job compares each customer&apos;s in-force policy
        lines against a benchmark line list and flags the gaps. Convert an
        opportunity to take it forward into an RFQ, or dismiss it with a reason.
      </p>
      <Suspense fallback={null}>
        <CrossSellFlow />
      </Suspense>
    </main>
  );
}

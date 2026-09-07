'use client';

import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createSalesTarget,
  getSalesPerformance,
  updateSalesTarget,
  type SalesPerformance,
} from '../../../lib/management-reporting/sales-performance-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const statRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', margin: '1rem 0' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

function hasAny(roles: string[] | undefined, allowed: string[]): boolean {
  return !!roles && roles.some((r) => allowed.includes(r));
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '0.6rem 0.9rem',
        minWidth: '9rem',
      }}
    >
      <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}

export default function SalesPerformancePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const isManager = hasAny(user?.roles, [
    'BRANCH_DEPARTMENT_MANAGER',
    'EXECUTIVE_MANAGEMENT',
  ]);

  const [ownerUserId, setOwnerUserId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [periodLabel, setPeriodLabel] = useState('');

  const [performance, setPerformance] = useState<SalesPerformance | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLookedUp, setHasLookedUp] = useState(false);

  const [targetPeriodStart, setTargetPeriodStart] = useState('');
  const [targetPeriodEnd, setTargetPeriodEnd] = useState('');
  const [targetNewProspects, setTargetNewProspects] = useState('');
  const [targetError, setTargetError] = useState<string | null>(null);
  const [targetMessage, setTargetMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const load = useCallback(
    async (filters: {
      ownerUserId?: string;
      branchId?: string;
      periodLabel?: string;
    }) => {
      try {
        setPerformance(await getSalesPerformance(filters));
        setLoadError(null);
      } catch (err) {
        setPerformance(null);
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? "You don't hold the dashboard.sales.view permission."
            : err instanceof ApiError
              ? err.message
              : 'Could not load sales performance — try again.',
        );
      } finally {
        setHasLookedUp(true);
      }
    },
    [],
  );

  useEffect(() => {
    if (!user) return;
    if (isManager) return; // a Manager/Executive picks a scope explicitly below
    void (async () => {
      await load({});
    })();
  }, [user, isManager, load]);

  function onLookup(e: FormEvent) {
    e.preventDefault();
    void load({
      ownerUserId: ownerUserId || undefined,
      branchId: branchId || undefined,
      periodLabel: periodLabel || undefined,
    });
  }

  async function onSetTarget(e: FormEvent) {
    e.preventDefault();
    setTargetError(null);
    setTargetMessage(null);
    try {
      if (performance?.target) {
        await updateSalesTarget(
          performance.target.id,
          Number(targetNewProspects),
        );
        setTargetMessage('Target revised.');
      } else {
        await createSalesTarget({
          ownerUserId: ownerUserId || undefined,
          branchId: branchId || undefined,
          periodLabel: periodLabel || `target-${Date.now()}`,
          periodStart: targetPeriodStart,
          periodEnd: targetPeriodEnd,
          targetNewProspects: Number(targetNewProspects),
        });
        setTargetMessage('Target set.');
      }
      await load({
        ownerUserId: ownerUserId || undefined,
        branchId: branchId || undefined,
        periodLabel: periodLabel || undefined,
      });
    } catch (err) {
      setTargetError(err instanceof ApiError ? err.message : 'Could not save the target.');
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Sales Performance</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        New prospects qualified against quota, per Sales/Relationship
        Officer or per branch/team.
      </p>

      {isManager ? (
        <form onSubmit={onLookup} style={formStyle}>
          <h2>Look up performance</h2>
          <label style={labelStyle}>
            Owner user ID
            <input
              value={ownerUserId}
              onChange={(e) => setOwnerUserId(e.target.value)}
              placeholder="one employee"
            />
          </label>
          <label style={labelStyle}>
            Branch ID
            <input
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              placeholder="one team"
            />
          </label>
          <label style={labelStyle}>
            Period label (optional — defaults to the current period)
            <input
              value={periodLabel}
              onChange={(e) => setPeriodLabel(e.target.value)}
            />
          </label>
          <button type="submit">View performance</button>
        </form>
      ) : null}

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {performance ? (
        <>
          <div style={statRow}>
            <Stat
              label="Target — new prospects"
              value={performance.target?.targetNewProspects ?? '—'}
            />
            <Stat
              label="Actual — new prospects"
              value={performance.actual?.newProspects ?? '—'}
            />
            <Stat
              label="Actual — new leads"
              value={performance.actual?.newLeads ?? '—'}
            />
            <Stat
              label="Achievement"
              value={
                performance.achievementPercent === null
                  ? '—'
                  : `${performance.achievementPercent}%`
              }
            />
          </div>
          {performance.target ? (
            <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>
              Period {performance.target.periodLabel} (
              {performance.target.periodStart.slice(0, 10)} to{' '}
              {performance.target.periodEnd.slice(0, 10)}).
            </p>
          ) : (
            <p style={{ opacity: 0.7 }}>No target set for the current period yet.</p>
          )}

          {isManager ? (
            <form onSubmit={onSetTarget} style={formStyle}>
              <h2>{performance.target ? 'Revise target' : 'Set target'}</h2>
              {!performance.target ? (
                <>
                  <label style={labelStyle}>
                    Period start
                    <input
                      type="date"
                      value={targetPeriodStart}
                      onChange={(e) => setTargetPeriodStart(e.target.value)}
                      required
                    />
                  </label>
                  <label style={labelStyle}>
                    Period end
                    <input
                      type="date"
                      value={targetPeriodEnd}
                      onChange={(e) => setTargetPeriodEnd(e.target.value)}
                      required
                    />
                  </label>
                </>
              ) : null}
              <label style={labelStyle}>
                Target new prospects
                <input
                  type="number"
                  min={1}
                  value={targetNewProspects}
                  onChange={(e) => setTargetNewProspects(e.target.value)}
                  required
                />
              </label>
              <button type="submit">
                {performance.target ? 'Revise' : 'Set target'}
              </button>
              {targetError ? (
                <p role="alert" style={errorStyle}>
                  {targetError}
                </p>
              ) : null}
              {targetMessage ? <p>{targetMessage}</p> : null}
            </form>
          ) : null}
        </>
      ) : loadError ? null : hasLookedUp ? null : isManager ? (
        <p style={{ opacity: 0.6 }}>Pick an employee or a branch above.</p>
      ) : (
        <p>Loading&hellip;</p>
      )}
    </main>
  );
}

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
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';
import { EntitySearch } from '../../../components/ui/EntitySearch';

const statRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', margin: '1rem 0' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: 'var(--space-2)', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' };


function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
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
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const isManager = hasPermission(user, 'sales-target.manage');

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
  }, [isLoading, user, router, t]);

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
            ? permissionRefusal(t, 'spRefusalAct', 'dashboard.sales.view')
            : err instanceof ApiError
              ? err.message
              : t('spLoadError'),
        );
      } finally {
        setHasLookedUp(true);
      }
    },
    [t],
  );

  useEffect(() => {
    if (!user) return;
    if (isManager) return; // a Manager/Executive picks a scope explicitly below
    void (async () => {
      await load({});
    })();
  }, [user, isManager, load, t]);

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
        setTargetMessage(t('spTargetRevised'));
      } else {
        await createSalesTarget({
          ownerUserId: ownerUserId || undefined,
          branchId: branchId || undefined,
          periodLabel: periodLabel || `target-${Date.now()}`,
          periodStart: targetPeriodStart,
          periodEnd: targetPeriodEnd,
          targetNewProspects: Number(targetNewProspects),
        });
        setTargetMessage(t('spTargetSet'));
      }
      await load({
        ownerUserId: ownerUserId || undefined,
        branchId: branchId || undefined,
        periodLabel: periodLabel || undefined,
      });
    } catch (err) {
      setTargetError(err instanceof ApiError ? err.message : t('spSaveTargetError'));
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('spHeading')}
        description={t('spIntro')}
      />

      {isManager ? (
        <form onSubmit={onLookup} style={formStyle}>
          <h2>{t('spLookUp')}</h2>
          <EntitySearch
            kind="user"
            value={ownerUserId}
            onChange={setOwnerUserId}
            label={t('spOwnerUserIdLabel')}
          />
          <EntitySearch
            kind="branch"
            value={branchId}
            onChange={setBranchId}
            label={t('dashBranchIdLabel')}
          />
          <label style={labelStyle}>
            {t('spPeriodOptionalLabel')}
            <input
              value={periodLabel}
              onChange={(e) => setPeriodLabel(e.target.value)}
            />
          </label>
          <button type="submit">{t('spViewButton')}</button>
        </form>
      ) : null}

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {performance ? (
        <>
          <div style={statRow}>
            <Stat
              label={t('spTargetNewProspects')}
              value={performance.target?.targetNewProspects ?? '—'}
            />
            <Stat
              label={t('spActualNewProspects')}
              value={performance.actual?.newProspects ?? '—'}
            />
            <Stat
              label={t('spActualNewLeads')}
              value={performance.actual?.newLeads ?? '—'}
            />
            <Stat
              label={t('spAchievement')}
              value={
                performance.achievementPercent === null
                  ? '—'
                  : `${performance.achievementPercent}%`
              }
            />
          </div>
          {performance.target ? (
            <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>
              {t('spPeriodRange', {
                label: performance.target.periodLabel,
                from: performance.target.periodStart.slice(0, 10),
                to: performance.target.periodEnd.slice(0, 10),
              })}
            </p>
          ) : (
            <p style={{ opacity: 0.7 }}>{t('spNoTarget')}</p>
          )}

          {isManager ? (
            <form onSubmit={onSetTarget} style={formStyle}>
              <h2>{performance.target ? t('spReviseButton') : t('spSetButton')}</h2>
              {!performance.target ? (
                <>
                  <label style={labelStyle}>
                    {t('dashPeriodStart')}
                    <input
                      type="date"
                      value={targetPeriodStart}
                      onChange={(e) => setTargetPeriodStart(e.target.value)}
                      required
                    />
                  </label>
                  <label style={labelStyle}>
                    {t('dashPeriodEnd')}
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
                {t('spTargetNewProspects')}
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
                <ErrorState title={targetError} />
              ) : null}
              {targetMessage ? <p>{targetMessage}</p> : null}
            </form>
          ) : null}
        </>
      ) : loadError ? null : hasLookedUp ? null : isManager ? (
        <EmptyState title={t('spPickFirst')} />
      ) : (
        <SkeletonList rows={4} label={t('dashLoading')} />
      )}
    </main>
  );
}

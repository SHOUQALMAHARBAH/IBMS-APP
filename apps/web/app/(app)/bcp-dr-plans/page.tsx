'use client';

import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  BCP_DR_SCENARIOS,
  createBcpDrPlan,
  getBcpDrPlanCoverage,
  recordBcpDrPlanTest,
  type BcpDrPlan,
  type BcpDrScenario,
  type ScenarioCoverage,
} from '../../../lib/supporting-operations/bcp-dr-plan-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  Card,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid var(--border-default)' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: 'var(--space-2)', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' };

function isOverdue(nextTestDueAt: string | null): boolean {
  if (!nextTestDueAt) return false;
  return new Date(nextTestDueAt).getTime() < Date.now();
}

export default function BcpDrPlansPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [coverage, setCoverage] = useState<ScenarioCoverage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [scenario, setScenario] = useState<BcpDrScenario>('system_outage');
  const [rtoHours, setRtoHours] = useState('');
  const [rpoHours, setRpoHours] = useState('');

  const [testingId, setTestingId] = useState<string | null>(null);
  const [nextTestDueAt, setNextTestDueAt] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  const load = useCallback(async () => {
    try {
      setCoverage(await getBcpDrPlanCoverage());
      setLoadError(null);
    } catch (err) {
      setCoverage(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'bcpRefusalAct', 'bcp-dr.manage')
          : err instanceof ApiError
            ? err.message
            : t('bcpLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    try {
      await createBcpDrPlan({
        scenario,
        rtoHours: rtoHours ? Number(rtoHours) : undefined,
        rpoHours: rpoHours ? Number(rpoHours) : undefined,
      });
      setRtoHours('');
      setRpoHours('');
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('bcpCreateError'));
    }
  }

  function startTest(plan: BcpDrPlan) {
    setTestingId(plan.id);
    setNextTestDueAt('');
  }

  async function submitTest(id: string) {
    setActionError(null);
    try {
      await recordBcpDrPlanTest(id, new Date(nextTestDueAt).toISOString());
      setTestingId(null);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('bcpRecordTestError'));
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('bcpHeading')}
        description={t('bcpIntro')}
      />

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}
      {actionError ? (
        <ErrorState title={actionError} />
      ) : null}

      <form onSubmit={onCreate} style={formStyle}>
        <h2>{t('bcpCreateHeading')}</h2>
        <label style={labelStyle}>
          {t('bcpScenario')}
          <select value={scenario} onChange={(e) => setScenario(e.target.value as BcpDrScenario)}>
            {BCP_DR_SCENARIOS.map((s) => (
              <option key={s} value={s}>
                {t(ENUM_LABEL.BcpDrScenario[s])}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          {t('bcpRtoHours')}
          <input type="number" min={0} value={rtoHours} onChange={(e) => setRtoHours(e.target.value)} />
        </label>
        <label style={labelStyle}>
          {t('bcpRpoHours')}
          <input type="number" min={0} value={rpoHours} onChange={(e) => setRpoHours(e.target.value)} />
        </label>
        <button type="submit">{t('bcpSubmitButton')}</button>
      </form>

      {coverage ? (
        coverage.map((entry) => (
          <section key={entry.scenario} style={sectionStyle}>
            <h2>
              {entry.scenario}{' '}
              {entry.hasPlan ? null : <span style={{ color: '#b91c1c' }}>{t('bcpNoPlanOnFile')}</span>}
            </h2>
            {entry.plans.length > 0 ? (
              <Card padded={false}>
            <Table>
                <thead>
                  <tr>
                    <Th>{t('bcpColRto')}</Th>
                    <Th>{t('bcpColRpo')}</Th>
                    <Th>{t('bcpColLastTested')}</Th>
                    <Th>{t('bcpColNextTestDue')}</Th>
                    <th style={head} />
                  </tr>
                </thead>
                <tbody>
                  {entry.plans.map((plan) => (
                    <Tr key={plan.id}>
                      <Td>{plan.rtoHours ?? '—'}</Td>
                      <Td>{plan.rpoHours ?? '—'}</Td>
                      <Td>
                        {plan.lastTestedAt ? plan.lastTestedAt.slice(0, 10) : 'never'}
                      </Td>
                      <Td>
                        {plan.nextTestDueAt ? (
                          <span style={isOverdue(plan.nextTestDueAt) ? { color: '#b91c1c' } : undefined}>
                            {plan.nextTestDueAt.slice(0, 10)}
                            {isOverdue(plan.nextTestDueAt) ? ` ${t('statusOverdue')}` : ''}
                          </span>
                        ) : (
                          'not scheduled'
                        )}
                      </Td>
                      <Td>
                        {testingId === plan.id ? (
                          <>
                            <input
                              type="date"
                              value={nextTestDueAt}
                              onChange={(e) => setNextTestDueAt(e.target.value)}
                            />{' '}
                            <button type="button" onClick={() => submitTest(plan.id)}>
                              {t('commonSave')}
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={() => startTest(plan)}>
                            {t('bcpRecordTestButton')}
                          </button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
          </Card>
            ) : null}
          </section>
        ))
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('bcpLoading')} />
      )}

    </main>
  );
}

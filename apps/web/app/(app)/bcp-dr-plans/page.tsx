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
  DateEcho,
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
import { formatDate } from '../../../lib/i18n/format';

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
  const { t, language } = useLanguage();
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
              {/*
                The ENUM MEMBER was rendering RAW here — `system_outage` as an Arabic reader's
                section heading — while the `<select>` eighteen lines above renders
                `ENUM_LABEL.BcpDrScenario[s]` from a map that ships all five in both languages.
                So the same screen had two answers for one value and the English one was the
                heading. No word was written: the Arabic was already on the screen.
              */}
              {t(ENUM_LABEL.BcpDrScenario[entry.scenario])}{' '}
              {entry.hasPlan ? null : <span style={{ color: 'var(--danger-ink)' }}>{t('bcpNoPlanOnFile')}</span>}
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
                        {/*
                          `.slice(0, 10)` printed the ISO date here, so an Arabic reader saw
                          `2027-09-06` where every other date in the product renders through
                          `formatDate`.

                          The two absence words beside it are the OWNER'S, supplied after this
                          screen stopped rather than guessed — «غير مجدول» is masculine, agreeing
                          with «الفحص», where the byte-identical English twin one screen over
                          (`vendNotScheduled`) carries the FEMININE «غير مجدولة». Her form is the
                          twin minus its taa marbuta, which is precisely why it was not derivable:
                          a one-character cut that changes grammatical gender is morphology.
                        */}
                        {plan.lastTestedAt
                          ? formatDate(plan.lastTestedAt, language)
                          : t('bcpNeverTested')}
                      </Td>
                      <Td>
                        {plan.nextTestDueAt ? (
                          <span
                            style={
                              isOverdue(plan.nextTestDueAt)
                                ? { color: 'var(--danger-ink)' }
                                : undefined
                            }
                          >
                            {formatDate(plan.nextTestDueAt, language)}
                            {isOverdue(plan.nextTestDueAt) ? ` ${t('statusOverdue')}` : ''}
                          </span>
                        ) : (
                          t('bcpNoTestScheduled')
                        )}
                      </Td>
                      <Td>
                        {testingId === plan.id ? (
                          <>
                            {/* NO WRAPPER, and that is the inline-styles ratchet rather than a
                             * taste: a styled `div` here is a NEW SCREEN site and that budget may
                             * only FALL. The echo is a `<p>`, so it breaks the line on its own and
                             * the cell stacks anyway.
                             *
                             * The first version of this comment NAMED the attribute it is about
                             * and counted as the site, because the gate reads TEXT — which is its
                             * own recorded limit, met inside the comment explaining it. */}
                            <label htmlFor="bcp-next-test-due">
                              {t('bcpNextTestDueLabel')}
                            </label>{' '}
                            <input
                              id="bcp-next-test-due"
                              type="date"
                              value={nextTestDueAt}
                              onChange={(e) => setNextTestDueAt(e.target.value)}
                            />
                            <DateEcho value={nextTestDueAt} />
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

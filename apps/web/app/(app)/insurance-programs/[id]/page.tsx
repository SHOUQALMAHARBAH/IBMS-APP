'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  finalizeInsuranceProgram,
  getInsuranceProgram,
  reassembleInsuranceProgram,
  reopenInsuranceProgram,
  type InsuranceProgramWithContext,
} from '../../../../lib/insurance-program/insurance-program-api';
import { createOpportunity } from '../../../../lib/opportunity/opportunity-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { hasPermission } from '../../../../lib/auth/permissions';
import { useLanguage } from '../../../../lib/i18n/language-context';
import {
  profileFieldLabelStyle,
  profileFieldValueStyle,
} from '../../../../components/prospect/prospect.styles';
import {
  programActionsStyle,
  programCellNumStyle,
  programCellStyle,
  programPanelStyle,
  programTableStyle,
} from '../../../../components/insurance-program/insurance-program.styles';


export default function InsuranceProgramDetailPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();

  const [program, setProgram] = useState<InsuranceProgramWithContext | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setProgram(await getInsuranceProgram(params.id));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? t('iprogdNotFound')
          : err instanceof ApiError
            ? err.message
            : t('iprogdLoadError'),
      );
    }
  }, [params.id, t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  async function runAction(
    action: (id: string) => Promise<InsuranceProgramWithContext>,
    failMessage: string,
  ) {
    if (!program) return;
    setActionError(null);
    setBusy(true);
    try {
      setProgram(await action(program.id));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : failMessage);
    } finally {
      setBusy(false);
    }
  }

  async function takeToMarket() {
    if (!program) return;
    setActionError(null);
    setBusy(true);
    const customerId = program.context.customerId;
    try {
      const opportunity = await createOpportunity(program.id);
      router.push(`/opportunities/${opportunity.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && customerId) {
        // A live Opportunity already exists for this programme — go to the
        // customer's opportunity list rather than dead-ending.
        router.push(`/opportunities?customerId=${customerId}`);
        return;
      }
      setActionError(
        err instanceof ApiError
          ? err.message
          : t('iprogdToMarketError'),
      );
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  const isPlacement = hasPermission(user, 'program.assemble');
  const ctx = program?.context;

  return (
    <main style={pageStyle}>
      <button
        type="button"
        onClick={() =>
          router.push(
            ctx?.customerId
              ? `/insurance-programs?customerId=${ctx.customerId}`
              : '/insurance-programs',
          )
        }
        style={{ cursor: 'pointer' }}
      >
        {t('iprogdBackToList')}
      </button>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {program && ctx ? (
        <>
          <h1>Insurance program{ctx.siteLabel ? ` — ${ctx.siteLabel}` : ''}</h1>
          <p style={{ opacity: 0.8 }}>Status: {program.status}</p>

          <div
            style={{
              display: 'flex',
              gap: '2rem',
              flexWrap: 'wrap',
              marginTop: '1rem',
            }}
          >
            <div>
              <div style={profileFieldLabelStyle}>{t('iprogdSourceNeedsAssessment')}</div>
              <div style={profileFieldValueStyle}>
                {ctx.needsAssessmentId ? (
                  <button
                    type="button"
                    style={{
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      font: 'inherit',
                      color: 'inherit',
                    }}
                    onClick={() =>
                      router.push(
                        `/needs-assessments/${ctx.needsAssessmentId}`,
                      )
                    }
                  >
                    {ctx.needsAssessmentId.slice(0, 8)} ({ctx.needsAssessmentStatus})
                  </button>
                ) : (
                  '—'
                )}
              </div>
            </div>
            <div>
              <div style={profileFieldLabelStyle}>{t('iprogdAssetSurvey')}</div>
              <div style={profileFieldValueStyle}>
                {ctx.surveyComplete
                  ? `${ctx.sumInsured.assetCount} asset${ctx.sumInsured.assetCount === 1 ? '' : 's'} surveyed`
                  : t('iprogdNotStarted')}
              </div>
            </div>
          </div>

          <div style={programPanelStyle}>
            <strong>{t('iprogdDerivedSi')}</strong>
            <p style={{ opacity: 0.7, margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
              {t('iprogdReassemblyNote')}
            </p>
            <div
              style={{
                display: 'flex',
                gap: '1.5rem',
                flexWrap: 'wrap',
                marginTop: '0.5rem',
              }}
            >
              <span>Property (JOD): {ctx.sumInsured.propertySumInsured}</span>
              <span>
                Business Interruption (JOD):{' '}
                {ctx.sumInsured.businessInterruptionSumInsured}
              </span>
              <span>
                Indemnity period:{' '}
                {ctx.sumInsured.indemnityPeriodMonths == null
                  ? '—'
                  : `${ctx.sumInsured.indemnityPeriodMonths} months`}
              </span>
            </div>
          </div>

          <h2 style={{ marginTop: '2rem' }}>{t('iprogdLines')}</h2>
          {program.lines.length === 0 ? (
            <p style={{ color: 'var(--ink-secondary)' }}>{t('iprogdNoLines')}</p>
          ) : (
            <table style={programTableStyle}>
              <thead>
                <tr>
                  <th style={programCellStyle}>{t('iprogdColLine')}</th>
                  <th style={programCellNumStyle}>{t('iprogdColSiBasis')}</th>
                </tr>
              </thead>
              <tbody>
                {program.lines.map((line) => (
                  <tr key={line.id}>
                    <td style={programCellStyle}>
                      <bdi>{line.insuranceLine}</bdi>
                    </td>
                    <td style={programCellNumStyle}>
                      {line.sumInsuredBasis ?? 'set at quotation'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {isPlacement ? (
            <div style={programActionsStyle}>
              {program.status === 'DRAFT' ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    style={buttonStyle}
                    onClick={() =>
                      void runAction(
                        finalizeInsuranceProgram,
                        t('iprogdFinalizeError'),
                      )
                    }
                  >
                    {busy ? t('iprogdWorking') : t('iprogdFinalizeButton')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    style={{ ...buttonStyle, width: 'auto' }}
                    onClick={() =>
                      void runAction(
                        reassembleInsuranceProgram,
                        t('iprogdReassembleError'),
                      )
                    }
                  >
                    {t('iprogdReassembleButton')}
                  </button>
                </>
              ) : null}
              {program.status === 'FINALIZED' ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    style={buttonStyle}
                    onClick={() => void takeToMarket()}
                  >
                    {busy ? t('commonWorking') : t('iprogdToMarketButton')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    style={{ ...buttonStyle, width: 'auto' }}
                    onClick={() =>
                      void runAction(
                        reopenInsuranceProgram,
                        t('iprogdReopenError'),
                      )
                    }
                  >
                    {t('iprogdReopenButton')}
                  </button>
                </>
              ) : null}
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

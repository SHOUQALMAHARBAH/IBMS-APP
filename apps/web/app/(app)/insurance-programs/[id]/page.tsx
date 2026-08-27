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
import { ApiError } from '../../../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
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

const PLACEMENT_ROLE = 'PLACEMENT_TECHNICAL_OFFICER';

export default function InsuranceProgramDetailPage() {
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
          ? 'This insurance program could not be found — it may not exist, or you may not have access to it.'
          : err instanceof ApiError
            ? err.message
            : 'Could not load this insurance program — try again.',
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

  if (isLoading || !user) return null;

  const isPlacement = user.roles.includes(PLACEMENT_ROLE);
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
        ← All insurance programs
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
              <div style={profileFieldLabelStyle}>Source needs assessment</div>
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
              <div style={profileFieldLabelStyle}>Asset survey</div>
              <div style={profileFieldValueStyle}>
                {ctx.surveyComplete
                  ? `${ctx.sumInsured.assetCount} asset${ctx.sumInsured.assetCount === 1 ? '' : 's'} surveyed`
                  : 'Not started — Property / BI lines have no Sum Insured basis yet'}
              </div>
            </div>
          </div>

          <div style={programPanelStyle}>
            <strong>Derived Sum Insured (from the risk survey)</strong>
            <p style={{ opacity: 0.7, margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
              A re-assembly would seed the Property All Risks and Business
              Interruption lines from these figures.
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

          <h2 style={{ marginTop: '2rem' }}>Program lines</h2>
          {program.lines.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No lines.</p>
          ) : (
            <table style={programTableStyle}>
              <thead>
                <tr>
                  <th style={programCellStyle}>Insurance line</th>
                  <th style={programCellNumStyle}>Sum Insured basis (JOD)</th>
                </tr>
              </thead>
              <tbody>
                {program.lines.map((line) => (
                  <tr key={line.id}>
                    <td style={programCellStyle}>{line.insuranceLine}</td>
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
                        'Could not finalize — try again.',
                      )
                    }
                  >
                    {busy ? 'Working…' : 'Finalize'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    style={{ ...buttonStyle, width: 'auto' }}
                    onClick={() =>
                      void runAction(
                        reassembleInsuranceProgram,
                        'Could not re-assemble — try again.',
                      )
                    }
                  >
                    Re-assemble from current results
                  </button>
                </>
              ) : null}
              {program.status === 'FINALIZED' ? (
                <button
                  type="button"
                  disabled={busy}
                  style={{ ...buttonStyle, width: 'auto' }}
                  onClick={() =>
                    void runAction(
                      reopenInsuranceProgram,
                      'Could not reopen — try again.',
                    )
                  }
                >
                  Reopen for revision
                </button>
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

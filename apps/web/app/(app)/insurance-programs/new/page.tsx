'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../../lib/i18n/enum-labels';
import { useRouter, useSearchParams } from 'next/navigation';
import { hasPermission } from '../../../../lib/auth/permissions';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getNeedsAssessment,
  type NeedsAssessment,
} from '../../../../lib/needs-assessment/needs-assessment-api';
import { assembleInsuranceProgram } from '../../../../lib/insurance-program/insurance-program-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';
import {
  coverageTagListStyle,
  coverageTagStyle,
} from '../../../../components/needs-assessment/needs-assessment.styles';

function AssembleFlow() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const needsAssessmentId = searchParams.get('needsAssessmentId') ?? '';

  const [assessment, setAssessment] = useState<NeedsAssessment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assembleError, setAssembleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!needsAssessmentId) return;
    try {
      setAssessment(await getNeedsAssessment(needsAssessmentId));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? t('iprognNotFound')
          : err instanceof ApiError
            ? err.message
            : t('iprognLoadError'),
      );
    }
  }, [needsAssessmentId, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load, t]);

  async function handleAssemble() {
    setAssembleError(null);
    setBusy(true);
    try {
      const program = await assembleInsuranceProgram(needsAssessmentId);
      router.push(`/insurance-programs/${program.id}`);
    } catch (err) {
      setAssembleError(
        err instanceof ApiError
          ? err.message
          : t('iprognAssembleError'),
      );
      setBusy(false);
    }
  }

  if (!needsAssessmentId) {
    return (
      <p role="alert" style={errorStyle}>
        {t('iprognNoAssessmentSelected')}
      </p>
    );
  }

  if (loadError) {
    return (
      <p role="alert" style={errorStyle}>
        {loadError}
      </p>
    );
  }
  if (!assessment) return <p>{t('iprognLoading')}</p>;

  const isApproved = assessment.status === 'APPROVED';

  return (
    <>
      <p style={{ opacity: 0.8 }}>
        {/*
          The truncated uuid is gone. Rule 2: what identifies a record to a person must be something the
          person recognises, and `3f8a1c2b` is not — the reader arrived here BY selecting this assessment,
          so naming it back at them added nothing. `NeedsAssessment` carries no human-readable name (only
          `customerId` and `riskProfileId`, both uuids), so the honest line is what the screen needs: the
          status, which the refusal below depends on.
        */}
        {t('iprognAssessmentStatus', {
          status: t(ENUM_LABEL.NeedsAssessmentStatus[assessment.status]),
        })}
      </p>

      {!isApproved ? (
        <p role="alert" style={errorStyle}>
          {t('iprognOnlyApproved')} <strong>{t('iprognApprovedWord')}</strong>.{' '}
          {t('iprognThisOneIs', { status: assessment.status })}
        </p>
      ) : null}

      <h2 style={{ marginTop: '1.5rem' }}>{t('iprognCoverageLines')}</h2>
      {assessment.recommendedCoverageLines.length === 0 ? (
        <p style={{ color: 'var(--ink-secondary)' }}>
          {t('iprognNoLines')}
        </p>
      ) : (
        <ul style={coverageTagListStyle}>
          {assessment.recommendedCoverageLines.map((line) => (
            <li key={line} style={coverageTagStyle}>
              {line}
            </li>
          ))}
        </ul>
      )}

      <p style={{ opacity: 0.7, fontSize: '0.85rem', marginTop: '1rem' }}>
        {t('iprognIntro')}
      </p>

      <button
        type="button"
        disabled={busy || !isApproved || assessment.recommendedCoverageLines.length === 0}
        style={buttonStyle}
        onClick={() => void handleAssemble()}
      >
        {busy ? t('iprognAssembling') : t('iprognAssembleButton')}
      </button>

      {assembleError ? (
        <p role="alert" style={errorStyle}>
          {assembleError}
        </p>
      ) : null}
    </>
  );
}

export default function NewInsuranceProgramPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  if (isLoading || !user) return null;

  /*
   * MEASURED, and it is a reachable state rather than a theoretical one.
   *
   * `program.assemble` is held by PLACEMENT ALONE, while `needs-assessment.read` — which is what gets you
   * to the assessment this screen designs from — is held by SALES, PLACEMENT, MANAGER and EXEC. So three
   * roles could open this form, fill it in, and get the API's own English message on submit.
   *
   * The button that leads here IS gated (on the same permission, correctly), so the state is reached by
   * typing the URL. That makes it rarer, not acceptable: four sibling create screens refuse in words, and
   * the directive's rule is that a control a role cannot use does not exist on their screen.
   */
  if (!hasPermission(user, 'program.assemble')) {
    return (
      <main style={pageStyle}>
        <h1>{t('iprognHeading')}</h1>
        <p role="status" style={{ marginTop: '1rem' }}>
          {permissionRefusal(t, 'iprognRefusalAct', 'program.assemble')}
        </p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <button
        type="button"
        onClick={() => router.back()}
        style={{ cursor: 'pointer' }}
      >
        ← {t('commonBack')}
      </button>
      <h1>{t('iprognHeading')}</h1>
      <Suspense fallback={null}>
        <AssembleFlow />
      </Suspense>
    </main>
  );
}

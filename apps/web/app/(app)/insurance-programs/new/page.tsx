'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getNeedsAssessment,
  type NeedsAssessment,
} from '../../../../lib/needs-assessment/needs-assessment-api';
import { assembleInsuranceProgram } from '../../../../lib/insurance-program/insurance-program-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import {
  coverageTagListStyle,
  coverageTagStyle,
} from '../../../../components/needs-assessment/needs-assessment.styles';

function AssembleFlow() {
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
          ? 'That needs assessment could not be found — it may not exist, or you may not have access to it.'
          : err instanceof ApiError
            ? err.message
            : 'Could not load the needs assessment — try again.',
      );
    }
  }, [needsAssessmentId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

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
          : 'Could not assemble the program — try again.',
      );
      setBusy(false);
    }
  }

  if (!needsAssessmentId) {
    return (
      <p role="alert" style={errorStyle}>
        No needs assessment selected — open an approved needs assessment and
        assemble the program from there.
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
  if (!assessment) return <p>Loading…</p>;

  const isApproved = assessment.status === 'APPROVED';

  return (
    <>
      <p style={{ opacity: 0.8 }}>
        Needs assessment {assessment.id.slice(0, 8)} — status {assessment.status}.
      </p>

      {!isApproved ? (
        <p role="alert" style={errorStyle}>
          A program can only be assembled from an <strong>approved</strong>{' '}
          needs assessment. This one is {assessment.status}.
        </p>
      ) : null}

      <h2 style={{ marginTop: '1.5rem' }}>Coverage lines to assemble</h2>
      {assessment.recommendedCoverageLines.length === 0 ? (
        <p style={{ opacity: 0.6 }}>
          This needs assessment recommends no coverage lines — nothing to
          assemble.
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
        Property All Risks and Business Interruption lines are seeded with the
        Sum Insured derived from the risk survey; every other line&apos;s basis
        is set later at the quotation stage.
      </p>

      <button
        type="button"
        disabled={busy || !isApproved || assessment.recommendedCoverageLines.length === 0}
        style={buttonStyle}
        onClick={() => void handleAssemble()}
      >
        {busy ? 'Assembling…' : 'Assemble insurance program'}
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
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <button
        type="button"
        onClick={() => router.back()}
        style={{ cursor: 'pointer' }}
      >
        ← Back
      </button>
      <h1>Assemble an insurance program</h1>
      <Suspense fallback={null}>
        <AssembleFlow />
      </Suspense>
    </main>
  );
}

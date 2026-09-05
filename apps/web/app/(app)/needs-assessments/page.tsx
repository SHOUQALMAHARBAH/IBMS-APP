'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  listNeedsAssessments,
  type NeedsAssessment,
} from '../../../lib/needs-assessment/needs-assessment-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { cardMetaStyle, cardStyle, pageStyle } from '../../../components/lead/lead.styles';
import { listGridStyle } from '../../../components/needs-assessment/needs-assessment.styles';

export default function NeedsAssessmentsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [assessments, setAssessments] = useState<NeedsAssessment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAssessments(await listNeedsAssessments());
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the needs-assessment.read permission, so there's nothing to show here."
          : err instanceof ApiError
            ? err.message
            : 'Could not load needs assessments — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Needs assessments</h1>
      <p style={{ opacity: 0.8 }}>
        Process 5 — a structured risk questionnaire that recommends a coverage list, then a
        review and approval gate. Start one from a customer&apos;s profile.
      </p>

      {assessments === null && !loadError ? <p>Loading…</p> : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}
      {assessments !== null && !loadError ? (
        assessments.length === 0 ? (
          <p style={{ opacity: 0.6, marginTop: '1rem' }}>No needs assessments yet.</p>
        ) : (
          <div style={listGridStyle}>
            {assessments.map((assessment) => (
              <button
                key={assessment.id}
                type="button"
                style={{ ...cardStyle, textAlign: 'left', width: '100%', cursor: 'pointer' }}
                aria-label={`View needs assessment ${assessment.id}`}
                onClick={() => router.push(`/needs-assessments/${assessment.id}`)}
              >
                <strong>Status: {assessment.status}</strong>
                <div style={cardMetaStyle}>
                  {assessment.recommendedCoverageLines.length} coverage line
                  {assessment.recommendedCoverageLines.length === 1 ? '' : 's'} recommended
                </div>
                <div style={cardMetaStyle}>
                  Updated {new Date(assessment.updatedAt).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        )
      ) : null}
    </main>
  );
}

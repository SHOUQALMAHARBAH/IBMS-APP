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
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDate } from '../../../lib/i18n/format';

export default function NeedsAssessmentsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language, t, tPlural } = useLanguage();

  const [assessments, setAssessments] = useState<NeedsAssessment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAssessments(await listNeedsAssessments());
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('naNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('naLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('naHeading')}</h1>
      <p style={{ opacity: 0.8 }}>
        Process 5 — a structured risk questionnaire that recommends a coverage list, then a
        review and approval gate. Start one from a customer&apos;s profile.
      </p>

      {assessments === null && !loadError ? <p>{t('naLoading')}</p> : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}
      {assessments !== null && !loadError ? (
        assessments.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)', marginTop: '1rem' }}>{t('naNone')}</p>
        ) : (
          <div style={listGridStyle}>
            {assessments.map((assessment) => (
              <button
                key={assessment.id}
                type="button"
                style={{ ...cardStyle, textAlign: 'start', width: '100%', cursor: 'pointer' }}
                aria-label={t('naViewAssessmentAria', { id: assessment.id })}
                onClick={() => router.push(`/needs-assessments/${assessment.id}`)}
              >
                <strong>Status: {assessment.status}</strong>
                <div style={cardMetaStyle}>
                  {tPlural(
                    'naCoverageLinesRecommended',
                    assessment.recommendedCoverageLines.length,
                  )}
                </div>
                <div style={cardMetaStyle}>
                  Updated {formatDate(assessment.updatedAt, language)}
                </div>
              </button>
            ))}
          </div>
        )
      ) : null}
    </main>
  );
}

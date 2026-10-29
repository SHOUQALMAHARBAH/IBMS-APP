'use client';

import { useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  listNeedsAssessments,
  type NeedsAssessment,
} from '../../../lib/needs-assessment/needs-assessment-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  ErrorState,
  PageHeader,
  SkeletonList,
} from '../../../components/ui';
import {
  cardMetaStyle,
  cardStyle,
  pageStackStyle,
} from '../../../components/lead/lead.styles';
import { listGridStyle } from '../../../components/needs-assessment/needs-assessment.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDate } from '../../../lib/i18n/format';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

export default function NeedsAssessmentsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language, t, tPlural } = useLanguage();

  const [assessments, setAssessments] = useState<NeedsAssessment[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAssessments(await listNeedsAssessments());
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'naRefusalAct', 'needs-assessment.read')
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
    <main style={pageStackStyle}>
      <PageHeader
        title={t('naHeading')}
        description={t('naIntro')}
      />

      {assessments === null && !loadError ? <SkeletonList rows={4} label={t('naLoading')} /> : null}
      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}
      {assessments !== null && !loadError ? (
        assessments.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)', marginTop: '1rem' }}>
            {t('naNone')}
          </p>
        ) : (
          <div style={listGridStyle}>
            {assessments.map((assessment) => (
              <button
                key={assessment.id}
                type="button"
                style={{
                  ...cardStyle,
                  textAlign: 'start',
                  width: '100%',
                  cursor: 'pointer',
                }}
                aria-label={t('naViewAssessmentAria', {
                  at: formatDate(assessment.createdAt, language),
                })}
                onClick={() =>
                  router.push(`/needs-assessments/${assessment.id}`)
                }
              >
                <strong>
                  {t('commonStatusLabel')}{' '}
                  {t(ENUM_LABEL.NeedsAssessmentStatus[assessment.status])}
                </strong>
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

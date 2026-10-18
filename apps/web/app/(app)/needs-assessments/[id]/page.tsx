'use client';

import { useCallback, useEffect, useState } from 'react';
import { CombinedDutyOnRecord } from '../../../../components/ui/CombinedDutyOnRecord';
import { ENUM_LABEL } from '../../../../lib/i18n/enum-labels';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getNeedsAssessment,
  getQuestionnaire,
  submitNeedsAssessment,
  type NeedsAssessment,
  type NeedsAssessmentQuestion,
} from '../../../../lib/needs-assessment/needs-assessment-api';
import { NeedsAssessmentForm } from '../../../../components/needs-assessment/NeedsAssessmentForm';
import { NeedsAssessmentReviewPanel } from '../../../../components/needs-assessment/NeedsAssessmentReviewPanel';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  buttonStyle,
  errorStyle,
} from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import {
  coveragePreviewStyle,
  coverageTagListStyle,
  coverageTagStyle,
} from '../../../../components/needs-assessment/needs-assessment.styles';
import {
  profileFieldLabelStyle,
  profileFieldValueStyle,
} from '../../../../components/prospect/prospect.styles';
import { ConsentCaptureWidget } from '../../../../components/pdpl/ConsentCaptureWidget';
import { PrivacyNoticeDisplay } from '../../../../components/pdpl/PrivacyNoticeDisplay';
import { hasPermission } from '../../../../lib/auth/permissions';
import { useLanguage } from '../../../../lib/i18n/language-context';
import {
  loadIndependently,
  namedFailures,
} from '../../../../lib/load-independently';

export default function NeedsAssessmentDetailPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();

  const [assessment, setAssessment] = useState<NeedsAssessment | null>(null);
  const [questions, setQuestions] = useState<NeedsAssessmentQuestion[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /*
   * ITEM 8 — the two reads are NOT equally load-bearing, and the old `Promise.all` treated them
   * as if they were.
   *
   * The assessment IS the page: without it there is nothing to show, so its failure keeps the
   * not-found sentence exactly as before. The QUESTIONNAIRE only supplies the question text, and
   * losing it used to take down an assessment that had arrived — so a refused questionnaire now
   * leaves the record on screen and says which list is missing.
   */
  const load = useCallback(async () => {
    const { values, failures } = await loadIndependently([
      {
        key: 'assessment',
        label: t('nadListAssessment'),
        load: () => getNeedsAssessment(params.id),
      },
      {
        key: 'questionnaire',
        label: t('nadListQuestionnaire'),
        load: getQuestionnaire,
      },
    ]);
    if (values.assessment) setAssessment(values.assessment as NeedsAssessment);
    if (values.questionnaire)
      setQuestions((values.questionnaire as { questions: NeedsAssessmentQuestion[] }).questions);

    const assessmentFailure = failures.find((f) => f.key === 'assessment');
    if (assessmentFailure) {
      const err = assessmentFailure.error;
      setLoadError(
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? t('nadNotFound')
          : err instanceof ApiError
            ? err.message
            : t('nadLoadError'),
      );
      return;
    }
    setLoadError(
      failures.length === 0
        ? null
        : `${t('commonListsMissing')} ${namedFailures(failures)}`,
    );
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

  async function handleSubmitForReview() {
    if (!assessment) return;
    setActionError(null);
    setSubmitting(true);
    try {
      setAssessment(await submitNeedsAssessment(assessment.id));
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('nadSubmitError'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading || !user) return null;

  const isCreator = assessment?.createdByUserId === user.id;
  const isManager = hasPermission(user, 'needs-assessment.approve');
  const isPlacement = hasPermission(user, 'program.assemble');
  const inReview =
    assessment?.status === 'PENDING_REVIEW' ||
    assessment?.status === 'REVIEWED';

  return (
    <main style={pageStyle}>
      <button
        type="button"
        onClick={() => router.push('/needs-assessments')}
        style={{ cursor: 'pointer' }}
      >
        {t('nadBackToList')}
      </button>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {assessment ? (
        <>
          <h1>{t('nadHeading')}</h1>
          <p style={{ opacity: 0.8 }}>
            {t('commonStatusLabel')}{' '}
            {t(ENUM_LABEL.NeedsAssessmentStatus[assessment.status])}
          </p>

          <ConsentCaptureWidget
            customerId={assessment.customerId}
            purpose="UNDERWRITING"
            label={t('nadConsent')}
            defaultConsentTextVersion="underwriting-notice-v1"
          />
          <PrivacyNoticeDisplay
            touchpoint="needs_risk_assessment"
            canRead={hasPermission(user, 'privacy-notice.read')}
          />

          <div style={coveragePreviewStyle}>
            <strong>{t('nadRecommendedCoverage')}</strong>
            {assessment.recommendedCoverageLines.length === 0 ? (
              <p
                style={{ color: 'var(--ink-secondary)', margin: '0.5rem 0 0' }}
              >
                {t('nadNoCoverageLines')}
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
          </div>

          <div
            style={{
              display: 'flex',
              gap: '2rem',
              flexWrap: 'wrap',
              marginTop: '1.5rem',
            }}
          >
            <div>
              <div style={profileFieldLabelStyle}>{t('nadReviewedBy')}</div>
              <div style={profileFieldValueStyle}>
                {assessment.reviewedByUserId ?? '—'}
                {/*
                  Part 4 step 5. The row names a reviewer whether that was a second person or the
                  capturer herself. Under the REVIEWER row specifically, because the approval below has
                  its own act and its own column — merging them would lose which one was doubled up.
                */}
                <CombinedDutyOnRecord
                  act={assessment.reviewerCombinedDutyAct}
                  testId="combined-duty-assessment-reviewer"
                />
              </div>
            </div>
            <div>
              <div style={profileFieldLabelStyle}>{t('nadApprovedBy')}</div>
              <div style={profileFieldValueStyle}>
                {assessment.approvedByUserId ?? '—'}
                <CombinedDutyOnRecord
                  act={assessment.approverCombinedDutyAct}
                  testId="combined-duty-assessment-approver"
                />
              </div>
            </div>
          </div>

          {assessment.status === 'DRAFT' && isCreator ? (
            <>
              <NeedsAssessmentForm
                mode="edit"
                assessmentId={assessment.id}
                initialAnswers={assessment.questionnaireAnswers}
                onSaved={(updated) => setAssessment(updated)}
              />
              <button
                type="button"
                disabled={submitting}
                style={buttonStyle}
                onClick={() => void handleSubmitForReview()}
              >
                {submitting ? t('nadSubmitting') : t('nadSubmitButton')}
              </button>
              {actionError ? (
                <p role="alert" style={errorStyle}>
                  {actionError}
                </p>
              ) : null}
            </>
          ) : null}

          {inReview && isManager ? (
            <NeedsAssessmentReviewPanel
              assessment={assessment}
              onChanged={(updated) => setAssessment(updated)}
            />
          ) : null}

          {inReview && !isManager ? (
            <p style={{ opacity: 0.7, marginTop: '1.5rem' }}>
              {t('nadAwaitingManager')}
            </p>
          ) : null}

          {assessment.status === 'APPROVED' && isPlacement ? (
            <button
              type="button"
              style={{ ...buttonStyle, marginTop: '1.5rem' }}
              onClick={() =>
                router.push(
                  `/insurance-programs/new?needsAssessmentId=${assessment.id}`,
                )
              }
            >
              {t('nadAssembleProgramButton')}
            </button>
          ) : null}

          {assessment.status === 'APPROVED' && !isPlacement ? (
            <p style={{ opacity: 0.7, marginTop: '1.5rem' }}>
              {t('nadApprovedPlacementNote')}
            </p>
          ) : null}

          <section style={{ marginTop: '2rem' }}>
            <h2>{t('nadAnswers')}</h2>
            <ul>
              {questions.map((q) => (
                <li key={q.id}>
                  {q.prompt}{' '}
                  <strong>
                    {q.type === 'number'
                      ? String(assessment.questionnaireAnswers[q.id] ?? 0)
                      : assessment.questionnaireAnswers[q.id]
                        ? 'Yes'
                        : 'No'}
                  </strong>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </main>
  );
}

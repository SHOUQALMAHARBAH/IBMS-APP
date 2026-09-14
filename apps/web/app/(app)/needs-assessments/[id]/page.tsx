'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { buttonStyle, errorStyle } from '../../../../components/auth/auth-form.styles';
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

  const load = useCallback(async () => {
    try {
      const [result, questionnaire] = await Promise.all([
        getNeedsAssessment(params.id),
        getQuestionnaire(),
      ]);
      setAssessment(result);
      setQuestions(questionnaire.questions);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? t('nadNotFound')
          : err instanceof ApiError
            ? err.message
            : t('nadLoadError'),
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

  async function handleSubmitForReview() {
    if (!assessment) return;
    setActionError(null);
    setSubmitting(true);
    try {
      setAssessment(await submitNeedsAssessment(assessment.id));
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : t('nadSubmitError'),
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
    assessment?.status === 'PENDING_REVIEW' || assessment?.status === 'REVIEWED';

  return (
    <main style={pageStyle}>
      <button
        type="button"
        onClick={() => router.push('/needs-assessments')}
        style={{ cursor: 'pointer' }}
      >
        ← All needs assessments
      </button>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {assessment ? (
        <>
          <h1>{t('nadHeading')}</h1>
          <p style={{ opacity: 0.8 }}>Status: {assessment.status}</p>

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
              <p style={{ opacity: 0.6, margin: '0.5rem 0 0' }}>
                No coverage lines recommended from the current answers.
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

          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginTop: '1.5rem' }}>
            <div>
              <div style={profileFieldLabelStyle}>{t('nadReviewedBy')}</div>
              <div style={profileFieldValueStyle}>
                {assessment.reviewedByUserId ?? '—'}
              </div>
            </div>
            <div>
              <div style={profileFieldLabelStyle}>{t('nadApprovedBy')}</div>
              <div style={profileFieldValueStyle}>
                {assessment.approvedByUserId ?? '—'}
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
              Awaiting review and approval by a Branch/Department Manager.
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
              Assemble insurance program →
            </button>
          ) : null}

          {assessment.status === 'APPROVED' && !isPlacement ? (
            <p style={{ opacity: 0.7, marginTop: '1.5rem' }}>
              Approved — a Placement/Technical Officer can now assemble the
              insurance program.
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

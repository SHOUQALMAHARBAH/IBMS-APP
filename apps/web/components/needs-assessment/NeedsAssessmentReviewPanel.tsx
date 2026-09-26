'use client';

import { useState } from 'react';
import { useAuth } from '../../lib/auth/auth-context';
import {
  CombinedDutyReasonField,
  combinedDutyTooShort,
  needsCombinedDutyDeclaration,
} from '../ui/CombinedDutyReasonField';
import { useLanguage } from '../../lib/i18n/language-context';
import {
  approveNeedsAssessment,
  rejectNeedsAssessment,
  returnNeedsAssessment,
  reviewNeedsAssessment,
  type NeedsAssessment,
} from '../../lib/needs-assessment/needs-assessment-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle, inputStyle, labelStyle } from '../auth/auth-form.styles';
import { reviewActionsStyle, reviewPanelStyle } from './needs-assessment.styles';

interface NeedsAssessmentReviewPanelProps {
  assessment: NeedsAssessment;
  onChanged: (assessment: NeedsAssessment) => void;
}

/** The Branch/Department Manager's review + approval controls
 * (needs-assessment.approve). Rendered only for a PENDING_REVIEW or REVIEWED
 * assessment. A reason is required to return for changes or to reject — the
 * backend enforces it too. Maker/checker (the manager can't be the officer
 * who captured it) is enforced server-side; a violation surfaces here as
 * the API's 403 message. */
export function NeedsAssessmentReviewPanel({
  assessment,
  onChanged,
}: NeedsAssessmentReviewPanelProps) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { user } = useAuth();
  const [dutyReason, setDutyReason] = useState('');
  // Computed once and used by both buttons: the maker is the same person for review and approve, and the
  // status decides which button is on screen.
  const needsDeclaration = needsCombinedDutyDeclaration({
    mode: user?.dutySegregationMode,
    makerUserId: assessment.createdByUserId,
    currentUserId: user?.id ?? '',
    alreadyDecided: false,
  });

  async function run(action: string, fn: () => Promise<NeedsAssessment>) {
    setError(null);
    setBusy(action);
    try {
      onChanged(await fn());
      setReason('');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t('nadActionError'),
      );
    } finally {
      setBusy(null);
    }
  }

  const needsReason = reason.trim().length === 0;

  return (
    <section style={reviewPanelStyle} aria-label={t('nadReviewPanelHeading')}>
      <h2 style={{ marginTop: 0 }}>{t('nadReviewApprovalHeading')}</h2>
      <p style={{ opacity: 0.8 }}>
        {assessment.status === 'PENDING_REVIEW'
          ? t('nadPendingReviewNote')
          : t('nadReviewedNote')}
      </p>

      <div style={reviewActionsStyle}>
        {/*
          Part 4 — the officer who captured the assessment may review AND approve it in an office that has
          declared COMBINED, only by saying why. One box serves both buttons: only one of them is ever
          rendered at a time, because the status decides which.
        */}
        {needsDeclaration ? (
          <CombinedDutyReasonField
            id={assessment.id}
            value={dutyReason}
            onChange={setDutyReason}
          />
        ) : null}
        {assessment.status === 'PENDING_REVIEW' ? (
          <button
            type="button"
            disabled={
              busy !== null ||
              (needsDeclaration && combinedDutyTooShort(dutyReason))
            }
            style={{ ...buttonStyle, marginTop: 0, width: 'auto' }}
            onClick={() =>
              void run('review', () =>
                reviewNeedsAssessment(
                  assessment.id,
                  needsDeclaration ? dutyReason.trim() : undefined,
                ),
              )
            }
          >
            {busy === 'review' ? t('nadRecording') : 'Mark reviewed'}
          </button>
        ) : null}
        {assessment.status === 'REVIEWED' ? (
          <button
            type="button"
            disabled={
              busy !== null ||
              (needsDeclaration && combinedDutyTooShort(dutyReason))
            }
            style={{ ...buttonStyle, marginTop: 0, width: 'auto' }}
            onClick={() =>
              void run('approve', () =>
                approveNeedsAssessment(
                  assessment.id,
                  needsDeclaration ? dutyReason.trim() : undefined,
                ),
              )
            }
          >
            {busy === 'approve' ? t('nadApproving') : t('kycQueueApproveButton')}
          </button>
        ) : null}
      </div>

      <label htmlFor="na-review-reason" style={labelStyle}>{t('nadReviewReasonLabel')}</label>
      <input
        id="na-review-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={inputStyle}
        placeholder={t('nadGapNotePlaceholder')}
      />
      <div style={reviewActionsStyle}>
        <button
          type="button"
          disabled={busy !== null || needsReason}
          style={{ ...buttonStyle, marginTop: 0, width: 'auto' }}
          onClick={() =>
            void run('return', () =>
              returnNeedsAssessment(assessment.id, reason.trim()),
            )
          }
        >
          {busy === 'return' ? t('nadReturning') : 'Return for changes'}
        </button>
        <button
          type="button"
          disabled={busy !== null || needsReason}
          style={{ ...buttonStyle, marginTop: 0, width: 'auto' }}
          onClick={() =>
            void run('reject', () =>
              rejectNeedsAssessment(assessment.id, reason.trim()),
            )
          }
        >
          {busy === 'reject' ? t('nadRejecting') : t('kycQueueRejectButton')}
        </button>
      </div>

      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

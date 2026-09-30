'use client';

import { type CSSProperties, useCallback, useState } from 'react';
import {
  addScreeningCaseNote,
  assignScreeningCase,
  caseCanBeDecided,
  caseNoteIsValid,
  escalateScreeningCase,
  escalationReasonIsValid,
  getScreeningCase,
  startScreeningReview,
  type ScreeningCaseNote,
  type ScreeningCaseStatus,
  type ScreeningMatch,
  type ScreeningReviewer,
} from '../../lib/screening/screening-match-api';
import { ApiError } from '../../lib/auth/api-client';
import { useLanguage } from '../../lib/i18n/language-context';
import type { TranslationKey } from '../../lib/i18n/translations';
import { errorStyle } from '../auth/auth-form.styles';

/*
 * THE WORKFLOW AROUND A SANCTIONS MATCH — assign, pick up, escalate, annotate.
 *
 * Five API routes had no web caller at all (IMPROVEMENTS § 1.44, § 1.62), and the
 * consequence was not five missing conveniences. The API refuses a DECISION
 * unless the case is UNDER_REVIEW or ESCALATED, and the only ways to reach either
 * are the routes nothing could call — so every match sat at OPEN and the one
 * control the queue screen did offer returned 422 every time, telling the officer
 * to "assign it and start the review" with nothing able to do either.
 *
 * A component rather than more rows of JSX in the page: the states are a small
 * machine (`CASE_TRANSITIONS` on the API side) and which controls are offered
 * follows from the state, which is a decision that should live in one place.
 *
 * The regulation is why the notes exist at all, not decoration: "the entity must
 * keep the verification mechanism and actions taken regarding the case in
 * internal records" — https://amlu.gov.jo/EN/Pages/Frequently_Asked_Questions.
 * A decision reason records the conclusion; a note records what was actually
 * checked, which is the half that evidences the conclusion.
 */

const CASE_STATUS_KEY: Record<ScreeningCaseStatus, TranslationKey> = {
  OPEN: 'smCaseOpen',
  ASSIGNED: 'smCaseAssigned',
  UNDER_REVIEW: 'smCaseUnderReview',
  ESCALATED: 'smCaseEscalated',
  CLOSED: 'smCaseClosed',
};

const stack: CSSProperties = { display: 'grid', gap: '0.35rem' };
const row: CSSProperties = { display: 'flex', gap: '0.3rem', flexWrap: 'wrap' };
const muted: CSSProperties = { fontSize: '0.8rem', color: 'var(--ink-secondary)' };

export function screeningCaseStatusKey(
  status: ScreeningCaseStatus,
): TranslationKey {
  return CASE_STATUS_KEY[status];
}

export function ScreeningCasePanel({
  match,
  reviewers,
  onChanged,
}: {
  match: ScreeningMatch;
  /** Active holders of `sanctions-pep.screen`. Empty is a real state in a
   * one-officer office, and it is SAID rather than rendered as a dead control. */
  reviewers: ScreeningReviewer[];
  onChanged: () => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const [assignee, setAssignee] = useState('');
  const [escalateTo, setEscalateTo] = useState('');
  const [escalateReason, setEscalateReason] = useState('');
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState<ScreeningCaseNote[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (work: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await work();
        await onChanged();
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : t('smCaseActionFailed'),
        );
      } finally {
        setBusy(false);
      }
    },
    [onChanged, t],
  );

  const loadNotes = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setNotes((await getScreeningCase(match.id)).notes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('smCaseActionFailed'));
    } finally {
      setBusy(false);
    }
  }, [match.id, t]);

  const closed = match.caseStatus === 'CLOSED';
  const nobodyToAssignTo = reviewers.length === 0;

  // Resolved from the reviewer list rather than printed raw: an assignee whose
  // permission has since been revoked is a STRANDED case, which is worth saying
  // in words. Rendering the uuid instead is the defect the audit screen had.
  const assigneeName =
    match.assignedToUserId == null
      ? null
      : (reviewers.find((r) => r.id === match.assignedToUserId)?.fullName ??
        null);

  return (
    <div style={stack} data-testid={`case-panel-${match.id}`}>
      <div>
        <strong data-testid={`case-status-${match.id}`}>
          {t(CASE_STATUS_KEY[match.caseStatus])}
        </strong>
        {match.assignedToUserId != null && (
          <div style={muted} data-testid={`case-assignee-${match.id}`}>
            {t('smCaseAssignee')}:{' '}
            {assigneeName ?? t('smCaseUnknownReviewer')}
          </div>
        )}
        {match.escalationReason != null && (
          <div style={muted}>{match.escalationReason}</div>
        )}
      </div>

      {error && (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      )}

      {!closed && (
        <>
          {nobodyToAssignTo ? (
            <p style={muted}>{t('smCaseNoReviewers')}</p>
          ) : (
            <div style={row}>
              <label style={{ display: 'contents' }}>
                <span style={{ position: 'absolute', left: '-9999px' }}>
                  {t('smCaseReviewerLabel')}
                </span>
                <select
                  aria-label={t('smCaseReviewerLabel')}
                  data-testid={`case-assignee-select-${match.id}`}
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value="">{t('smCaseReviewerLabel')}</option>
                  {reviewers.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                data-testid={`case-assign-${match.id}`}
                disabled={busy || assignee === ''}
                onClick={() =>
                  void run(() => assignScreeningCase(match.id, assignee))
                }
              >
                {match.assignedToUserId == null
                  ? t('smCaseAssign')
                  : t('smCaseReassign')}
              </button>
            </div>
          )}

          {match.caseStatus === 'ASSIGNED' && (
            <button
              type="button"
              data-testid={`case-start-${match.id}`}
              disabled={busy}
              onClick={() => void run(() => startScreeningReview(match.id))}
            >
              {t('smCaseStartReview')}
            </button>
          )}

          {match.caseStatus !== 'OPEN' &&
            match.caseStatus !== 'ESCALATED' &&
            !nobodyToAssignTo && (
              <div style={stack}>
                <div style={row}>
                  <select
                    aria-label={t('smCaseEscalate')}
                    data-testid={`case-escalate-to-${match.id}`}
                    value={escalateTo}
                    onChange={(e) => setEscalateTo(e.target.value)}
                  >
                    <option value="">{t('smCaseEscalate')}</option>
                    {reviewers.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.fullName}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    data-testid={`case-escalate-${match.id}`}
                    disabled={
                      busy ||
                      escalateTo === '' ||
                      !escalationReasonIsValid(escalateReason)
                    }
                    onClick={() =>
                      void run(() =>
                        escalateScreeningCase(
                          match.id,
                          escalateTo,
                          escalateReason,
                        ),
                      )
                    }
                  >
                    {t('smCaseEscalate')}
                  </button>
                </div>
                <textarea
                  aria-label={t('smCaseEscalateReason')}
                  data-testid={`case-escalate-reason-${match.id}`}
                  placeholder={t('smCaseEscalateReason')}
                  rows={2}
                  value={escalateReason}
                  onChange={(e) => setEscalateReason(e.target.value)}
                />
              </div>
            )}

          <div style={stack}>
            <textarea
              aria-label={t('smCaseAddNote')}
              data-testid={`case-note-${match.id}`}
              placeholder={t('smCaseNotePlaceholder')}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div style={row}>
              <button
                type="button"
                data-testid={`case-note-add-${match.id}`}
                disabled={busy || !caseNoteIsValid(note)}
                onClick={() =>
                  void run(async () => {
                    await addScreeningCaseNote(match.id, note);
                    setNote('');
                    if (notes != null) await loadNotes();
                  })
                }
              >
                {t('smCaseAddNote')}
              </button>
              <button
                type="button"
                data-testid={`case-notes-toggle-${match.id}`}
                disabled={busy}
                onClick={() => {
                  if (notes != null) {
                    setNotes(null);
                    return;
                  }
                  void loadNotes();
                }}
              >
                {notes == null
                  ? t('smCaseShowNotes')
                  : t('smCaseHideNotes')}
              </button>
            </div>
          </div>

          {notes != null && (
            <div data-testid={`case-notes-${match.id}`}>
              <div style={muted}>{t('smCaseNotes')}</div>
              {notes.length === 0 ? (
                <p style={muted}>{t('smCaseNoNotes')}</p>
              ) : (
                <ul style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
                  {notes.map((n) => (
                    <li key={n.id} style={{ fontSize: '0.85rem' }}>
                      {n.note}
                      <span style={muted}> · {n.createdAt.slice(0, 10)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Said, not merely implied by a disabled button: the officer needs to
            * know WHY the decision is unavailable, and the sentence is the API's
            * own refusal text. */}
          {!caseCanBeDecided(match.caseStatus) && (
            <p style={muted} data-testid={`case-not-decidable-${match.id}`}>
              {t('smCaseDecideAfterReview')}
            </p>
          )}
        </>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { hasPermission } from '../../../../lib/auth/permissions';
import { permissionRefusalAnyOf } from '../../../../lib/i18n/permission-refusal';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  declareDutySegregationMode,
  getDutySegregationMode,
  MODE_REASON_MIN_LENGTH,
  type DutySegregationMode,
  type DutySegregationModeView,
} from '../../../../lib/admin/duty-segregation-api';
import {
  ErrorState,
  PageHeader,
} from '../../../../components/ui';
import { pageStackStyle } from '../../../../components/lead/lead.styles';
import {
  buttonStyle,
  labelStyle,
  successStyle,
} from '../../../../components/auth/auth-form.styles';
import { formatDateTime } from '../../../../lib/i18n/format';
import { DpoAssignmentSection } from '../../../../components/admin/DpoAssignmentSection';

/**
 * Does this office separate the two halves of an approval?
 *
 * ## Why this screen is not a checkbox
 *
 * The setting weakens a control. So it asks for a REASON, records who declared it and when, and shows that
 * back — because the question a regulator asks is not "is this office combined" but "who decided that, and
 * when". The reason field is the confirmation step: there is no separate "are you sure" to click through
 * without reading.
 *
 * ## Two audiences, two screens from one page
 *
 * `duty-segregation.mode.declare` is the office administrator's. `internal-controls.view` — Compliance,
 * Executive Management, the external auditor — opens the same page READ-ONLY, with a sentence saying why.
 * That is the separation the API enforces: whoever declares the mode is not whoever reviews the acts it
 * permits, and hiding the office's own posture from the reviewers would be the wrong half to close.
 *
 * ## COMBINED is refused for now, and the screen says so rather than hiding it
 *
 * The API refuses COMBINED while the self-approval report does not exist — a commitment, not a bug. The option
 * stays visible with the reason beside it, because an option that silently vanishes teaches nothing, and the
 * administrator reading this is entitled to know what has to exist first.
 */
export default function DutySegregationPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language, t } = useLanguage();

  const [view, setView] = useState<DutySegregationModeView | null>(null);
  const [mode, setMode] = useState<DutySegregationMode>('SEGREGATED');
  const [reason, setReason] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getDutySegregationMode();
      setView(next);
      setMode(next.mode);
      setLoadError(null);
    } catch (err) {
      setView(null);
      setLoadError(
        // THE ONLY SCREEN IN THE APP WITHOUT A 403 BRANCH, found in batch 6. The nav entry is gated on
        // either code, so the eight roles holding neither never see the link — but a reader who types the
        // URL got the API's own English message, which is written for the caller and names no way forward.
        //
        // `anyOf`, because the READ genuinely accepts either code: this is the one place `PermissionsGuard`'s
        // OR semantics are what you want, and telling a Compliance Officer they need the DECLARE permission
        // would send them to ask for the control this screen deliberately withholds from them.
        err instanceof ApiError && err.status === 403
          ? permissionRefusalAnyOf(t, 'dutyModeRefusalAct', [
              'duty-segregation.mode.declare',
              'internal-controls.view',
            ])
          : err instanceof ApiError
            ? err.message
            : t('dutyModeLoadError'),
      );
    }
  }, [t]);

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

  const canDeclare = hasPermission(user, 'duty-segregation.mode.declare');
  const tooShort = reason.trim().length < MODE_REASON_MIN_LENGTH;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    setSaved(false);
    try {
      const next = await declareDutySegregationMode(mode, reason.trim());
      setView(next);
      setReason('');
      setSaved(true);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : t('dutyModeSaveError'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={pageStackStyle}>
      <PageHeader title={t('dutyModeHeading')} />
      <p style={{ color: 'var(--ink-secondary)', maxWidth: '44rem' }}>
        {t('dutyModeIntro')}
      </p>

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {view ? (
        <section style={{ marginTop: '1.5rem' }}>
          <strong>{t('dutyModeCurrentLabel')}</strong>
          <p data-testid="duty-mode-current" style={{ margin: '0.3rem 0' }}>
            {view.mode === 'COMBINED'
              ? t('dutyModeCombined')
              : t('dutyModeSegregated')}
          </p>
          <p style={{ color: 'var(--ink-secondary)', fontSize: '0.9rem', margin: 0 }}>
            {view.declaredAt
              ? t('dutyModeDeclaredBy', {
                  // The same `?? id` fallback as /internal-controls, found beside it.
                  who: view.declaredByName ?? '—',
                  when: formatDateTime(view.declaredAt, language),
                })
              : t('dutyModeNeverDeclared')}
          </p>
        </section>
      ) : null}

      {!canDeclare && view ? (
        <p
          data-testid="duty-mode-read-only"
          style={{ marginTop: '1.5rem', color: 'var(--ink-secondary)', maxWidth: '44rem' }}
        >
          {t('dutyModeReadOnly')}
        </p>
      ) : null}

      {canDeclare ? (
        <form onSubmit={(e) => void submit(e)} style={{ marginTop: '1.5rem', maxWidth: '34rem' }}>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={labelStyle}>{t('dutyModeCurrentLabel')}</legend>
            <label style={{ display: 'block', margin: '0.4rem 0' }}>
              <input
                type="radio"
                name="mode"
                value="SEGREGATED"
                data-testid="duty-mode-segregated"
                checked={mode === 'SEGREGATED'}
                onChange={() => setMode('SEGREGATED')}
              />{' '}
              {t('dutyModeSegregated')}
            </label>
            <label style={{ display: 'block', margin: '0.4rem 0' }}>
              <input
                type="radio"
                name="mode"
                value="COMBINED"
                data-testid="duty-mode-combined"
                checked={mode === 'COMBINED'}
                onChange={() => setMode('COMBINED')}
              />{' '}
              {t('dutyModeCombined')}
            </label>
            {/*
              THE "CANNOT BE DECLARED YET" SENTENCE IS GONE, AND ITS REMOVAL IS THE FIX RATHER THAN A
              TIDY-UP. It said COMBINED could not be declared because the self-approval report did
              not exist. That gate was LIFTED on 2026-09-26 in the commit that shipped
              `GET /internal-controls/combined-duty-acts`, so the sentence had been a FALSE statement
              on this screen ever since — telling an administrator they could not do something the
              API accepts. Found while adding the designation section below it.
            */}
          </fieldset>

          <label htmlFor="duty-mode-reason" style={{ ...labelStyle, marginTop: '1rem' }}>
            {t('dutyModeReasonLabel')}
          </label>
          <textarea
            id="duty-mode-reason"
            data-testid="duty-mode-reason"
            value={reason}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: '100%' }}
          />
          <p style={{ color: 'var(--ink-secondary)', fontSize: '0.8rem', margin: '0.25rem 0' }}>
            {t('dutyModeReasonHint', { min: String(MODE_REASON_MIN_LENGTH) })}
          </p>

          {formError ? (
            <ErrorState title={formError} />
          ) : null}
          {saved ? (
            <p role="status" style={successStyle}>
              {t('dutyModeSaved')}
            </p>
          ) : null}

          <button
            type="submit"
            data-testid="duty-mode-declare"
            disabled={busy || tooShort}
            style={{ ...buttonStyle, width: 'auto' }}
          >
            {busy ? t('dutyModeWorkingButton') : t('dutyModeDeclareButton')}
          </button>
        </form>
      ) : null}

      {/*
        MODULE 0-ب — the DPO designation, on THIS screen rather than a new one.
        
        The page's subject is already *may one person perform both halves of a thing, and what must be
        recorded when they do*. Who holds the DPO assignment beside who manages the office is that
        question one level up: not two halves of one approval, but two assignments in one office. A
        separate screen would be a second place somebody reads the office's posture from.
        
        It takes `canDeclare` rather than reading the permission again, so the two controls on this
        page cannot disagree about who may write.
      */}
      <DpoAssignmentSection canDeclare={canDeclare} />
    </main>
  );
}

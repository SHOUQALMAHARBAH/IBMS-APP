'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { hasPermission } from '../../../../lib/auth/permissions';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  declareDutySegregationMode,
  getDutySegregationMode,
  MODE_REASON_MIN_LENGTH,
  type DutySegregationMode,
  type DutySegregationModeView,
} from '../../../../lib/admin/duty-segregation-api';
import { pageStyle } from '../../../../components/lead/lead.styles';
import {
  buttonStyle,
  errorStyle,
  labelStyle,
  successStyle,
} from '../../../../components/auth/auth-form.styles';
import { formatDateTime } from '../../../../lib/i18n/format';

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
        err instanceof ApiError ? err.message : t('dutyModeLoadError'),
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
    <main style={pageStyle}>
      <h1>{t('dutyModeHeading')}</h1>
      <p style={{ color: 'var(--ink-secondary)', maxWidth: '44rem' }}>
        {t('dutyModeIntro')}
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
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
                  who: view.declaredByName ?? view.declaredByUserId ?? '—',
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
            {/* Stated, not hidden: the option exists and cannot be used yet, and the sentence says why. */}
            <p
              data-testid="duty-mode-combined-blocked"
              style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem', margin: '0.2rem 0 0 1.4rem' }}
            >
              {t('dutyModeCombinedBlocked')}
            </p>
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
            <p role="alert" style={errorStyle}>
              {formError}
            </p>
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
    </main>
  );
}

'use client';

import { useState, type FormEvent } from 'react';
import { useLanguage } from '../../lib/i18n/language-context';
import { startRecertificationCycle } from '../../lib/access-recertification/access-recertification-api';
import { useAuth } from '../../lib/auth/auth-context';
import { CombinedDutyReasonField } from '../ui/CombinedDutyReasonField';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle, inputStyle, labelStyle, successStyle } from '../auth/auth-form.styles';
import { fieldStyle, formRowStyle, sectionStyle } from './access-recertification.styles';

interface StartCyclePanelProps {
  onCycleStarted: () => void;
}

export function StartCyclePanel({ onCycleStarted }: StartCyclePanelProps) {
  const { t } = useLanguage();
  const [cycleLabel, setCycleLabel] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useAuth();
  const [dutyReason, setDutyReason] = useState('');
  /**
   * OPTIONAL here, and that is the one place this screen differs from the other twelve approve controls.
   *
   * Everywhere else the condition can be evaluated exactly: the maker is a column on the record in front
   * of you. A cycle covers EVERY active person, and whether any of them has nobody else to review their
   * access depends on the whole reviewer pool — which this screen does not have and should not fetch to
   * answer a hypothetical. So in an office that has declared COMBINED the field is offered with wording
   * that says when it is used, and an office that has not declared it never sees it.
   *
   * Leaving it out is what the API refuses, and the refusal is the same sentence as everywhere else.
   */
  const mayNeedDeclaration = user?.dutySegregationMode === 'COMBINED';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);
    try {
      const cycle = await startRecertificationCycle({
        cycleLabel,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        ...(dutyReason.trim() ? { combinedDutyReason: dutyReason.trim() } : {}),
      });
      setMessage(`Cycle "${cycle.cycleLabel}" started — your review queue below now reflects it.`);
      setCycleLabel('');
      setDueAt('');
      setDutyReason('');
      onCycleStarted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('acrStartCycleError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section style={sectionStyle}>
      <h2 style={{ marginTop: 0 }}>{t('acrStartCycleHeading')}</h2>
      <p style={{ opacity: 0.8, fontSize: '0.9rem' }}>
        {t('acrQuarterlyNote')}
      </p>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div style={formRowStyle}>
          <div style={fieldStyle}>
            <label htmlFor="cycle-label" style={labelStyle}>{t('acrCycleLabel')}</label>
            <input
              id="cycle-label"
              required
              value={cycleLabel}
              onChange={(e) => setCycleLabel(e.target.value)}
              style={inputStyle}
              placeholder={t('acrCycleNamePlaceholder')}
            />
          </div>
          <div style={fieldStyle}>
            <label htmlFor="cycle-due-at" style={labelStyle}>{t('acrCycleDueDate')}</label>
            <input
              id="cycle-due-at"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              style={inputStyle}
            />
          </div>
          {mayNeedDeclaration ? (
            <CombinedDutyReasonField
              id="recertification-cycle"
              value={dutyReason}
              onChange={setDutyReason}
            />
          ) : null}
          <button type="submit" disabled={isSubmitting} style={{ ...buttonStyle, marginTop: 0, width: 'auto' }}>
            {isSubmitting ? t('secStartingButton') : 'Start cycle'}
          </button>
        </div>
        {message ? <p style={successStyle}>{message}</p> : null}
        {error ? (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}

'use client';

import { useState, type FormEvent } from 'react';
import { useLanguage } from '../../lib/i18n/language-context';
import { startRecertificationCycle } from '../../lib/access-recertification/access-recertification-api';
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);
    try {
      const cycle = await startRecertificationCycle({
        cycleLabel,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      });
      setMessage(`Cycle "${cycle.cycleLabel}" started — your review queue below now reflects it.`);
      setCycleLabel('');
      setDueAt('');
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

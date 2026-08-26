'use client';

import { useState, type FormEvent } from 'react';
import { startRecertificationCycle } from '../../lib/access-recertification/access-recertification-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle, inputStyle, labelStyle, successStyle } from '../auth/auth-form.styles';
import { fieldStyle, formRowStyle, sectionStyle } from './access-recertification.styles';

interface StartCyclePanelProps {
  onCycleStarted: () => void;
}

export function StartCyclePanel({ onCycleStarted }: StartCyclePanelProps) {
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
      setError(err instanceof ApiError ? err.message : 'Could not start the cycle — try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section style={sectionStyle}>
      <h2 style={{ marginTop: 0 }}>Start a new recertification cycle</h2>
      <p style={{ opacity: 0.8, fontSize: '0.9rem' }}>
        A cycle also runs automatically every quarter. Use this to start one on demand — every user
        currently holding an active role gets an item, assigned to an eligible reviewer.
      </p>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div style={formRowStyle}>
          <div style={fieldStyle}>
            <label htmlFor="cycle-label" style={labelStyle}>
              Cycle label
            </label>
            <input
              id="cycle-label"
              required
              value={cycleLabel}
              onChange={(e) => setCycleLabel(e.target.value)}
              style={inputStyle}
              placeholder="e.g. Q1-2026 ad hoc"
            />
          </div>
          <div style={fieldStyle}>
            <label htmlFor="cycle-due-at" style={labelStyle}>
              Due date (optional — defaults to 15 days)
            </label>
            <input
              id="cycle-due-at"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              style={inputStyle}
            />
          </div>
          <button type="submit" disabled={isSubmitting} style={{ ...buttonStyle, marginTop: 0, width: 'auto' }}>
            {isSubmitting ? 'Starting…' : 'Start cycle'}
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

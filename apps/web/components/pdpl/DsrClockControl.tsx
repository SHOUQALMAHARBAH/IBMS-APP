'use client';

import { type CSSProperties, useCallback, useState } from 'react';
import {
  dsrPauseReasonIsValid,
  getDsr,
  pauseDsrSla,
  resumeDsrSla,
  type DataSubjectRequest,
} from '../../lib/pdpl/dsr-api';
import { ApiError } from '../../lib/auth/api-client';
import { useAuth } from '../../lib/auth/auth-context';
import { useLanguage } from '../../lib/i18n/language-context';
import { hasPermission } from '../../lib/auth/permissions';
import { errorStyle } from '../auth/auth-form.styles';

/*
 * STOPPING ONE REQUEST'S STATUTORY CLOCK, FROM THE REQUEST.
 *
 * The owner's decision on IMPROVEMENTS § 1.61. `sla.timer.pause` is held by the Manager,
 * Compliance and the Data Protection Officer — and the DPO does NOT hold
 * `sla-dashboard.view`, so for the one role whose own statutory clocks are the likeliest
 * thing anybody would legitimately pause, the capability was unreachable. The control
 * moved here rather than the dashboard being opened up: the pause happens for ONE request,
 * for ONE stated cause, so it belongs where that request is, and granting the dashboard
 * would widen what the role sees for the whole office to save a line of code.
 *
 * ## THE CLOCK IS FETCHED WHEN THE CONTROL OPENS, NOT WITH THE LIST
 *
 * A request carries several timers, so its clock state is a per-request read the API
 * exposes on the single-request route only — putting it on the list would be one timer
 * query per row for a figure the list does not show. So this component fetches on open:
 * one request, for one action, at the moment somebody asks.
 *
 * ## AND IT SHOWS WHAT WAS ACTUALLY STOPPED
 *
 * Measured: one request carries FOUR timers (two escalation stages, and a second pair once
 * an extension re-bases the deadline). The server pauses all of them, and the counts are
 * rendered rather than a word — because "paused" over a request whose clock is two-of-four
 * stopped is the reassuring lie this whole area keeps producing.
 */

const muted: CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--ink-secondary)',
  margin: 0,
};

export function DsrClockControl({
  requestId,
  closed,
}: {
  requestId: string;
  /** A closed request's clock has already stopped; the server refuses a pause on one, and
   * offering the control would be offering an action that cannot succeed. */
  closed: boolean;
}) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const canPause = hasPermission(user, 'sla.timer.pause');

  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState<DataSubjectRequest['slaClock'] | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadClock = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setClock((await getDsr(requestId)).slaClock ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dsrClockLoadError'));
    } finally {
      setBusy(false);
    }
  }, [requestId, t]);

  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await work();
        setReason('');
        await loadClock();
      } catch (err) {
        // The server's own sentence when it has one — "no running clock to pause" and
        // "this request is closed" are different problems.
        setError(err instanceof ApiError ? err.message : t('dsrClockActionError'));
      } finally {
        setBusy(false);
      }
    },
    [loadClock, t],
  );

  if (!canPause || closed) return null;

  if (!open) {
    return (
      <button
        type="button"
        data-testid={`dsr-clock-open-${requestId}`}
        onClick={() => {
          setOpen(true);
          void loadClock();
        }}
      >
        {t('dsrClockHeading')}
      </button>
    );
  }

  const isPaused = (clock?.paused ?? 0) > 0;

  return (
    <div
      style={{ display: 'grid', gap: '0.35rem', minWidth: '20rem' }}
      data-testid={`dsr-clock-${requestId}`}
    >
      <strong style={{ fontSize: '0.85rem' }}>{t('dsrClockHeading')}</strong>

      {error && (
        <p role="alert" style={errorStyle} data-testid={`dsr-clock-error-${requestId}`}>
          {error}
        </p>
      )}

      {clock != null && (
        <p style={muted} data-testid={`dsr-clock-state-${requestId}`}>
          {/* The COUNTS, not a word. A request whose clock is two-of-four stopped is not
            * "paused", and saying so would be the reassuring lie. */}
          {t('dsrClockCounts', {
            paused: String(clock.paused),
            open: String(clock.open),
          })}
          {clock.pauseReason ? ` — ${clock.pauseReason}` : ''}
        </p>
      )}

      {isPaused ? (
        <button
          type="button"
          data-testid={`dsr-clock-resume-${requestId}`}
          disabled={busy}
          onClick={() => void act(() => resumeDsrSla(requestId))}
        >
          {t('dsrClockResume')}
        </button>
      ) : (
        <>
          <label
            htmlFor={`dsr-clock-reason-${requestId}`}
            style={{ fontSize: '0.8rem' }}
          >
            {t('dsrClockReason')}
          </label>
          <textarea
            id={`dsr-clock-reason-${requestId}`}
            data-testid={`dsr-clock-reason-${requestId}`}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p style={muted}>{t('dsrClockReasonHint')}</p>
          <button
            type="button"
            data-testid={`dsr-clock-pause-${requestId}`}
            disabled={busy || !dsrPauseReasonIsValid(reason)}
            onClick={() => void act(() => pauseDsrSla(requestId, reason))}
          >
            {t('dsrClockPause')}
          </button>
        </>
      )}

      <button
        type="button"
        data-testid={`dsr-clock-close-${requestId}`}
        onClick={() => {
          setOpen(false);
          setReason('');
          setError(null);
        }}
      >
        {t('dsrClockDone')}
      </button>
    </div>
  );
}

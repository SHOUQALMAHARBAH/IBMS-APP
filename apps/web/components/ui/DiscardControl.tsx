'use client';

import { useState } from 'react';
import { ApiError } from '../../lib/auth/api-client';
import {
  DISCARD_REASON_MIN_LENGTH,
  discardRecord,
  type DiscardBlock,
  type DiscardableCollection,
} from '../../lib/discard/discard-api';
import { useLanguage } from '../../lib/i18n/language-context';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { rfqBadgeStyle } from '../rfq/rfq.styles';
import { formatDateTime } from '../../lib/i18n/format';

/**
 * WITHDRAW A RECORD RAISED IN ERROR — one control for all four entities.
 *
 * ## Why one component
 *
 * A discard is terminal, and the reason typed here stays on the record permanently. Four copies of that
 * would be four chances for one of them to drop the confirmation step, or to accept an empty reason and let
 * the user discover the floor from a 422. The wording is the safety-relevant part: the button has to say the
 * record STAYS, because "discard" reads as "delete" to everyone who has used any other software.
 *
 * ## Why a reason field and not a confirm dialog
 *
 * The reason is the only part of a discard that cannot be reconstructed later — who and when are in the
 * audit row. So the field IS the confirmation: you cannot withdraw a record without saying why, and there is
 * no separate "are you sure" step to click through without reading.
 */
export function DiscardControl({
  collection,
  id,
  /** False hides the control entirely — this caller does not hold the entity's `.discard` code. */
  canDiscard,
  /** False when the record has passed its point of no return (issued, registered, sent, applied). */
  discardable,
  /** Re-read after a successful discard. The row has to come back showing its own discard. */
  onDiscarded,
}: {
  collection: DiscardableCollection;
  id: string;
  canDiscard: boolean;
  discardable: boolean;
  onDiscarded: () => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canDiscard || !discardable) return null;

  const tooShort = reason.trim().length < DISCARD_REASON_MIN_LENGTH;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await discardRecord(collection, id, reason.trim());
      setOpen(false);
      setReason('');
      await onDiscarded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('discardActionError'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid={`discard-open-${id}`}
        style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
        onClick={() => setOpen(true)}
      >
        {t('discardButton')}
      </button>
    );
  }

  return (
    <div style={{ marginTop: '0.75rem', maxWidth: '32rem' }}>
      <strong>{t('discardHeading')}</strong>
      <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem', margin: '0.25rem 0 0.5rem' }}>
        {t('discardExplanation')}
      </p>
      <label htmlFor={`discard-reason-${id}`}>{t('discardReasonLabel')}</label>
      <textarea
        id={`discard-reason-${id}`}
        data-testid={`discard-reason-${id}`}
        value={reason}
        rows={3}
        onChange={(ev) => setReason(ev.target.value)}
        style={{ width: '100%', marginTop: '0.25rem' }}
      />
      <p style={{ color: 'var(--ink-secondary)', fontSize: '0.8rem', margin: '0.25rem 0' }}>
        {t('discardReasonHint', { min: String(DISCARD_REASON_MIN_LENGTH) })}
      </p>
      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid={`discard-confirm-${id}`}
          disabled={busy || tooShort}
          style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
          onClick={() => void submit()}
        >
          {busy ? t('discardWorkingButton') : t('discardConfirmButton')}
        </button>
        <button
          type="button"
          data-testid={`discard-cancel-${id}`}
          disabled={busy}
          style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          {t('discardCancelButton')}
        </button>
      </div>
    </div>
  );
}

/**
 * What a discarded record says about itself, wherever one is listed.
 *
 * The record stays visible — hiding it would read as deletion, the same argument that keeps deactivated
 * insurers in the insurer list — so every surface that can show one has to say it was withdrawn and show the
 * reason. A row that merely stopped offering actions would look broken.
 */
export function DiscardedNotice({ discard }: { discard: DiscardBlock | null }) {
  const { language, t } = useLanguage();
  if (!discard) return null;
  return (
    <div data-testid="discarded-notice" style={{ marginTop: '0.4rem' }}>
      <span style={rfqBadgeStyle}>{t('discardedBadge')}</span>
      <p style={{ margin: '0.3rem 0 0', fontSize: '0.85rem' }}>
        {t('discardedOn', { when: formatDateTime(discard.at, language) })}
      </p>
      <p style={{ margin: '0.15rem 0 0', fontSize: '0.85rem' }}>
        {t('discardedReasonLabel')} {discard.reason}
      </p>
    </div>
  );
}

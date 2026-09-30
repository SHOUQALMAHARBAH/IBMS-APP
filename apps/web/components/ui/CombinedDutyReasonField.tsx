'use client';

import { useLanguage } from '../../lib/i18n/language-context';

/** Mirrors `COMBINED_DUTY_REASON_MIN_LENGTH`. The server is the authority; this only gates the button. */
export const COMBINED_DUTY_MIN_LENGTH = 10;

/**
 * Does this screen have to ask for a combined-duty reason?
 *
 * The condition is narrow on purpose. Asking on every approval would put a mandatory box in front of the
 * hundreds of ordinary two-person approvals this product is mostly made of; asking on none of them is a 422
 * with nowhere to type, which is the wall the mode screen must not open onto.
 *
 * So: only when the office has DECLARED COMBINED, and only when the person about to approve is the same
 * person who made the thing being approved, and only while it is still undecided.
 */
export function needsCombinedDutyDeclaration(input: {
  mode: 'SEGREGATED' | 'COMBINED' | undefined;
  /** Who performed the first half. Null/undefined when that is not known or not recorded. */
  makerUserId: string | null | undefined;
  currentUserId: string;
  /** True once the second half has been recorded — there is nothing left to declare. */
  alreadyDecided: boolean;
}): boolean {
  if (input.mode !== 'COMBINED') return false;
  if (input.alreadyDecided) return false;
  if (!input.makerUserId) return false;
  return input.makerUserId === input.currentUserId;
}

export function combinedDutyTooShort(reason: string): boolean {
  return reason.trim().length < COMBINED_DUTY_MIN_LENGTH;
}

/**
 * The reason a person gives for performing both halves of an approval themselves.
 *
 * ONE component for all fifteen pairs. The alternative — a textarea per approve control — is fifteen places
 * for the wording to drift, and the wording is the part that matters: it has to say that the person raised
 * this AND that the office allows them to approve it, because otherwise the field reads as an accusation.
 */
export function CombinedDutyReasonField({
  id,
  value,
  onChange,
}: {
  /** Unique per record, so two rows on one screen cannot share a box. */
  id: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div style={{ margin: '0.5rem 0', maxWidth: '32rem' }}>
      <label htmlFor={`cd-reason-${id}`}>{t('combinedDutyReasonLabel')}</label>
      <textarea
        id={`cd-reason-${id}`}
        data-testid={`combined-duty-reason-${id}`}
        value={value}
        rows={2}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', marginTop: '0.25rem' }}
      />
      <p
        style={{
          color: 'var(--ink-secondary)',
          fontSize: '0.8rem',
          margin: '0.2rem 0',
        }}
      >
        {t('combinedDutyReasonHint')}
      </p>
    </div>
  );
}

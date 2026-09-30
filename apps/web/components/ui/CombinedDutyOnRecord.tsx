/*
 * "One person did both halves of this, and here is why" — shown ON THE RECORD.
 *
 * Part 4 step 5. When an office declares COMBINED duty segregation, one person may perform both
 * halves of an approval by stating a reason, and the act is recorded against the record's own escape
 * column. This renders it where the record is read, so somebody looking at an approval sees that
 * nobody else signed it **without going to find the report** at `/internal-controls`.
 *
 * ## Why this is a component and not four lines copied per record
 *
 * There are FIFTEEN maker/checker pairs. The write side already learned this: twelve approve screens
 * share one `CombinedDutyReasonField` because twelve textareas would be twelve places for the
 * WORDING to drift, and the wording is the load-bearing part. The same is true of reading it — a
 * reader who learns what this sentence means on one record must find it saying the same thing on the
 * next, and fifteen inline copies is fifteen chances for one to say less.
 *
 * ## Renders NOTHING when there is no act, and that is the common case
 *
 * Every ordinary two-person approval passes `null` here, which is nearly all of them. An empty
 * element, a dash or a "no declaration" line would put a sentence about self-approval onto hundreds
 * of records where nobody self-approved.
 *
 * ## The HAT is shown, and its ambiguity is shown as ambiguity
 *
 * `roles` is the subset of the actor's roles that actually granted the checker permission. When more
 * than one did, `hatAmbiguous` is true and the record says so rather than naming one — the act was
 * written that way deliberately, and a reader must not be told a single role authorised something
 * when the system cannot tell which.
 */

import { useLanguage } from '../../lib/i18n/language-context';

/** Mirrors the api's `CombinedDutyActView`. One shape, so fifteen pairs cannot invent their own. */
export interface CombinedDutyActOnRecord {
  id: string;
  at: string;
  actorUserId: string;
  reason: string;
  /** The database constraint the act excuses — how the act and the rule stay tied together. */
  pair: string;
  roles: string[];
  hatAmbiguous: boolean;
}

export function CombinedDutyOnRecord({
  act,
  testId,
}: {
  act: CombinedDutyActOnRecord | null | undefined;
  /** So a test can assert on the specific record's declaration, not on "one appeared somewhere". */
  testId: string;
}) {
  const { t } = useLanguage();
  if (!act) return null;

  return (
    <p
      data-testid={testId}
      data-combined-duty-pair={act.pair}
      style={{ margin: '0.4rem 0', fontSize: '0.85rem' }}
    >
      {t(
        act.hatAmbiguous
          ? 'combinedDutyOnRecordAmbiguous'
          : 'combinedDutyOnRecord',
        { roles: act.roles.join(', ') || '—' },
      )}{' '}
      {act.reason}
    </p>
  );
}

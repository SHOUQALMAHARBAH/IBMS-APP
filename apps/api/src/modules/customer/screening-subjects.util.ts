import type { ScreeningSubject } from '../screening-providers/screening-provider.types';

/**
 * Part B §11 — the screening subjects, WITH their identity discriminators.
 *
 * `ScreeningSubject` has declared `dateOfBirth` and `nationality` since the
 * provider contract was written, and `ScreeningMatch.matchedAttributes` names
 * them as evidence a reviewer weighs. Until the columns existed neither had a
 * producer, so every match this system raised agreed on NAME ALONE — against
 * ~19,000 sanctions entries, the single largest source of false positives.
 *
 * Null where unknown, never guessed: an absent date of birth is "we do not
 * know", which a reviewer must weigh differently from "it does not match".
 *
 * A CORPORATE customer has no date of birth or nationality of its own — those
 * belong to the natural persons behind it, which is what the UBO subjects are
 * for. Passing the company's own null there is correct, not a gap.
 *
 * ## Why this lives in its own file
 *
 * Two callers must agree EXACTLY: `ScreeningService.run()` builds the subjects
 * it screens, and `ScreeningHoldService` rebuilds them to fingerprint what is
 * on the file right now (§12). If those two ever drifted apart — one including
 * a field the other did not — every file would look permanently changed, or
 * worse, a real change would look like none. One function, two callers.
 */
export function buildScreeningSubjects(
  customer: {
    id: string;
    legalName: string;
    customerType: string;
    dateOfBirth?: Date | null;
    nationality?: string | null;
  },
  ubos: readonly {
    id: string;
    fullName: string;
    dateOfBirth?: Date | null;
    nationality?: string | null;
  }[],
): ScreeningSubject[] {
  return [
    {
      subjectRef: `customer:${customer.id}`,
      fullName: customer.legalName,
      entityType:
        customer.customerType === 'INDIVIDUAL' ? 'individual' : 'organization',
      dateOfBirth: isoDateOnly(customer.dateOfBirth),
      nationality: customer.nationality ?? null,
    },
    ...ubos.map((ubo) => ({
      subjectRef: `ubo:${ubo.id}`,
      fullName: ubo.fullName,
      // A UBO is always a natural person.
      entityType: 'individual' as const,
      dateOfBirth: isoDateOnly(ubo.dateOfBirth),
      nationality: ubo.nationality ?? null,
    })),
  ];
}

/** `YYYY-MM-DD`, the form every provider expects and the form a fingerprint
 * can be taken over. The column is a Postgres DATE, so the time component is
 * always midnight UTC and slicing is exact rather than timezone-dependent. */
function isoDateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

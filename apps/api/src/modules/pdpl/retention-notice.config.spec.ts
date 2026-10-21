import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ELAPSED_IDS_CAP,
  deriveRetentionNotice,
  elapsedBefore,
} from './retention-notice.config';
import {
  CATEGORY_RESOLUTIONS,
  UNRESOLVABLE_REASONS,
  resolutionFor,
  unresolvableReason,
} from './retention-resolution.config';
import {
  EXTENSION_BASES,
  EXTENSION_NOTE_MIN_LENGTH,
  assertExtensionBasis,
  basisDefinition,
} from './retention-extension.config';
import { DECLARATION_REASON_MIN_LENGTH } from '../../common/declaration-reason';

/**
 * BATCH 5 GROUP 7b — the clock, the notice, the resolution table and the closed basis list.
 *
 * The cases that matter most here are the ABSENCES: a category this system cannot resolve must get a
 * row that SAYS SO rather than silence, and the notice must have no write path to a disposal. Both
 * are asserted, because both are the kind of thing that passes review by looking fine.
 */

describe('the resolution table — only what this system can actually resolve', () => {
  it('holds EXACTLY the four resolvable categories, so a fifth is a decision', () => {
    expect(CATEGORY_RESOLUTIONS.map((r) => r.recordCategory)).toEqual([
      'Receipt',
      'Remittance',
      'CommissionLedgerEntry',
      'Settlement',
    ]);

    /*
     * AND WHICH TRIGGERS ARE NULLABLE, pinned — batch 5 group 7c.
     *
     * This is not bookkeeping: `notBlockedWhere` NEGATES an elapsed test, and `NOT (trigger <= x)`
     * is NULL for a NULL trigger, so a WHERE clause keeps only TRUE and the row is DROPPED. An
     * UNPAID commission entry therefore left the financial report — what the office is owed,
     * quietly smaller. The flag is what adds `trigger IS NOT NULL` to the conjunction and makes it
     * FALSE rather than NULL.
     *
     * `Receipt.receivedAt` alone is NOT NULL, which is also why the flag could not be inferred at
     * the call site: Prisma's filter for a non-nullable column refuses `not: null` outright.
     *
     * A fifth category declaring this wrongly is a money defect in a read, so it is pinned per
     * category rather than counted.
     */
    expect(
      CATEGORY_RESOLUTIONS.map((r) => [r.triggerColumn, r.triggerIsNullable]),
    ).toEqual([
      ['receivedAt', false],
      ['remittedAt', true],
      ['paidAt', true],
      ['clientPaymentConfirmedAt', true],
    ]);
  });

  it('every resolution names a trigger column AND what that date MEANS', () => {
    for (const r of CATEGORY_RESOLUTIONS) {
      expect(r.triggerColumn.length, r.recordCategory).toBeGreaterThan(3);
      // The notice shows this, not the column name — "what date did the count run from" is the
      // question an officer is asking, and `receivedAt` does not answer it.
      expect(r.triggerDescription.length, r.recordCategory).toBeGreaterThan(25);
      expect(r.triggerDescription, r.recordCategory).toContain('clos');
    }
  });

  it('THE FIVE-YEAR AML FLOOR HAS NO RESOLVABLE CATEGORY, and says why', () => {
    /*
     * The measurement that shapes this whole item: art. 17/أ counts from completing the transaction
     * OR ending the relationship, whichever is longer — and `Customer` carries only dateOfBirth,
     * createdAt and updatedAt. `CustomerStatus.CLOSED` is a state nothing stamps a date for. So the
     * headline category of the retention story can never produce a notice, and the reason is
     * recorded rather than left for somebody to rediscover.
     */
    expect(resolutionFor('KYCRecord')).toBeNull();
    expect(resolutionFor('Customer')).toBeNull();
    for (const category of ['KYCRecord', 'Customer']) {
      const reason = unresolvableReason(category);
      expect(reason, category).toContain('relationship');
      expect(reason, category).toContain('cannot be computed');
    }
  });

  it('names the three category names that name NO MODEL', () => {
    for (const category of ['Payment', 'Collection', 'BankReconciliation']) {
      expect(resolutionFor(category), category).toBeNull();
      expect(unresolvableReason(category), category).toContain(
        'No ' + category + ' model exists',
      );
    }
  });

  it('EXCLUDES Invoice deliberately, and the reason is not "we forgot"', () => {
    // An invoice carries only a dueDate and a createdAt. A due date is not a closing — an unpaid
    // invoice's transaction has not closed — so counting from it would start the clock early.
    expect(resolutionFor('Invoice')).toBeNull();
    expect(unresolvableReason('Invoice')).toContain('not a closing');
    // And its closing IS resolved, one model over.
    expect(resolutionFor('Receipt')).not.toBeNull();
  });

  it('gives an UNANTICIPATED category name a reason too — silence is the defect', () => {
    /*
     * Decision 28's family. An office may name any category it likes, and "we have not been told
     * what records this means" is the honest answer for a name nobody anticipated. What must never
     * happen is a row with no explanation, because an office that set a period and is never alerted
     * will believe the system is watching it.
     */
    const reason = unresolvableReason('Correspondence-With-The-Lawyer');
    expect(reason).not.toBeNull();
    expect(reason).toContain('has not been told');
    expect(reason).toContain('nothing here is watching the clock');
    // Every declared reason is of real length — an empty string would satisfy a null check.
    for (const [name, text] of Object.entries(UNRESOLVABLE_REASONS)) {
      expect(text.length, name).toBeGreaterThan(60);
    }
  });
});

describe('the notice explains itself', () => {
  const RESOLVED = {
    recordCategory: 'Receipt',
    retentionPeriodMonths: 120,
    elapsedCount: 142,
    // The ids, so an extension can NAME what it covers — a register row naming no record is a false
    // entry in the one place that exists to be justifiable.
    elapsedRecordIds: Array.from({ length: 142 }, (_, i) => `r-${i}`),
    heldCount: 0,
    extendedCount: 0,
  };

  it('carries the ARTICLE, the START DATE in words, and the no-hold statement', () => {
    const notice = deriveRetentionNotice(RESOLVED);
    expect(notice.resolvable).toBe(true);
    expect(notice.elapsedCount).toBe(142);
    // The article, and the SAME one the refusal cites — read through the floors config rather than
    // re-derived, so a screen cannot name a different statute from the one that refused a shorter
    // period an hour earlier.
    expect(notice.floor?.instrument).toContain('Commercial Law No. 12 of 1966');
    expect(notice.floor?.article).toContain('art. 19');
    expect(notice.floor?.operativeText).toContain('ten years');
    // What the count ran from, in words.
    expect(notice.countedFrom).toContain('client payment was received');
    /*
     * THE IDS ARE CAPPED AND THE COUNT IS NOT. A reader must never be shown a smaller number than
     * what is really elapsed, so the cap bounds the request the screen can send and leaves the
     * count alone — 142 is under the cap here, and the cap itself is asserted below.
     */
    expect(notice.elapsedRecordIds).toHaveLength(142);
    expect(
      deriveRetentionNotice({
        ...RESOLVED,
        elapsedCount: 900,
        elapsedRecordIds: Array.from({ length: 900 }, (_, i) => `r-${i}`),
      }),
    ).toMatchObject({ elapsedCount: 900 });
    expect(
      deriveRetentionNotice({
        ...RESOLVED,
        elapsedCount: 900,
        elapsedRecordIds: Array.from({ length: 900 }, (_, i) => `r-${i}`),
      }).elapsedRecordIds,
    ).toHaveLength(ELAPSED_IDS_CAP);
    // Stated rather than implied: the reader relies on it when choosing destruction.
    expect(notice.noLegalHoldStatement).toBe(
      'No legal hold stands on any of these records.',
    );
  });

  it('REPORTS held records rather than quietly subtracting them', () => {
    /*
     * A hold is at CATEGORY grain — measured: `LegalHold` has no per-record reference — so when one
     * stands, everything elapsed is held and nothing is offered. The count is reported either way:
     * records vanishing with no explanation is how an officer concludes the system lost them.
     */
    const notice = deriveRetentionNotice({
      ...RESOLVED,
      elapsedCount: 0,
      heldCount: 142,
    });
    expect(notice.elapsedCount).toBe(0);
    expect(notice.heldCount).toBe(142);
    expect(notice.noLegalHoldStatement).toContain('142 record(s)');
    expect(notice.noLegalHoldStatement).toContain('active legal hold');
    expect(notice.noLegalHoldStatement).toContain('refuses destruction');
  });

  it('an UNRESOLVABLE category still gets a row, with its reason and a zero count', () => {
    const notice = deriveRetentionNotice({
      recordCategory: 'KYCRecord',
      retentionPeriodMonths: 60,
      elapsedRecordIds: ['r-1', 'r-2'],
      // Even if a caller passed counts, an unresolvable category reports none — there is nothing to
      // count, and a number here would be a claim the system cannot support.
      elapsedCount: 99,
      heldCount: 99,
      extendedCount: 99,
    });
    expect(notice.resolvable).toBe(false);
    expect(notice.elapsedCount).toBe(0);
    expect(notice.heldCount).toBe(0);
    // An unresolvable category names no records either — there is nothing to extend.
    expect(notice.elapsedRecordIds).toEqual([]);
    expect(notice.unresolvableReason).toContain('relationship');
    expect(notice.countedFrom).toBeNull();
    expect(notice.noLegalHoldStatement).toContain(
      'no legal hold has been checked',
    );
    // The floor still applies to it — the period was refused against art. 17/أ when it was set.
    expect(notice.floor?.article).toContain('art. 17/a');
  });

  it('counts months with MONTH arithmetic, not 30-day blocks', () => {
    /*
     * The direction matters: a 30-day month would make records eligible for destruction BEFORE
     * their period had run. Asserted across a leap-year February, which is where month arithmetic
     * and day arithmetic diverge — the same case `renewalApplicationDueBy` is pinned on.
     */
    expect(
      elapsedBefore(new Date('2029-03-01T00:00:00Z'), 12).toISOString(),
    ).toBe('2028-03-01T00:00:00.000Z');
    expect(
      elapsedBefore(new Date('2036-01-31T00:00:00Z'), 120).toISOString(),
    ).toBe('2026-01-31T00:00:00.000Z');
  });
});

describe('the extension basis is a CLOSED list of three', () => {
  const GOOD_NOTE = 'Retained for the pending CBJ examination file.';

  it('holds exactly three, and consent is NOT selectable — with the measured reason', () => {
    expect([...EXTENSION_BASES]).toEqual([
      'LEGISLATIVE_PROVISION',
      'LEGAL_HOLD_OR_DISPUTE',
      'CUSTOMER_EXPLICIT_CONSENT',
    ]);
    expect(basisDefinition('LEGISLATIVE_PROVISION').selectable).toBe(true);
    expect(basisDefinition('LEGAL_HOLD_OR_DISPUTE').selectable).toBe(true);
    const consent = basisDefinition('CUSTOMER_EXPLICIT_CONSENT');
    expect(consent.selectable).toBe(false);
    /*
     * THE PRECISE REASON, and it is not the one the brief anticipated: `ConsentRecord` EXISTS and
     * carries a purpose, a grant date and a withdrawal date — and NO duration. So the basis cannot
     * be checked against what the customer actually agreed to. Saying "no consent exists" would be
     * false, and the distinction is asserted so a reword cannot flatten it.
     */
    expect(consent.unselectableReason).toContain('NO duration');
    expect(consent.unselectableReason).toContain('not that no consent exists');
  });

  it('REFUSES the consent basis outright while it cannot be substantiated', () => {
    let body: Record<string, unknown> = {};
    try {
      assertExtensionBasis({
        basis: 'CUSTOMER_EXPLICIT_CONSENT',
        note: GOOD_NOTE,
        consentRecordId: 'c-1',
        consentDuration: '2 years',
        consentPurpose: 'claims history',
      });
      throw new Error('expected a refusal');
    } catch (err) {
      body = (
        err as { getResponse: () => Record<string, unknown> }
      ).getResponse();
    }
    // Refused even when every field is supplied: an option that cannot be substantiated must not be
    // offerable, and the server does not accept it merely because a client sent it.
    expect(body.code).toBe('EXTENSION_BASIS_NOT_SELECTABLE');
  });

  it('REFUSES a basis that is not pointed at anything — free text cannot BE a basis', () => {
    // A legislative basis with no article names no law.
    expect(() =>
      assertExtensionBasis({
        basis: 'LEGISLATIVE_PROVISION',
        note: GOOD_NOTE,
        instrument: 'Some Law',
      }),
    ).toThrow();
    // A hold basis with no hold points at nothing.
    expect(() =>
      assertExtensionBasis({
        basis: 'LEGAL_HOLD_OR_DISPUTE',
        note: GOOD_NOTE,
      }),
    ).toThrow();
    // And a complete one passes, so the refusals above are not refusing everything.
    expect(() =>
      assertExtensionBasis({
        basis: 'LEGISLATIVE_PROVISION',
        note: GOOD_NOTE,
        instrument: 'Commercial Law No. 12 of 1966',
        article: 'art. 19',
      }),
    ).not.toThrow();
    expect(() =>
      assertExtensionBasis({
        basis: 'LEGAL_HOLD_OR_DISPUTE',
        note: GOOD_NOTE,
        legalHoldId: 'hold-1',
      }),
    ).not.toThrow();
  });

  it('REQUIRES the accompanying note, at the SHARED declaration minimum', () => {
    const nine = 'a'.repeat(EXTENSION_NOTE_MIN_LENGTH - 1);
    expect(() =>
      assertExtensionBasis({
        basis: 'LEGAL_HOLD_OR_DISPUTE',
        note: nine,
        legalHoldId: 'hold-1',
      }),
    ).toThrow();
    expect(() =>
      assertExtensionBasis({
        basis: 'LEGAL_HOLD_OR_DISPUTE',
        note: 'a'.repeat(EXTENSION_NOTE_MIN_LENGTH),
        legalHoldId: 'hold-1',
      }),
    ).not.toThrow();
    // ONE HOME for that figure — pinned as an identity, not as the literal 10, which is what would
    // let the two drift apart.
    expect(EXTENSION_NOTE_MIN_LENGTH).toBe(DECLARATION_REASON_MIN_LENGTH);
  });

  it('whitespace is not a basis field and not a note', () => {
    expect(() =>
      assertExtensionBasis({
        basis: 'LEGISLATIVE_PROVISION',
        note: '   ',
        instrument: 'X Law',
        article: 'art. 1',
      }),
    ).toThrow();
    expect(() =>
      assertExtensionBasis({
        basis: 'LEGISLATIVE_PROVISION',
        note: 'Retained under the instrument named.',
        instrument: '   ',
        article: 'art. 1',
      }),
    ).toThrow();
  });
});

describe('THE NOTICE HAS NO WRITE PATH TO A DISPOSAL — asserted as an absence', () => {
  it('neither the service nor the controller can reach a disposal or an anonymisation', () => {
    /*
     * The brief's own requirement: the notice DESTROYS NOTHING, it filters. An absence is the only
     * form of that claim which can fail, so it is read off the SOURCE rather than inferred from the
     * public methods — a private helper reaching a disposal repository would be invisible to a
     * type-level check and is exactly how a convenience write path arrives.
     */
    const here = __dirname;
    for (const file of [
      'retention-notice.service.ts',
      'retention-notice.controller.ts',
    ]) {
      const source = readFileSync(join(here, file), 'utf8');
      // A non-vacuity floor first: a path typo would read as a clean absence.
      expect(source.length, file).toBeGreaterThan(1000);
      for (const forbidden of [
        'DisposalBatch',
        'disposalBatch',
        'nominate(',
        'CertificateOfDestruction',
        'anonymise',
      ]) {
        expect(
          source.includes(forbidden),
          `${file} mentions ${forbidden} — the notice filters and must have no write path to a disposal`,
        ).toBe(false);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  NO_FLOOR_DECLARATION_REQUIRED,
  NO_FLOOR_REASON_MIN_LENGTH,
  STATUTORY_RETENTION_FLOORS,
  assertMeetsStatutoryFloor,
  floorForCategory,
  noFloorDeclarationRequired,
  normaliseCategory,
  resolveNoFloorDeclaration,
  statutoryFloorRefusal,
} from './retention-floors.config';
import { DECLARATION_REASON_MIN_LENGTH } from '../../common/declaration-reason';

/**
 * MODULE 0 CLOSE — the statutory retention floor, and the guard that keeps "no invented floor"
 * true rather than merely written down.
 *
 * The behaviour half is three cases the owner named: below each floor REFUSED with the article's
 * own text and number in the message, above a floor ACCEPTED, and a category with no decided
 * floor ACCEPTED with no refusal and no invented number.
 *
 * The inventory half is the one that matters in six months: a third floor, or a floor whose
 * figure arrived from an engineer rather than from an approved source, fails HERE rather than
 * reaching a broker's screen with an article number beside it.
 */

describe('the statutory retention floor REFUSES below it', () => {
  it('REFUSES a KYC due-diligence period under five years, carrying art. 17/a and its own text', () => {
    let message = '';
    try {
      assertMeetsStatutoryFloor('KYCRecord', 12);
      throw new Error('expected a refusal and got none');
    } catch (err) {
      message = (err as Error).message;
    }

    // THE ARTICLE'S NUMBER — in both the Latin form this repo uses and the Arabic designation.
    expect(message).toContain('art. 17/a');
    expect(message).toContain('المادة ١٧/أ');
    expect(message).toContain(
      'Anti-Money Laundering and Counter-Terrorism Financing Law No. 20 of 2021',
    );
    // THE ARTICLE'S OWN OPERATIVE TEXT, not a paraphrase and not "policy says no".
    expect(message).toContain(
      'customer due-diligence records and account files must be kept for at least five years',
    );
    // AND WHAT IT IS COUNTED FROM, which is part of the statute — a floor without its trigger is
    // a number somebody counts from the wrong day.
    expect(message).toContain('WHICHEVER IS LONGER');
    // The figures, so the reader can see the gap rather than infer it.
    expect(message).toContain('12 month(s)');
    expect(message).toContain('60 months');
    // And the thing that is NOT refused, said in the same breath.
    expect(message).toContain('A longer period may be set freely');
    // NOT the shape the owner ruled out.
    expect(message).not.toMatch(/policy|not allowed|forbidden/i);
  });

  it('REFUSES a financial-record period under ten years, carrying art. 19 and the owner’s definition of closing', () => {
    let message = '';
    try {
      assertMeetsStatutoryFloor('Invoice', 60);
      throw new Error('expected a refusal and got none');
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain('Commercial Law No. 12 of 1966');
    expect(message).toContain('art. 19');
    expect(message).toContain('المادة ١٩');
    expect(message).toContain(
      'financial and commercial records must be kept for ten years',
    );
    // The owner DEFINED "closing" for this system, so the refusal carries the definition rather
    // than leaving a reader to decide which closing is meant.
    expect(message).toContain('CLOSING DATE OF THE FINANCIAL TRANSACTION');
    expect(message).toContain('120 months');
    // 60 months clears the AML floor exactly and is still refused here — which is the whole point
    // of two floors rather than one.
    expect(message).toContain('60 month(s)');
  });

  it('ACCEPTS a period AT the floor and ABOVE it, and the boundary is asserted on BOTH sides', () => {
    // AT the floor — `<` not `<=`, so exactly five years is lawful. One off here would refuse a
    // period that is precisely what the statute requires.
    expect(assertMeetsStatutoryFloor('KYCRecord', 60)?.key).toBe(
      'AML_CDD_FIVE_YEARS',
    );
    expect(() => assertMeetsStatutoryFloor('KYCRecord', 59)).toThrow();
    // ABOVE it, freely.
    expect(assertMeetsStatutoryFloor('KYCRecord', 240)?.key).toBe(
      'AML_CDD_FIVE_YEARS',
    );

    expect(assertMeetsStatutoryFloor('Invoice', 120)?.key).toBe(
      'COMMERCIAL_TEN_YEARS',
    );
    expect(() => assertMeetsStatutoryFloor('Invoice', 119)).toThrow();
  });
});

describe('a category with NO decided floor takes the office’s own period', () => {
  it('ACCEPTS any period and invents no number — including for the one row that exists today', () => {
    /*
     * `AuditLogEntry` is the only `RetentionScheduleItem` row on either database (measured), and
     * NEITHER decided floor governs it: AML art. 17/a is about customer due-diligence records and
     * account files, Commercial Law art. 19 about financial and commercial records. An audit log is
     * a system record and its floor is unsourced, so it gets none.
     *
     * The 120 months it carries is a DRAFT the seed already flags as an engineering guess. This
     * test asserts the floor machinery does not quietly turn that guess into a rule.
     */
    expect(floorForCategory('AuditLogEntry')).toBeNull();
    expect(assertMeetsStatutoryFloor('AuditLogEntry', 1)).toBeNull();
    expect(assertMeetsStatutoryFloor('AuditLogEntry', 120)).toBeNull();

    // And the categories reported as unsourced behave the same way — none of them acquires a floor
    // by resembling one that has one.
    for (const category of [
      'Policy',
      'Claim',
      'ConsentRecord',
      'DataSubjectRequest',
      'Complaint',
      'ScreeningResult',
      'CommissionAgreement',
      'Employee',
      'IncidentReport',
    ]) {
      expect(floorForCategory(category), category).toBeNull();
      expect(assertMeetsStatutoryFloor(category, 1), category).toBeNull();
    }
  });

  it('does not match a category merely because it CONTAINS a governed name', () => {
    /*
     * Equality on the normalised form, never containment. A `contains` would make
     * "InvoiceDisputeCorrespondence" a ten-year commercial record because the word "invoice" is in
     * it — the same defect the insurer canonical-name key avoided one layer down, where a *contains*
     * on a number was condition 1 defeated by the thing meant to satisfy it.
     */
    expect(floorForCategory('InvoiceDisputeCorrespondence')).toBeNull();
    expect(floorForCategory('KYCRecordTrainingMaterial')).toBeNull();
    expect(floorForCategory('')).toBeNull();
    expect(floorForCategory('   ')).toBeNull();
  });

  it('folds case and separators, because one category typed two ways is one category', () => {
    expect(normaliseCategory('KYC_Record')).toBe('kycrecord');
    expect(normaliseCategory('kyc record')).toBe('kycrecord');
    expect(floorForCategory('kyc-record')?.key).toBe('AML_CDD_FIVE_YEARS');
    expect(floorForCategory('  INVOICE  ')?.key).toBe('COMMERCIAL_TEN_YEARS');
  });
});

describe('NO INVENTED FLOOR — the inventory guard', () => {
  it('holds EXACTLY the two decided floors, so a third fails here', () => {
    /*
     * An exact key set, not a count: a count survives a substitution, and the thing being guarded
     * is which floors exist rather than how many.
     */
    expect(STATUTORY_RETENTION_FLOORS.map((f) => f.key)).toEqual([
      'AML_CDD_FIVE_YEARS',
      'COMMERCIAL_TEN_YEARS',
    ]);
  });

  it('requires every floor to name an APPROVED source, an instrument, an article and its own text', () => {
    for (const floor of STATUTORY_RETENTION_FLOORS) {
      // The source has to be an owner decision. A figure that arrived any other way is the defect
      // this whole item is written against.
      expect(floor.source, floor.key).toContain('OWNER DECISION');
      // And it must stay marked provisional until somebody reads the Gazette — the same marker the
      // seed row already carries for both instruments.
      expect(floor.source, floor.key).toMatch(/PROVISIONAL/);

      expect(floor.instrument.length, floor.key).toBeGreaterThan(10);
      expect(floor.article.length, floor.key).toBeGreaterThan(3);
      expect(floor.operativeText.length, floor.key).toBeGreaterThan(20);
      expect(floor.countedFrom.length, floor.key).toBeGreaterThan(20);
      expect(floor.floorMonths, floor.key).toBeGreaterThan(0);
      expect(floor.categories.length, floor.key).toBeGreaterThan(0);

      // The refusal must actually carry all four parts — asserted through the real builder rather
      // than by trusting the fields are used.
      const message = statutoryFloorRefusal(floor, 'X', 1);
      expect(message, floor.key).toContain(floor.instrument);
      expect(message, floor.key).toContain(floor.article);
      expect(message, floor.key).toContain(floor.operativeText);
      expect(message, floor.key).toContain(floor.countedFrom);
    }
  });

  it('never lets one category fall under two floors', () => {
    /*
     * Two floors claiming one category means the answer depends on array order, and the one that
     * loses is the longer floor as often as not. `floorForCategory` returns the FIRST match, so
     * without this the arithmetic would be decided by which entry somebody happened to write first.
     */
    const seen = new Map<string, string>();
    for (const floor of STATUTORY_RETENTION_FLOORS) {
      for (const category of floor.categories) {
        const key = normaliseCategory(category);
        const already = seen.get(key);
        expect(
          already,
          `category "${category}" is claimed by both ${already} and ${floor.key}`,
        ).toBeUndefined();
        seen.set(key, floor.key);
      }
    }
    // Non-vacuity: the loop above proves nothing if the categories are empty.
    expect(seen.size).toBeGreaterThan(15);
  });

  it('states the floors in YEARS, so a months figure cannot drift from the statute', () => {
    // The statutes say five years and ten years. These are the two figures the owner decided, and
    // they are pinned here so a change to either is a deliberate edit to a test rather than a
    // one-character change in a config nobody re-reads.
    const byKey = new Map(STATUTORY_RETENTION_FLOORS.map((f) => [f.key, f]));
    expect(byKey.get('AML_CDD_FIVE_YEARS')?.floorMonths).toBe(5 * 12);
    expect(byKey.get('COMMERCIAL_TEN_YEARS')?.floorMonths).toBe(10 * 12);
  });
});

describe('THE SILENT CASE — a category with no known floor DECLARES', () => {
  const GOOD = 'These are vendor invoices we keep for the audit trail.';

  it('ASKS when the category has never been acknowledged', () => {
    /*
     * The case the whole item exists for. `Customer` takes no floor — `CustomerFile` does — so
     * before this, a period for `Customer` was accepted with no refusal and NO WORD. A hard refusal
     * escaped by a spelling, silently.
     */
    expect(
      noFloorDeclarationRequired({
        recordCategory: 'Customer',
        requestedMonths: 6,
        acknowledgedMonths: null,
      }),
    ).toBe(true);

    // And the sibling spelling that DOES have a floor is the measurement that makes this concrete.
    expect(floorForCategory('CustomerFile')?.key).toBe('AML_CDD_FIVE_YEARS');
    expect(floorForCategory('Customer')).toBeNull();
  });

  it('does NOT ask again at the SAME or a LONGER period — the exposure did not grow', () => {
    for (const requestedMonths of [24, 25, 1200]) {
      expect(
        noFloorDeclarationRequired({
          recordCategory: 'Customer',
          requestedMonths,
          acknowledgedMonths: 24,
        }),
        `${requestedMonths} is not shorter than 24 and must not re-ask`,
      ).toBe(false);
    }
  });

  it('ASKS AGAIN on a SHORTENING, by one month', () => {
    /*
     * Asserted at the BOUNDARY rather than mid-range: 24 does not re-ask and 23 does, so a `<=`
     * where `<` belongs would re-ask on an unchanged period and make the declaration wallpaper —
     * which is the failure the owner named by name.
     */
    expect(
      noFloorDeclarationRequired({
        recordCategory: 'Customer',
        requestedMonths: 23,
        acknowledgedMonths: 24,
      }),
    ).toBe(true);
  });

  it('NEVER asks for a category that HAS a floor — the sentence would be false there', () => {
    /*
     * The fourth behaviour, and the one a reasonable implementation gets wrong: the notice says the
     * SYSTEM does not know a minimum for that name. For `KYCRecord` it does, and showing the
     * sentence would be this product stating something untrue about its own knowledge.
     */
    for (const category of [
      'KYCRecord',
      'kyc-record',
      'Invoice',
      'Settlement',
    ]) {
      for (const acknowledgedMonths of [null, 24]) {
        expect(
          noFloorDeclarationRequired({
            recordCategory: category,
            requestedMonths: 1,
            acknowledgedMonths,
          }),
          `${category} has a floor and must never be asked to declare`,
        ).toBe(false);
      }
    }
  });

  it('REFUSES until the sentence, the reason AND the tick all arrive', () => {
    const ask = {
      recordCategory: 'Customer',
      requestedMonths: 6,
      acknowledgedMonths: null,
    };

    // Nothing at all.
    expect(() => resolveNoFloorDeclaration(ask, undefined)).toThrow();

    // THREE INCOMPLETE SHAPES, each refused on its own — a single test sending all three missing at
    // once would pass while only one of them was still being checked.
    for (const [label, declaration] of [
      [
        'no tick',
        { noticeShown: 'x'.repeat(60), reason: GOOD, acknowledged: false },
      ],
      [
        'no reason',
        { noticeShown: 'x'.repeat(60), reason: '   ', acknowledged: true },
      ],
      ['no notice', { noticeShown: '   ', reason: GOOD, acknowledged: true }],
    ] as const) {
      expect(
        () => resolveNoFloorDeclaration(ask, declaration),
        label,
      ).toThrow();
    }

    // The refusal carries the code the screen keys on, and SAYS the period is accepted.
    let body: Record<string, unknown> = {};
    try {
      resolveNoFloorDeclaration(ask, undefined);
    } catch (err) {
      body = (
        err as { getResponse: () => Record<string, unknown> }
      ).getResponse();
    }
    expect(body.code).toBe(NO_FLOOR_DECLARATION_REQUIRED);
    expect(body.reasonMinLength).toBe(NO_FLOOR_REASON_MIN_LENGTH);
    expect(String(body.message)).toContain('The period is accepted');
    // THE CLAUSE THAT CARRIES THE WHOLE POINT, asserted so a reword cannot drop it: the SYSTEM does
    // not know a minimum. It must never say the LAW sets none.
    expect(String(body.message)).toContain('does not know a statutory minimum');
    expect(String(body.message)).toContain(
      'Nothing here says the LAW sets no minimum',
    );
  });

  it('REFUSES a reason under the floor, and ACCEPTS one at it — both sides', () => {
    const ask = {
      recordCategory: 'Customer',
      requestedMonths: 6,
      acknowledgedMonths: null,
    };
    const notice = 'x'.repeat(60);
    const atFloor = 'a'.repeat(NO_FLOOR_REASON_MIN_LENGTH);
    const under = 'a'.repeat(NO_FLOOR_REASON_MIN_LENGTH - 1);

    expect(
      resolveNoFloorDeclaration(ask, {
        noticeShown: notice,
        reason: atFloor,
        acknowledged: true,
      }),
    ).toEqual({ noticeShown: notice, reason: atFloor, acknowledged: true });

    expect(() =>
      resolveNoFloorDeclaration(ask, {
        noticeShown: notice,
        reason: under,
        acknowledged: true,
      }),
    ).toThrow();

    // TRIMMED — the stored sentence and reason are the record, and whitespace is not part of what
    // anybody wrote or read. A reason that is only whitespace padding is refused, not accepted.
    expect(() =>
      resolveNoFloorDeclaration(ask, {
        noticeShown: notice,
        reason: `  ${under}  `,
        acknowledged: true,
      }),
    ).toThrow();
    expect(
      resolveNoFloorDeclaration(ask, {
        noticeShown: `  ${notice}  `,
        reason: `  ${atFloor}  `,
        acknowledged: true,
      })?.reason,
    ).toBe(atFloor);
  });

  it('returns NULL where no declaration is required, so a caller cannot write one it was not asked for', () => {
    expect(
      resolveNoFloorDeclaration(
        {
          recordCategory: 'KYCRecord',
          requestedMonths: 120,
          acknowledgedMonths: null,
        },
        undefined,
      ),
    ).toBeNull();
    expect(
      resolveNoFloorDeclaration(
        {
          recordCategory: 'Customer',
          requestedMonths: 36,
          acknowledgedMonths: 24,
        },
        undefined,
      ),
    ).toBeNull();
  });

  it('uses the ESTABLISHED declaration minimum, not a second one', () => {
    /*
     * The owner's instruction: "two different minimums for one concept is the drift we keep paying
     * for". Measured across the api, every declaration-shaped reason uses ten; the three-character
     * minimums belong to notes. So this is pinned as an IDENTITY with the shared constant rather
     * than as the literal 10, which is what would let the two drift apart.
     */
    expect(NO_FLOOR_REASON_MIN_LENGTH).toBe(DECLARATION_REASON_MIN_LENGTH);
  });
});

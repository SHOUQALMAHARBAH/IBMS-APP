import { describe, expect, it } from 'vitest';

import {
  ARCHIVE_RETRIEVAL_BASES,
  ARCHIVE_RETRIEVAL_BASIS_DEFINITIONS,
} from './retention-archive.config';
import {
  CATEGORY_RESOLUTIONS,
  describeRecordHandle,
  resolutionFor,
} from './retention-resolution.config';

/**
 * OWNER DECISIONS 44 AND 45 — the two things a database cannot hold.
 *
 * ## WHY `describeRecordHandle` IS TESTED HERE AND NOT ONLY OVER HTTP
 *
 * The e2e proves the register's wire shape carries a handle, which is the half a Playwright mock
 * cannot see. What it CANNOT prove is the other three states: the fixture extends one commission
 * ledger entry, so a run produces exactly one of the four. Two of the remaining three are states no
 * fixture can reach at all — `RECORD_NO_LONGER_PRESENT` needs a record destroyed out from under a
 * surviving extension row, and `CATEGORY_HAS_NO_REFERENCE` needs a category whose records cannot be
 * named, which by definition has nothing to extend that would render a value.
 *
 * So the four states are proven where the input is chosen. That is the same split group 7c settled
 * on for the blocked-phase boundary, and for the same reason: a rule whose distinguishing case the
 * test database cannot express belongs in a pure function with its own test.
 */
describe('owner decision 44 — how a record is named to a person', () => {
  const RECEIPT = 'Receipt';
  const SETTLEMENT = 'Settlement';

  it('RECORDED — the reference the record carries, with what it IS', () => {
    const got = describeRecordHandle(
      RECEIPT,
      'rec-1',
      new Map([['rec-1', 'BANK-REF-99']]),
    );
    expect(got.state).toBe('RECORDED');
    if (got.state !== 'RECORDED') throw new Error('unreachable');
    expect(got.value).toBe('BANK-REF-99');
    /*
     * The DESCRIPTION, asserted as well as the value. Four categories name four different kinds of
     * reference and one column heading cannot say which, so the description is the only thing that
     * tells a reader whether they are looking at the client's bank reference or a commission payment
     * reference — and a row rendering a bare string with no idea what it is was the defect this
     * decision set out to fix one level down.
     */
    expect(got.description).toContain('reference');
  });

  it('NOT_RECORDED — the record exists and its reference does not, which is a gap somebody can still close', () => {
    const got = describeRecordHandle(
      RECEIPT,
      'rec-1',
      new Map([['rec-1', null]]),
    );
    expect(got.state).toBe('NOT_RECORDED');
  });

  it('RECORD_NO_LONGER_PRESENT — the extension row outlived the record it names', () => {
    // The key is ABSENT from the map rather than mapping to null, which is the whole reason the
    // repository returns a Map: a missing key and a null value are different facts.
    const got = describeRecordHandle(RECEIPT, 'rec-1', new Map());
    expect(got.state).toBe('RECORD_NO_LONGER_PRESENT');
  });

  it('CATEGORY_HAS_NO_REFERENCE — a settlement cannot be named, and the row carries WHY', () => {
    const got = describeRecordHandle(SETTLEMENT, 'set-1', undefined);
    expect(got.state).toBe('CATEGORY_HAS_NO_REFERENCE');
    if (got.state !== 'CATEGORY_HAS_NO_REFERENCE')
      throw new Error('unreachable');
    /*
     * The reason is asserted on its CONTENT, not merely as non-empty. It is the only place the
     * measurement behind decision 44 survives at runtime — that the one hop which exists
     * (`claimId` is `@unique`) resolves to nothing, because `Claim.claimNumber` is optional at its
     * own boundary. A reason reworded into "not available" would satisfy a non-empty check and tell
     * the next reader nothing about why no handle was invented.
     */
    expect(got.reason).toContain('claimNumber');
    expect(got.reason).toContain('unique');
  });

  it('an UNRECOGNISED category reports no reference rather than claiming the record is gone', () => {
    /*
     * `recordCategory` is free text — an office may set a period, and an extension, for a category
     * this system cannot resolve. Reporting `RECORD_NO_LONGER_PRESENT` there would be a FALSE
     * statement about the office's own data: nothing was destroyed, we simply do not know what the
     * category refers to.
     */
    const got = describeRecordHandle('Client KYC files', 'x-1', undefined);
    expect(got.state).toBe('CATEGORY_HAS_NO_REFERENCE');
    if (got.state !== 'CATEGORY_HAS_NO_REFERENCE')
      throw new Error('unreachable');
    expect(got.reason).toContain('cannot resolve');
  });

  it('every resolution declares a handle, and a NONE declares why — so a sixth category cannot ship undecided', () => {
    expect(CATEGORY_RESOLUTIONS.length).toBeGreaterThan(0);
    for (const r of CATEGORY_RESOLUTIONS) {
      if (r.recordHandle.kind === 'NONE') {
        /*
         * A NONE whose reason is a shrug is worse than no field: it is what lets the next reader
         * conclude the handle was simply not got round to. Both of the two are measurements.
         */
        expect(r.recordHandle.reason.length).toBeGreaterThan(80);
      } else {
        expect(r.recordHandle.description.length).toBeGreaterThan(20);
      }
    }
  });

  it('THE MEASUREMENT THAT DECIDED IT, pinned: three of five resolve and exactly two cannot', () => {
    /*
     * Not a count — the two by NAME. Decision 44 asked for a stored reference to be ADDED to the
     * models that carry none, and the answer was that `Remittance` already had one a hop away
     * (`receiptId` is `@unique`) while `Settlement` and `Quotation` have none and nothing in this
     * product generates one. If a later change gives either of them a handle, this fails and the
     * register's own documentation gets corrected with it; if a resolution quietly loses one, it
     * fails the other way.
     */
    const none = CATEGORY_RESOLUTIONS.filter(
      (r) => r.recordHandle.kind === 'NONE',
    ).map((r) => r.recordCategory);
    expect(none.sort()).toEqual(['Quotation', 'Settlement']);

    const remittance = resolutionFor('Remittance');
    expect(remittance?.recordHandle.kind).toBe('VIA_ONE_TO_ONE_PARENT');
  });
});

describe('owner decision 45 — the retrieval bases are four', () => {
  it('four members, in the enum order the migration asserts', () => {
    /*
     * The ORDER is asserted and not just the set, because this array is what the screen renders as
     * a dropdown: a list whose order drifts from the database's gives two readers two different
     * first options for one closed set. `20261209100000` asserts the same sequence from `pg_enum`,
     * so the two cannot disagree without one of them failing.
     */
    expect([...ARCHIVE_RETRIEVAL_BASES]).toEqual([
      'JUDICIAL_REQUEST',
      'CBJ_AUDIT',
      'AMLU_REQUEST',
      'OTHER',
    ]);
  });

  it('the route returns the MEMBERS and no words — the meanings are the i18n tree`s', () => {
    /*
     * Owner decision 45 asked whether the route's one-string `meaning` could carry three named parts
     * and a shared line. It cannot, and the answer is that it should carry none of them: the four
     * texts are the owner's ARABIC, and this api has no message i18n at all, so a wire field cannot
     * be Arabic for one reader and English for another. Keeping an English `meaning` beside the
     * i18n ones would be two answers to the same question with the wire copy free to drift.
     *
     * Asserted as an EXACT KEY SET, because a reinstated `meaning` arrives as an ADDITION and a
     * `toHaveProperty('basis')` check would keep passing through it.
     */
    expect(ARCHIVE_RETRIEVAL_BASIS_DEFINITIONS).toHaveLength(4);
    for (const d of ARCHIVE_RETRIEVAL_BASIS_DEFINITIONS) {
      expect(Object.keys(d)).toEqual(['basis']);
    }
    expect(ARCHIVE_RETRIEVAL_BASIS_DEFINITIONS.map((d) => d.basis)).toEqual([
      ...ARCHIVE_RETRIEVAL_BASES,
    ]);
  });
});

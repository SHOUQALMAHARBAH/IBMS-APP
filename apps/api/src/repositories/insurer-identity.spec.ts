import { describe, expect, it } from 'vitest';
import {
  INSURER_IDENTITY_SELECT,
  insurerIdentity,
  insurerName,
  resolveInsurerName,
  type InsurerIdentity,
} from './insurer-identity';

/**
 * Insurer management — the one place an insurer's name is resolved.
 *
 * Eighteen files import these helpers and 15 call sites read their result, so the
 * coalesce order and the non-nullable `name` are the two properties the whole
 * feature rests on. They are asserted here rather than only through an e2e,
 * because a document template rendering an empty insurer name is a bug that
 * reaches a client before it reaches a test.
 */

const MASTER_LINKED: InsurerIdentity = {
  // Item 3 — step 1 of the name precedence. NULL here, which is the ordinary case:
  // measured, no `Insurer` row on either database is linked to a registered company.
  insuranceCompany: null,
  id: 'ins-1',
  financialStrengthRating: 'A-',
  insurerMaster: { legalName: 'AIG Jordan', legalNameAr: 'إي آي جي الأردن' },
  // A master-linked row leaves these NULL. Present in the type because a caller
  // cannot know which kind of row it holds.
  legalName: null,
  legalNameAr: null,
  isActive: true,
};

const OFFICE_LOCAL: InsurerIdentity = {
  // Item 3 — step 1 of the name precedence. NULL here, which is the ordinary case:
  // measured, no `Insurer` row on either database is linked to a registered company.
  insuranceCompany: null,
  id: 'ins-2',
  financialStrengthRating: null,
  insurerMaster: null,
  legalName: 'Wadi Rum Mutual',
  legalNameAr: 'وادي رم التعاونية',
  isActive: true,
};

describe('insurerIdentity — the coalesce', () => {
  it('reads a master-linked insurer from the global catalogue', () => {
    expect(insurerIdentity(MASTER_LINKED)).toEqual({
      id: 'ins-1',
      name: 'AIG Jordan',
      nameAr: 'إي آي جي الأردن',
      financialStrengthRating: 'A-',
      isActive: true,
    });
  });

  it('reads an office-local insurer from its own row', () => {
    expect(insurerIdentity(OFFICE_LOCAL)).toEqual({
      id: 'ins-2',
      name: 'Wadi Rum Mutual',
      nameAr: 'وادي رم التعاونية',
      financialStrengthRating: null,
      isActive: true,
    });
  });

  it('prefers the MASTER name when a row somehow carries both', () => {
    // The direction matters, and it is not arbitrary. When a row has a master
    // link, the global catalogue is the authority on the company's name; a local
    // value would be a second source of truth for one fact. The database does not
    // stop a row carrying both, so the resolution order is what decides it.
    expect(
      insurerIdentity({
        ...MASTER_LINKED,
        legalName: 'Stale Local Name',
        legalNameAr: 'اسم قديم',
      }),
    ).toMatchObject({ name: 'AIG Jordan', nameAr: 'إي آي جي الأردن' });
  });

  it('falls back to the local ARABIC name independently of the Latin one', () => {
    // `nameAr` is nullable on both sources, so the two fields coalesce
    // separately. A master with no Arabic name must not silently borrow the
    // local row's — that would be the drift the order above exists to prevent.
    expect(
      insurerIdentity({
        ...MASTER_LINKED,
        insurerMaster: { legalName: 'AIG Jordan', legalNameAr: null },
        legalNameAr: 'اسم محلي',
      }).nameAr,
    ).toBeNull();
  });

  it('keeps `name` non-nullable even for a row with neither source', () => {
    // Unreachable in the database — `Insurer_has_identity` refuses a row with
    // neither a master link nor a local name. Asserted anyway because every
    // consumer is written against a non-nullable `name`, and if that ever became
    // `undefined` the failure would surface as a blank line in a generated
    // certificate rather than as an error.
    const nameless = {
      ...OFFICE_LOCAL,
      insurerMaster: null,
      legalName: null,
    } as InsurerIdentity;
    expect(insurerIdentity(nameless).name).toBe('');
  });
});

describe('insurerIdentity — the deactivated flag', () => {
  it('carries isActive through, from either name source', () => {
    // Every surface that lets someone CHOOSE an insurer has to be able to show
    // this. It is here rather than in a second insurer-reading helper because
    // capturing a quotation from a deactivated insurer stays legal, so such a quote
    // reaches the comparison matrix — and a quote a broker can present while nobody
    // can place it is a worse failure than a quote nobody recorded.
    expect(
      insurerIdentity({ ...MASTER_LINKED, isActive: false }).isActive,
    ).toBe(false);
    expect(insurerIdentity({ ...OFFICE_LOCAL, isActive: false }).isActive).toBe(
      false,
    );
  });

  it('does not let the flag ride on the name source — a deactivated MASTER-linked insurer still reads its name', () => {
    // The flag and the name resolve independently. A regression that tied them
    // together would blank the name of a deactivated insurer, which is exactly what
    // a comparison row must not do: the whole point is to show WHO it is and that
    // they are unavailable.
    const retired = insurerIdentity({ ...MASTER_LINKED, isActive: false });
    expect(retired.name).toBe('AIG Jordan');
    expect(retired.isActive).toBe(false);
  });
});

describe('insurerName — the name alone', () => {
  /*
   * ITEM 3 — THE REGISTERED COMPANY OUTRANKS BOTH OTHER SOURCES, which `insurerName` used to
   * skip entirely. This is the assertion the whole change exists for, and it is written here
   * because it can be: nothing in the DATA exercises it — no `Insurer` row on either database is
   * linked to a registered company (dev 0 of 19, db-test 0 of 306) — so a fix with no visible
   * symptom has nothing observing it unless something is made to observe it.
   *
   * BOTH LOSING SOURCES ARE PRESENT ON PURPOSE. A fixture carrying only the registered company
   * would pass against an implementation that merely coalesced in some order; this one fails
   * unless the company genuinely WINS over a catalogue row AND a local name that are both there
   * and both different.
   */
  it("prefers the REGISTERED COMPANY over the catalogue and the office's own row", () => {
    expect(
      insurerName({
        insuranceCompany: { legalName: 'Al-Yarmouk Insurance Company PLC' },
        insurerMaster: { legalName: 'Yarmouk Insurance (catalogue)' },
        legalName: 'Yarmouk Ins. Co.',
      }),
    ).toBe('Al-Yarmouk Insurance Company PLC');
  });

  it('is the SAME function the company-facts resolver uses — one precedence, not two', () => {
    /*
     * The defect was never a disagreement about policy; it was a second IMPLEMENTATION of one
     * policy, and this is what stops a third appearing. `resolveInsurerCompanyFacts` is the
     * resolver `/insurers` renders from, so if these two ever answer differently a document and
     * a screen name the same company two ways.
     */
    const linked = {
      insuranceCompany: { legalName: 'Al-Yarmouk Insurance Company PLC' },
      insurerMaster: { legalName: 'Yarmouk Insurance (catalogue)' },
      legalName: 'Yarmouk Ins. Co.',
    };
    expect(resolveInsurerName(linked)).toBe(insurerName(linked));
  });

  it('coalesces the same way as the full identity', () => {
    expect(insurerName(MASTER_LINKED)).toBe('AIG Jordan');
    expect(insurerName(OFFICE_LOCAL)).toBe('Wadi Rum Mutual');
  });

  it('accepts a partial row — only the three name sources are required', () => {
    // Deliberately narrower than `InsurerIdentity`: a report row or a document
    // line should not have to select `financialStrengthRating` to render a name.
    expect(
      insurerName({
        insuranceCompany: null,
        insurerMaster: { legalName: 'Petra Insurance' },
        legalName: null,
      }),
    ).toBe('Petra Insurance');
  });
});

describe('INSURER_IDENTITY_SELECT', () => {
  it('selects both name sources, so a consumer cannot resolve half the coalesce', () => {
    // The trap this constant exists for: five private copies once drifted, and a
    // stale key in a Prisma `select` resolves to `never` rather than failing the
    // build. A select that omitted `legalName` would typecheck against
    // `insurerName` only by accident, so the shape is asserted directly.
    expect(INSURER_IDENTITY_SELECT).toMatchObject({
      id: true,
      financialStrengthRating: true,
      legalName: true,
      legalNameAr: true,
      isActive: true,
      insurerMaster: { select: { legalName: true, legalNameAr: true } },
    });
  });
});

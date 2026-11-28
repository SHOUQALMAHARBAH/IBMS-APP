import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toProviderOfficeStateView } from './provider-office-state.service';
import type { ProviderOfficeStateRow } from '../../repositories/provider-office-state.repository';
import { INSTRUMENT_LICENCE_FIGURES } from './legal-figures.double';

/**
 * MODULE 0 ITEM (j) — the three licence states, and why these tests exist at all.
 *
 * THREE PLANTS SURVIVED THE E2E before this file was written, and each survived for the same
 * reason: db-test holds ONE office whose seeded term expires far in the future, so
 *
 *   * a NAIVE `expiresAt <= now` answers identically to the regulatory rule,
 *   * the `no term on record` branch is never reached,
 *   * and the renewal-pending rule — the case where the two readings DISAGREE —
 *     cannot occur.
 *
 * An e2e over one office cannot tell those apart however it is written. So the states are proven
 * here, where the input is chosen, and the e2e proves what only it can: that the view crosses
 * offices, that the column list holds on the wire, and that the route is gated.
 */

const BASE: ProviderOfficeStateRow = {
  organizationId: 'org-1',
  legalName: 'Test Brokerage Office',
  legalNameAr: 'مكتب وساطة للاختبار',
  subdomain: 'test-office',
  organizationType: 'BROKERAGE_OFFICE',
  brokerKind: 'CORPORATE',
  organizationStatus: 'ACTIVE',
  onboardedAt: new Date('2024-01-01T00:00:00.000Z'),
  licenseNumber: 'CBJ-1',
  // REQUIRED on the row type rather than optional, so a fixture cannot omit it and make "no
  // regulator has barred this office" indistinguishable from "nobody looked".
  mayNotIssue: false,
  licenseIssuedAt: new Date('2024-01-01T00:00:00.000Z'),
  licenseExpiresAt: new Date('2026-12-31T00:00:00.000Z'),
  renewalRequestedAt: null,
  /*
   * THE THREE RENEWAL BITS, ALL FALSE IN THE BASE — the full walk §A item 10.
   *
   * FALSE is the non-widening direction: absent must never mean permitted. A base that carried
   * them TRUE would make every case below look like a licence under renewal, and the one test
   * that matters — a timely filing with no proof is still EXPIRED — would pass against a
   * derivation that ignored them entirely.
   */
  renewalProofOnRecord: false,
  renewalReferenceOnRecord: false,
  renewalDeclarationOnRecord: false,
  licensedBranches: 4,
  dormantLicensedBranches: 1,
  users: 10,
  activeUsers: 8,
  /* THE FULL WALK §A ITEM 11. Eight of the ten have been used in the base, so the re-invite state
   * below is a DEPARTURE from it rather than the default — the non-widening direction. */
  enteredUsers: 8,
  lastActivityAt: new Date('2026-10-01T00:00:00.000Z'),
};

const NOW = new Date('2026-06-01T00:00:00.000Z');

describe('item (j): the three licence states', () => {
  it('NO TERM ON RECORD is null, not lapsed', () => {
    /*
     * The distinction a careless dashboard loses. Item (c) made ABSENCE block new business under
     * art. 21/a/9, and an office with nothing on record is further from compliant than one whose
     * licence merely ran out — so reporting it as "lapsed" would tell a provider a licence expired
     * when none was ever recorded, and would hide the worse of the two states behind the milder one.
     */
    const view = toProviderOfficeStateView(
      {
        ...BASE,
        licenseNumber: null,
        licenseIssuedAt: null,
        licenseExpiresAt: null,
      },
      NOW,
      INSTRUMENT_LICENCE_FIGURES,
    );
    expect(view.standing).toBeNull();
    expect(view.renewalDueBy).toBeNull();
    expect(view.renewalFiledOnTime).toBeNull();
  });

  it('a term inside its period is ACTIVE — the one state entitled to «ساري»', () => {
    const view = toProviderOfficeStateView(
      BASE,
      NOW,
      INSTRUMENT_LICENCE_FIGURES,
    );
    // Decision 128's own words, quoted in `compliance-risk.ts`: «ساري» belongs to a term INSIDE
    // its printed dates and to nothing else. This is that term.
    expect(view.standing?.status).toBe('ACTIVE');
    expect(view.standing?.mayPractise).toBe(true);
  });

  it('a term past its expiry with NO renewal filed is EXPIRED and may not practise', () => {
    const view = toProviderOfficeStateView(
      BASE,
      new Date('2027-02-01T00:00:00.000Z'),
      INSTRUMENT_LICENCE_FIGURES,
    );
    expect(view.standing?.status).toBe('EXPIRED');
    expect(view.standing?.mayPractise).toBe(false);
  });

  /*
   * 🔴 CORRECTED IN BOTH DIRECTIONS, NOT DELETED — AND THIS TEST USED TO ASSERT THE DEFECT.
   *
   * It read «A TERM PAST ITS EXPIRY WITH A TIMELY RENEWAL IS NOT LAPSED» and pinned
   * `isCurrentlyLapsed: false` on exactly this input — so it demanded the answer that made
   * `/provider-offices` print «ساري» for a lapsed office, and it would have passed forever.
   *
   * It was TRUE of the field it named. `isBrokerLicenseCurrentlyLapsed` really is
   * `!renewalFiledOnTime` past expiry, and that function is the date-only rule decision 128
   * REPLACED — `license-standing.config.ts` forbids reinstating it in a standing derivation in its
   * own words. What was wrong was a screen printing a standing word for it.
   *
   * ⟶ So the filing alone is now asserted to be NOT ENOUGH, which is decision 128: four
   *   conditions, and a timely filing is one. The two halves below are the two sides of that edge,
   *   and `renewalFiledOnTime` is still asserted TRUE in both — the filing fact did not change,
   *   only what may be concluded from it alone.
   */
  it('a timely renewal filing ALONE does not lift the expiry — no proof means EXPIRED', () => {
    const view = toProviderOfficeStateView(
      {
        ...BASE,
        // 45 calendar days before 2026-12-31 is 2026-11-16; filed well before that.
        renewalRequestedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      new Date('2027-02-01T00:00:00.000Z'),
      INSTRUMENT_LICENCE_FIGURES,
    );
    expect(view.renewalFiledOnTime).toBe(true);
    expect(view.standing?.status).toBe('EXPIRED');
    expect(view.standing?.mayPractise).toBe(false);
  });

  it('filed on time, proof and declaration on record is RENEWAL_PENDING and MAY practise', () => {
    /*
     * OFFICE B's OWN STATE, measured on the owner's database 2026-11-28: term expiring
     * 2025-12-31, filed 2025-11-01, proof and reference on record, declaration sworn 2026-11-25.
     * `deriveRenewalUnderStudy` answers UNDER_STUDY and the standing is RENEWAL_PENDING with
     * `mayPractise: true` — so the new-business block is lifted BY RIGHT under decision 128, and
     * decision 167/17's first branch is the one that holds.
     *
     * This is the case the provider screen could not reach before: the view carried two of
     * decision 128's five licence fields and the other three were invisible to it.
     */
    const view = toProviderOfficeStateView(
      {
        ...BASE,
        renewalRequestedAt: new Date('2026-10-01T00:00:00.000Z'),
        renewalProofOnRecord: true,
        renewalReferenceOnRecord: true,
        renewalDeclarationOnRecord: true,
      },
      new Date('2027-02-01T00:00:00.000Z'),
      INSTRUMENT_LICENCE_FIGURES,
    );
    expect(view.renewalFiledOnTime).toBe(true);
    expect(view.standing?.status).toBe('RENEWAL_PENDING');
    expect(view.standing?.mayPractise).toBe(true);
  });

  it('proof without the declaration is still EXPIRED — AWAITING_DECLARATION', () => {
    // The third of the four states a `false` date-only lapse used to cover. Decision 136(ب)'s
    // sentence lives on the office's own screen; here it means the office may not issue yet, and
    // the provider must not be told its licence is «ساري».
    const view = toProviderOfficeStateView(
      {
        ...BASE,
        renewalRequestedAt: new Date('2026-10-01T00:00:00.000Z'),
        renewalProofOnRecord: true,
        renewalReferenceOnRecord: true,
        renewalDeclarationOnRecord: false,
      },
      new Date('2027-02-01T00:00:00.000Z'),
      INSTRUMENT_LICENCE_FIGURES,
    );
    expect(view.standing?.status).toBe('EXPIRED');
    expect(view.standing?.mayPractise).toBe(false);
  });

  it('a proof with no reference number is NO_PROOF — both bits are read, not just one', () => {
    /*
     * ⚠️ THE REFERENCE BIT IS A SEPARATE COLUMN AND THIS IS WHY. `deriveRenewalUnderStudy` fails
     * condition 2 when EITHER the proof document or the reference number is missing, so a single
     * «proof on record» bit would have made a filing with no Central Bank reference read as fully
     * proven. Without this case the third column could be deleted and every other test here would
     * still pass.
     */
    const view = toProviderOfficeStateView(
      {
        ...BASE,
        renewalRequestedAt: new Date('2026-10-01T00:00:00.000Z'),
        renewalProofOnRecord: true,
        renewalReferenceOnRecord: false,
        renewalDeclarationOnRecord: true,
      },
      new Date('2027-02-01T00:00:00.000Z'),
      INSTRUMENT_LICENCE_FIGURES,
    );
    expect(view.standing?.status).toBe('EXPIRED');
    expect(view.standing?.mayPractise).toBe(false);
  });

  it('a term past its expiry with a LATE renewal IS lapsed', () => {
    // The other side of the same edge: the extension is earned by filing ON TIME, so a late
    // filing does not buy it. Both sides are asserted, because a rule tested on one side is a rule
    // that passes against an implementation that always says yes.
    const view = toProviderOfficeStateView(
      {
        ...BASE,
        renewalRequestedAt: new Date('2026-12-20T00:00:00.000Z'),
      },
      new Date('2027-02-01T00:00:00.000Z'),
      INSTRUMENT_LICENCE_FIGURES,
    );
    expect(view.standing?.status).toBe('EXPIRED');
    expect(view.standing?.mayPractise).toBe(false);
    expect(view.renewalFiledOnTime).toBe(false);
  });

  /*
   * RE-POINTED, not deleted. This asserted that a MANUAL LAPSE outranked a timely renewal filing —
   * `licenseStatus: 'lapsed'` with a filed renewal still reading `isCurrentlyLapsed: true` — and
   * its comment was right about why: *"a CBJ suspension is not cured by having applied for
   * renewal."*
   *
   * The column is gone (the third of three answers), so the view no longer carries it and this
   * dashboard no longer rebuilds a term object from it. The RULE moved to where a regulator's act
   * is modelled properly: `deriveLicenseStanding` folds `RegulatoryAction` before the term
   * arithmetic, and `license-standing.config.spec.ts` asserts exactly that ordering with a timely
   * filing in play.
   *
   * What this dashboard still owes is the half it can answer from a term alone, asserted above: a
   * term past its expiry with nothing filed reads lapsed.
   */

  it("art. 11's deadline is 45 days before expiry, derived not stored", () => {
    expect(
      toProviderOfficeStateView(BASE, NOW, INSTRUMENT_LICENCE_FIGURES)
        .renewalDueBy,
    ).toBe('2026-11-16T00:00:00.000Z');
  });
});

describe('item (j): the view carries office state and nothing else', () => {
  it('every field is office state — no key names a person, a customer or money', () => {
    // The same boundary the migration and the e2e assert, at the shape level: a field added to
    // `ProviderOfficeStateView` is caught here even before a migration exposes it.
    const view = toProviderOfficeStateView(
      BASE,
      NOW,
      INSTRUMENT_LICENCE_FIGURES,
    );
    for (const key of Object.keys(view)) {
      expect(
        /userId|email|phone|nationalId|customer|polic|premium|commission|capital|fullName/i.test(
          key,
        ),
        `ProviderOfficeStateView has a field named \`${key}\`, which looks like personal, customer or money data. This is a CROSS-OFFICE read.`,
      ).toBe(false);
    }
    /*
     * ⛔ AND NO KEY NAMES THE DECLARING PERSON OR WHAT WAS FILED — the full walk §A item 10.
     *
     * The three renewal columns are BITS, and this is the shape-level half of the migration's ban:
     * `actorNameShown` and `declaredAt` belong to an employee of ANOTHER office, and the proof
     * document id and the Central Bank's reference number are that office's record. The regex above
     * would not catch any of the four, so they are named.
     */
    const payload = JSON.stringify(view);
    for (const banned of [
      'actorNameShown',
      'declaredAt',
      'renewalProofDocumentId',
      'renewalReferenceNumber',
      'standingActDecisionRef',
      'renewalUnderStudy',
    ]) {
      expect(
        payload.includes(banned),
        `the provider payload carries \`${banned}\`, which is another office's record and not the provider's. See the migration's ban list.`,
      ).toBe(false);
    }
    // NON-VACUOUS: the derived standing really is on the payload, so the sweep above is run over
    // something rather than over an object the mapper failed to build.
    expect(view.standing?.status).toBe('ACTIVE');

    // And it is not vacuous: the office-state fields really are there.
    expect(view.licensedBranches).toBe(4);
    expect(view.dormantLicensedBranches).toBe(1);
    expect(view.activeUsers).toBe(8);
    expect(view.lastActivityAt).toBe('2026-10-01T00:00:00.000Z');
  });
});

/**
 * 🔴 THE EXACT KEY SET IN THE e2e IS THE DTO's FIELD LIST — AND IT WAS A SECOND COPY OF IT.
 * The full walk §A item 10, after CI said so twice.
 *
 * ## What happened
 *
 * `provider-office-state.e2e-spec.ts` asserts `Object.keys(row).sort()` against a written-out list.
 * That is the RIGHT shape — it is the only thing that catches a field ADDED to a cross-office
 * payload without an argument, which a pile of `toHaveProperty` calls cannot.
 *
 * But it is a hand-maintained copy of `ProviderOfficeStateView`'s fields, and this batch replaced
 * `isCurrentlyLapsed` with `standing`. The old name came out of that list and the new one went only
 * into the present-half loop beside it — so the list said 21 keys where the payload has 22, and
 * **CI step 27 was the only thing that could say so**, because the api e2e does not run on the
 * authoring machine (db-test `ibms_app` credentials).
 *
 * ⚠️ AND IT TOOK TWO RED RUNS, because the first failure masked it: «missing `enteredUsers`» and
 * «the exact key set disagrees» are the same list being wrong in two directions at once, and fixing
 * the first is what uncovered the second.
 *
 * ## ⛔ Why the e2e cannot just import the field names
 *
 * `ProviderOfficeStateView` is a TypeScript interface. It has no runtime representation, so there is
 * nothing to iterate. The copy is forced; what is NOT forced is leaving it unchecked.
 *
 * ⟶ So this compares the two SOURCE TEXTS, in the unit suite, which runs in both places. It is
 *   the same remedy applied one layer down in `provider-office-state.repository.ts`, where the
 *   SELECT had drifted from the declared column list for the same reason — and the same lesson:
 *   when an exact-set assertion fails, COMPUTE the two lists rather than reading them, because the
 *   failure cannot tell you which side is wrong.
 */
describe('item (j): the e2e key set and the DTO are one list', () => {
  const SERVICE = join(__dirname, 'provider-office-state.service.ts');
  const E2E = join(
    __dirname,
    '..',
    '..',
    '..',
    'test',
    'provider-office-state.e2e-spec.ts',
  );

  /** The DTO's TOP-LEVEL field names. Depth-tracked, because `standing` is a nested object and its
   *  own `status` / `mayPractise` are not payload keys. */
  function dtoFields(): string[] {
    const source = readFileSync(SERVICE, 'utf8');
    const start = source.indexOf('export interface ProviderOfficeStateView {');
    expect(start, 'ProviderOfficeStateView was not found').toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('\n}\n', start));
    const names: string[] = [];
    let depth = 0;
    for (const line of body.split('\n').slice(1)) {
      const match = /^\s*([A-Za-z][A-Za-z0-9]*)\??:/.exec(line);
      if (match && depth === 0) names.push(match[1]);
      depth += (line.match(/\{/g) ?? []).length;
      depth -= (line.match(/\}/g) ?? []).length;
    }
    return [...new Set(names)].sort();
  }

  /** The names inside the e2e's `Object.keys(row).sort()` expectation. */
  function assertedKeys(): string[] {
    const source = readFileSync(E2E, 'utf8');
    const start = source.indexOf('expect(Object.keys(row).sort()).toEqual([');
    expect(start, 'the exact key set was not found in the e2e').toBeGreaterThan(
      -1,
    );
    const block = source.slice(start, source.indexOf(']);', start));
    return [...block.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]).sort();
  }

  it('both lists were located and neither is empty', () => {
    expect(dtoFields().length).toBeGreaterThan(15);
    expect(assertedKeys().length).toBeGreaterThan(15);
  });

  it("the e2e asserts EXACTLY the DTO's fields — both directions", () => {
    const dto = dtoFields();
    const asserted = assertedKeys();
    expect(
      asserted.filter((key) => !dto.includes(key)),
      'the e2e asserts keys the DTO does not declare — the assertion would fail on the wire',
    ).toEqual([]);
    expect(
      dto.filter((field) => !asserted.includes(field)),
      'the DTO declares fields the e2e does not assert — this is the direction that failed in CI twice, and it is the one a cross-office payload cannot afford: a field added without an argument goes unnoticed',
    ).toEqual([]);
  });

  it('and the asserted list is SORTED, because it is compared against a sorted one', () => {
    const asserted = assertedKeys();
    expect(asserted).toEqual([...asserted].sort());
  });

  it('⛔ and the three renewal BITS are not payload keys at all', () => {
    /*
     * They are on the repository ROW (read from the view) and are INPUTS to the derivation — the
     * provider is sent the derived `standing`, never the facts behind it. This asserts the
     * narrowing the migration argues for, on the shape rather than in a comment.
     */
    const dto = dtoFields();
    for (const bit of [
      'renewalProofOnRecord',
      'renewalReferenceOnRecord',
      'renewalDeclarationOnRecord',
    ]) {
      expect(
        dto,
        `${bit} reached the provider payload; it is an input to the standing derivation and nothing more`,
      ).not.toContain(bit);
    }
    // NON-VACUOUS: the derived field it feeds really is there.
    expect(dto).toContain('standing');
  });
});

import { describe, expect, it } from 'vitest';
import {
  DERIVED_LICENSE_STATUSES,
  deriveLicenseStanding,
  type DerivedLicenseStatus,
  type LicenseTermRow,
  type RegulatoryActRow,
} from './license-standing.config';

/**
 * MODULE 0-ب ITEM (d) — the derived licence standing.
 *
 * ## WHY A PURE UNIT SPEC AND NOT AN e2e
 *
 * The same reason the provider dashboard's lapse mapper was extracted: db-test holds ONE brokerage
 * office with a term expiring far in the future and ZERO regulatory acts, so an e2e over it cannot
 * reach a single branch below. Three plants survived an e2e in that module for exactly this reason,
 * and the cure was a pure function whose inputs the test chooses.
 *
 * Every case here picks `now` explicitly. Nothing reads the clock.
 */

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function term(over: Partial<LicenseTermRow> = {}): LicenseTermRow {
  return {
    issuedAt: d('2024-01-15'),
    expiresAt: d('2026-12-31'),
    renewalRequestedAt: null,
    ...over,
  };
}

let actSeq = 0;
function act(over: Partial<RegulatoryActRow> = {}): RegulatoryActRow {
  // `recordedAt` and `id` ADVANCE PER CALL, so acts built in source order fold in source order.
  // A fixture that gave every act one instant would make the tie-break untestable AND would leave
  // the fold's answer depending on `Array.prototype.sort` — which is the defect being fixed.
  actSeq += 1;
  return {
    kind: 'SUSPENSION',
    basis: 'BROKER_REQUEST',
    effectiveFrom: d('2026-01-01'),
    suspendedUntil: null,
    decisionRef: 'CBJ-2026-77',
    recordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, actSeq)),
    id: `act-${String(actSeq).padStart(4, '0')}`,
    ...over,
  };
}

/** Collected so the last test can prove the cases below really reach every status. */
const reached = new Set<DerivedLicenseStatus>();
function standing(
  t: LicenseTermRow | null,
  acts: RegulatoryActRow[],
  now: Date,
) {
  const result = deriveLicenseStanding(t, acts, now);
  reached.add(result.status);
  return result;
}

describe('the term alone decides, when the regulator has done nothing', () => {
  it('NO TERM ON RECORD is its own status and BLOCKS — not "lapsed", not "cancelled"', () => {
    /*
     * Module 0 item (c)'s decision under art. 21/a/9. The distinction is the point: an office that
     * never recorded a licence is further from compliant than one whose licence ran out, because the
     * lapsed office can at least show a regulator what it once held. Reporting this as EXPIRED would
     * hide the worse state behind the milder one.
     */
    const s = standing(null, [], d('2026-06-01'));
    expect(s.status).toBe('NO_TERM_ON_RECORD');
    expect(s.mayPractise).toBe(false);
  });

  it('inside the term with nothing filed is ACTIVE', () => {
    const s = standing(term(), [], d('2026-06-01'));
    expect(s.status).toBe('ACTIVE');
    expect(s.mayPractise).toBe(true);
    expect(s.standingActDecisionRef).toBeNull();
  });

  it('past the printed expiry with NO renewal filed is EXPIRED, and may not practise', () => {
    const s = standing(term(), [], d('2027-02-01'));
    expect(s.status).toBe('EXPIRED');
    expect(s.mayPractise).toBe(false);
  });

  it('past the expiry with a LATE application is still EXPIRED — art. 11 has no extension', () => {
    // The term expires 2026-12-31, so art. 11's deadline is 45 calendar days before: 2026-11-16.
    // Filing on 2026-12-01 is late, and lateness is the whole difference between this and the case
    // below.
    const s = standing(
      term({ renewalRequestedAt: d('2026-12-01') }),
      [],
      d('2027-02-01'),
    );
    expect(s.status).toBe('EXPIRED');
    expect(s.mayPractise).toBe(false);
  });

  it('past the expiry with a TIMELY application is RENEWAL_PENDING and MAY practise', () => {
    const s = standing(
      term({ renewalRequestedAt: d('2026-11-01') }),
      [],
      d('2027-02-01'),
    );
    expect(s.status).toBe('RENEWAL_PENDING');
    expect(s.mayPractise).toBe(true);
  });

  it('INSIDE the term with an application already filed is ALSO renewal-pending', () => {
    /*
     * Wider than the field dictionary's «قيد التجديد» reads at first, and deliberately so. An office
     * that files 45 days early is under renewal for those 45 days too. `mayPractise` stays true, so
     * the wider reading costs nothing — while the narrow one would report ACTIVE to an officer whose
     * renewal is sitting with the regulator, which is a fact Compliance wants on the screen.
     */
    const s = standing(
      term({ renewalRequestedAt: d('2026-11-20') }),
      [],
      d('2026-12-01'),
    );
    expect(s.status).toBe('RENEWAL_PENDING');
    expect(s.mayPractise).toBe(true);
  });
});

describe("the regulator's acts outrank the term arithmetic", () => {
  it('a suspension inside a perfectly current term SUSPENDS, and names the decision', () => {
    // The dates look fine. Reporting ACTIVE here would be the system contradicting a regulator.
    const s = standing(term(), [act()], d('2026-06-01'));
    expect(s.status).toBe('SUSPENDED');
    expect(s.mayPractise).toBe(false);
    expect(s.standingActDecisionRef).toBe('CBJ-2026-77');
  });

  it('a CANCELLATION on an already-expired term reports CANCELLED, not EXPIRED', () => {
    const s = standing(
      term(),
      [act({ kind: 'CANCELLATION', effectiveFrom: d('2026-03-01') })],
      d('2027-02-01'),
    );
    expect(s.status).toBe('CANCELLED');
    expect(s.deemedCancelledUnderArticle14C).toBe(false);
    expect(s.standingActDecisionRef).toBe('CBJ-2026-77');
  });

  it('an act dated in the FUTURE is recorded and not yet in force', () => {
    const s = standing(
      term(),
      [act({ effectiveFrom: d('2026-09-01') })],
      d('2026-06-01'),
    );
    expect(s.status).toBe('ACTIVE');
  });

  it('a REINSTATEMENT (art. 14/b) clears the suspension before it', () => {
    const s = standing(
      term(),
      [
        act({ effectiveFrom: d('2026-02-01') }),
        act({ kind: 'REINSTATEMENT', effectiveFrom: d('2026-04-01') }),
      ],
      d('2026-06-01'),
    );
    expect(s.status).toBe('ACTIVE');
  });

  it('an act is answered by a term issued AFTER it — which is how a re-licensed office exists', () => {
    /*
     * Art. 14/c ends «وعلى الوسيط تقديم طلب ترخيص جديد» — the way back from a cancellation is a NEW
     * LICENCE, never a reinstatement. So a cancelled-then-re-licensed office carries its cancellation
     * act forever, and without this rule it would be reported CANCELLED for the rest of its life.
     *
     * The new TERM is the regulator acting again, exactly as the next term IS the renewal decision —
     * which is why no `renewalDecidedAt` column exists either.
     */
    const s = standing(
      term({ issuedAt: d('2026-05-01'), expiresAt: d('2028-12-31') }),
      [act({ kind: 'CANCELLATION', effectiveFrom: d('2026-03-01') })],
      d('2026-06-01'),
    );
    expect(s.status).toBe('ACTIVE');
    expect(s.mayPractise).toBe(true);
  });
});

describe('art. 14/c — a suspension beyond two years is DEEMED a cancellation', () => {
  it('an art. 14/a suspension past two years reports CANCELLED, flagged as DEEMED', () => {
    const s = standing(
      term({ expiresAt: d('2029-12-31') }),
      [act({ basis: 'BROKER_REQUEST', effectiveFrom: d('2026-01-01') })],
      d('2028-01-02'),
    );
    expect(s.status).toBe('CANCELLED');
    expect(s.deemedCancelledUnderArticle14C).toBe(true);
    // The flag is not decoration: a screen must be able to tell "the CBJ cancelled this" from "this
    // lapsed into cancellation by operation of law", because only the second can still surprise the
    // office.
    expect(s.standingActDecisionRef).toBe('CBJ-2026-77');
  });

  it('EXACTLY two years is not yet exceeded — the article says «تجاوزت»', () => {
    // The boundary assertion a mid-range test cannot make. One day either side of it is the whole
    // difference between an office being licensed and being told to apply afresh.
    const s = standing(
      term({ expiresAt: d('2029-12-31') }),
      [act({ basis: 'BROKER_REQUEST', effectiveFrom: d('2026-01-01') })],
      d('2028-01-01'),
    );
    expect(s.status).toBe('SUSPENDED');
    expect(s.deemedCancelledUnderArticle14C).toBe(false);
  });

  it('counts in CALENDAR years across a leap day, not in 730 days', () => {
    /*
     * 2024-02-29 + two CALENDAR years lands on 2026-03-01 (February has no 29th in 2026). Adding
     * 730 days lands on 2026-02-28 and would deem the licence cancelled a day early — an office
     * told to reapply while it still holds a suspension it could have lifted.
     *
     * THE ASSERTION IS ON 2026-03-01 AND IT HAS TO BE. That single day is the only one where the
     * two arithmetics disagree, and the first version of this test picked 2026-02-28 and 2026-03-02
     * — one either side of BOTH thresholds, so it answered identically under either reading and the
     * plant left it green. Found by planting, not by reading it: a boundary test that straddles too
     * widely is indistinguishable from one that straddles correctly.
     */
    const suspended = act({
      basis: 'BROKER_REQUEST',
      effectiveFrom: d('2024-02-29'),
    });
    const t = term({ issuedAt: d('2024-01-15'), expiresAt: d('2029-12-31') });
    expect(standing(t, [suspended], d('2026-03-01')).status).toBe('SUSPENDED');
    expect(standing(t, [suspended], d('2026-03-02')).status).toBe('CANCELLED');
  });

  it('DOES NOT fire on an art. 21/b SANCTION, however long it has stood', () => {
    /*
     * THE REASON `basis` IS A COLUMN. Art. 14 is suspension «بناء على طلبه» — at the broker's own
     * request — and 14/c converts that voluntary withdrawal into a cancellation after two years.
     * Art. 21/b/5 is a PENALTY the CBJ imposes «وللمدة التي يراها مناسبة».
     *
     * Applying 14/c here would report a brokerage serving a long CBJ penalty as CANCELLED, by
     * operation of a rule written for somebody who asked to stop trading. Whether 14/c also reaches
     * a 21/b suspension is genuinely unsettled in the text and is a question for the regulator —
     * recorded in docs/deferred-register.md rather than inferred.
     */
    const s = standing(
      term({ expiresAt: d('2029-12-31') }),
      [act({ basis: 'SANCTION', effectiveFrom: d('2026-01-01') })],
      d('2030-01-01'),
    );
    expect(s.status).toBe('SUSPENDED');
    expect(s.deemedCancelledUnderArticle14C).toBe(false);
  });
});

describe("a sanction's own period runs out without anything sweeping it", () => {
  it('still suspends while the period is open', () => {
    const s = standing(
      term(),
      [
        act({
          basis: 'SANCTION',
          effectiveFrom: d('2026-01-01'),
          suspendedUntil: d('2026-09-01'),
        }),
      ],
      d('2026-06-01'),
    );
    expect(s.status).toBe('SUSPENDED');
  });

  it('stops suspending the moment the period passes — derived, never a stored flag', () => {
    const s = standing(
      term(),
      [
        act({
          basis: 'SANCTION',
          effectiveFrom: d('2026-01-01'),
          suspendedUntil: d('2026-03-01'),
        }),
      ],
      d('2026-06-01'),
    );
    expect(s.status).toBe('ACTIVE');
    expect(s.mayPractise).toBe(true);
  });
});

describe('the manual lapse marker is GONE, and the rule it carried moved', () => {
  /*
   * This block asserted `standing(term({ status: 'lapsed' }), [], …)` reporting SUSPENDED with a
   * NULL decision reference — the marker's stated meaning, and its own comment called that null
   * "the finding" because *"a suspension nobody can cite is exactly the state `RegulatoryAction`
   * exists to end"*.
   *
   * The table has a writer now (`POST /broker-license/regulatory-actions`), so the marker was
   * REPLACED before the column was dropped — `docs/deferred-register.md` entry 12's order exactly.
   * What follows asserts the rule the marker carried, over a real act: a regulator's intervention
   * outranks the term arithmetic, and a timely renewal filing does not cure it.
   */
  it('a recorded SUSPENSION outranks a perfectly current term — and a timely renewal does not cure it', () => {
    const s = standing(
      term({
        expiresAt: d('2028-12-31'),
        // FILED ON TIME, which is what the old marker test was really about: the ordering must not
        // let a renewal application paper over a regulator's own decision.
        renewalRequestedAt: d('2026-05-01'),
      }),
      [
        act({
          kind: 'SUSPENSION',
          basis: 'SANCTION',
          effectiveFrom: d('2026-05-15'),
          decisionRef: 'CBJ/2026/77',
        }),
      ],
      d('2026-06-01'),
    );
    expect(s.status).toBe('SUSPENDED');
    expect(s.mayPractise).toBe(false);
    // AND IT IS CITABLE, which is the whole difference from the flag it replaced.
    expect(s.standingActDecisionRef).toBe('CBJ/2026/77');
  });
});

describe('the cases above are not vacuous', () => {
  it('reaches EVERY status this module can produce', () => {
    /*
     * The guard that makes the rest of the file mean something. A branch no case reaches is a branch
     * no plant can kill, and six statuses with four of them untested would look exactly like a full
     * spec. Fails by NAMING the unreached ones rather than on a count.
     */
    const missing = DERIVED_LICENSE_STATUSES.filter((s) => !reached.has(s));
    expect(
      missing,
      'these derived statuses are never produced by any case in this file, so nothing observes them',
    ).toEqual([]);
  });
});

describe('the fold is a TOTAL order, because two acts can bear one date', () => {
  /*
   * FOUND BY AN E2E FAILING IN A SPEC ABOUT RECOMMENDATIONS.
   *
   * `effectiveFrom` is `@db.Date`, so a suspension and the reinstatement that lifts it the same day
   * are EQUAL to a comparator that reads only that column — and `Array.prototype.sort` is then free
   * to return either first. The office's standing, which decides whether it may lawfully trade, was
   * being settled by the query plan.
   *
   * That is the recorded `findActiveUserIdsWithPermission` class: it passed at 46,153 rows and
   * failed at 23. Here it passed on dev and failed the moment two e2e specs recorded acts on one
   * day.
   *
   * The tie-break is `recordedAt` — never for whether an act is IN FORCE, which is `effectiveFrom`
   * alone, but for two letters bearing one date the later-RECORDED one is the later decision.
   */
  const SAME_DAY = d('2026-06-01');

  it('a same-day REINSTATEMENT recorded after a suspension lifts it', () => {
    const suspension = act({
      kind: 'SUSPENSION',
      basis: 'SANCTION',
      effectiveFrom: SAME_DAY,
      decisionRef: 'CBJ/2026/90',
      recordedAt: new Date('2026-06-01T09:00:00.000Z'),
      id: 'a',
    });
    const reinstatement = act({
      kind: 'REINSTATEMENT',
      basis: 'SANCTION',
      effectiveFrom: SAME_DAY,
      decisionRef: 'CBJ/2026/91',
      recordedAt: new Date('2026-06-01T14:00:00.000Z'),
      id: 'b',
    });
    // BOTH INPUT ORDERS, which is the whole point: the answer must not depend on how the rows came
    // back. Passing only one order is how the original defect looked correct on one database.
    for (const acts of [
      [suspension, reinstatement],
      [reinstatement, suspension],
    ]) {
      const s = standing(term(), acts, d('2026-07-01'));
      expect(s.status).toBe('ACTIVE');
      expect(s.mayPractise).toBe(true);
    }
  });

  it('and a same-day SUSPENSION recorded after a reinstatement suspends — the order decides, not the kind', () => {
    // The mirror, so the test is not passing because REINSTATEMENT happens to win. An office
    // reinstated in the morning and suspended again that afternoon is suspended.
    const reinstatement = act({
      kind: 'REINSTATEMENT',
      basis: 'SANCTION',
      effectiveFrom: SAME_DAY,
      decisionRef: 'CBJ/2026/92',
      recordedAt: new Date('2026-06-01T09:00:00.000Z'),
      id: 'a',
    });
    const suspension = act({
      kind: 'SUSPENSION',
      basis: 'SANCTION',
      effectiveFrom: SAME_DAY,
      decisionRef: 'CBJ/2026/93',
      recordedAt: new Date('2026-06-01T14:00:00.000Z'),
      id: 'b',
    });
    for (const acts of [
      [reinstatement, suspension],
      [suspension, reinstatement],
    ]) {
      const s = standing(term(), acts, d('2026-07-01'));
      expect(s.status).toBe('SUSPENDED');
      expect(s.standingActDecisionRef).toBe('CBJ/2026/93');
    }
  });

  it('is TOTAL — two acts sharing a date AND an instant still fold deterministically, by id', () => {
    // Pathological, and the reason it is asserted rather than left: a comparator that can return 0
    // is a comparator whose answer depends on input order, which is exactly the property being
    // fixed. The id tie-break is arbitrary but it is STABLE.
    const instant = new Date('2026-06-01T09:00:00.000Z');
    const a = act({
      kind: 'SUSPENSION',
      basis: 'SANCTION',
      effectiveFrom: SAME_DAY,
      decisionRef: 'CBJ/A',
      recordedAt: instant,
      id: 'aaa',
    });
    const b = act({
      kind: 'REINSTATEMENT',
      basis: 'SANCTION',
      effectiveFrom: SAME_DAY,
      decisionRef: 'CBJ/B',
      recordedAt: instant,
      id: 'bbb',
    });
    const first = standing(term(), [a, b], d('2026-07-01'));
    const second = standing(term(), [b, a], d('2026-07-01'));
    expect(first).toEqual(second);
  });
});

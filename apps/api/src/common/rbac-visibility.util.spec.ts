import { describe, expect, it } from 'vitest';
import {
  ALL_OWNERS_READ_CODES,
  CLAIM_ALL_OWNERS_READ,
  CUSTOMER_ALL_OWNERS_READ,
  CUSTOMER_FILE_ALL_OWNERS_READ,
  ENDORSEMENT_ALL_OWNERS_READ,
  LEAD_ALL_OWNERS_READ,
  POLICY_ALL_OWNERS_READ,
  RECOMMENDATION_ALL_OWNERS_READ,
  canReadAllClaimOwners,
  canReadAllCustomerFileOwners,
  canReadAllCustomerOwners,
  canReadAllEndorsementOwners,
  canReadAllLeadOwners,
  canReadAllPolicyOwners,
  canReadAllRecommendationOwners,
  isCustomerVisibleTo,
  type VisibilityActor,
} from './rbac-visibility.util';

/*
 * WHO MAY SEE A RECORD THEY DO NOT OWN — seven predicates read by about twenty services, with no spec.
 *
 * Measured 2026-11-05: one of the four `*.util.ts` files in `apps/api/src` with no sibling spec. This
 * is the one of the four with the widest blast radius: every predicate here decides cross-owner
 * visibility for a whole family of records, and `isCustomerVisibleTo` is the single place the question
 * "may this actor see this customer's file?" is answered.
 *
 * ## The defect shape these assertions are aimed at
 *
 * Each predicate is a one-line `permissions.has(CODE)`, so the thing that can go wrong is not the
 * logic — it is a predicate reading the WRONG constant. Seven near-identical functions over seven
 * near-identical codes is precisely where a copy-paste points two families at one code, and that
 * fails OPEN: a holder of `lead.all-owners.read` would silently gain the whole customer book.
 *
 * So every test below gives the actor EXACTLY ONE code and asserts the other six predicates are
 * false. Granting one code and checking one predicate would pass on a file where all seven read the
 * same constant.
 *
 * ## Why the codes end in `.read`, asserted rather than described
 *
 * `permissions.spec.ts` asserts the External Auditor is read-only BY CONSTRUCTION — every code it
 * holds ends in `.read` or `.view`. The auditor holds cross-owner reach on customers, so a code named
 * `customer.view-all-owners` would have forced that check to be widened. The naming is therefore
 * load-bearing, and the last test here pins it.
 */

const actorWith = (...codes: string[]): VisibilityActor => ({
  id: 'actor-1',
  permissions: new Set(codes),
});

/** Every predicate paired with the ONE code it must read and nothing else. */
const PREDICATES = [
  ['lead', LEAD_ALL_OWNERS_READ, canReadAllLeadOwners],
  ['customer', CUSTOMER_ALL_OWNERS_READ, canReadAllCustomerOwners],
  [
    'customer file',
    CUSTOMER_FILE_ALL_OWNERS_READ,
    canReadAllCustomerFileOwners,
  ],
  ['policy', POLICY_ALL_OWNERS_READ, canReadAllPolicyOwners],
  ['claim', CLAIM_ALL_OWNERS_READ, canReadAllClaimOwners],
  ['endorsement', ENDORSEMENT_ALL_OWNERS_READ, canReadAllEndorsementOwners],
  [
    'recommendation',
    RECOMMENDATION_ALL_OWNERS_READ,
    canReadAllRecommendationOwners,
  ],
] as const;

describe('the cross-owner predicates', () => {
  it('cover every code in ALL_OWNERS_READ_CODES, and no more', () => {
    // The list is consumed by the seed spec and the permission grid. If a code is added there with no
    // predicate — or a predicate is added with no code in the list — one of the two readers is
    // working from a shorter set than the other, and nothing else would say so.
    expect(PREDICATES.map(([, code]) => code).sort()).toEqual(
      [...ALL_OWNERS_READ_CODES].sort(),
    );
  });

  it('are seven distinct codes, so no two families share one grant', () => {
    expect(new Set(ALL_OWNERS_READ_CODES).size).toBe(
      ALL_OWNERS_READ_CODES.length,
    );
    expect(ALL_OWNERS_READ_CODES).toHaveLength(7);
  });

  it.each(PREDICATES)(
    'the %s predicate reads its own code and NOT any of the other six',
    (_label, code, predicate) => {
      const actor = actorWith(code);
      expect(predicate(actor)).toBe(true);

      for (const [otherLabel, otherCode, otherPredicate] of PREDICATES) {
        if (otherCode === code) continue;
        expect(
          otherPredicate(actor),
          `holding ${code} must not satisfy the ${otherLabel} predicate`,
        ).toBe(false);
      }
    },
  );

  it.each(PREDICATES)(
    'the %s predicate is false for an actor holding nothing',
    (_label, _code, predicate) => {
      expect(predicate(actorWith())).toBe(false);
    },
  );

  /*
   * EVERY CODE IS A READ CODE, which is what keeps `permissions.spec.ts`' auditor check narrow. A
   * future `*.all-owners.write` added to this list would widen a check whose only job is to catch a
   * write permission leaking to an External Auditor.
   */
  it('names every code so it reads as read-only', () => {
    for (const code of ALL_OWNERS_READ_CODES) {
      expect(code.endsWith('.read'), `${code} must end in .read`).toBe(true);
      expect(code).toContain('.all-owners.');
    }
  });
});

describe('isCustomerVisibleTo', () => {
  it('shows an owner their own customer with no permission at all', () => {
    expect(isCustomerVisibleTo({ ownerUserId: 'actor-1' }, actorWith())).toBe(
      true,
    );
  });

  it('shows somebody else’s customer to a holder of customer.all-owners.read', () => {
    expect(
      isCustomerVisibleTo(
        { ownerUserId: 'someone-else' },
        actorWith(CUSTOMER_ALL_OWNERS_READ),
      ),
    ).toBe(true);
  });

  it('hides somebody else’s customer from an actor without that code', () => {
    expect(
      isCustomerVisibleTo({ ownerUserId: 'someone-else' }, actorWith()),
    ).toBe(false);
  });

  /*
   * THE CODE IT READS IS THE CUSTOMER ONE, not the customer-FILE one. Those are two different grants
   * over two different things — the customer record, and the customer's commercial file (risk
   * profile, needs assessment, programme, opportunity, RFQ, quotation, comparison, client decision) —
   * and the Placement/Technical Officer holds the second without the first. Reading the wrong one
   * here would hand the whole customer book to a role that is meant to see only the commercial file.
   */
  it('is NOT satisfied by the customer-FILE grant, which is a different thing', () => {
    expect(
      isCustomerVisibleTo(
        { ownerUserId: 'someone-else' },
        actorWith(CUSTOMER_FILE_ALL_OWNERS_READ),
      ),
    ).toBe(false);
  });

  it('compares the owner by id, so a same-named actor is not the owner', () => {
    expect(isCustomerVisibleTo({ ownerUserId: 'actor-10' }, actorWith())).toBe(
      false,
    );
  });
});

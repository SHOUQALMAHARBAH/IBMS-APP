import { describe, expect, it } from 'vitest';
import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  assertDiscardable,
  assertDiscardWon,
  discardView,
} from './discard.util';
import {
  DISCARDABLE_ENTITIES,
  DISCARD_REASON_MIN_LENGTH,
  type DiscardableRow,
} from './discard.config';

/*
 * `assertDiscardable` IS THE ONE PLACE A DISCARD IS DECIDED, and it had no spec.
 *
 * ## Why this file exists
 *
 * Measured 2026-11-05: of 24 `*.util.ts` / `*.helper.ts` files in `apps/api/src`, exactly four had no
 * sibling spec, and this was one. That matters more here than the count suggests — four services call
 * this function before writing the three discard columns, so every rule it enforces is enforced for
 * all four by this file alone. Nothing asserted any of them.
 *
 * ## What is deliberately NOT asserted
 *
 * The WRITE. This function does not write, by design: each repository performs a status-conditional
 * `updateMany` re-asserting `discardedAt: null`, so a second discard arriving between this check and
 * that write loses the race explicitly (`race-safe-invariants.md`). Asserting the write here would
 * pin the wrong layer.
 *
 * The PERMISSION, for the reason the function's own comment gives: it is
 * `@RequirePermissions(entity.permission)` on the route, and re-deriving it in the service would mean
 * four services injecting PermissionsService to re-answer what the guard already answered.
 *
 * The DATABASE CHECK constraints, which are the backstop for a caller that skips this function
 * entirely. Those belong to a migration and to an e2e that writes two rows.
 */

const PLACED: DiscardableRow = {
  status: 'PLACEMENT_CONFIRMED',
  discardedAt: null,
  sentToClientAt: null,
};

const GOOD_REASON = 'raised against the wrong customer file entirely';

describe('assertDiscardable', () => {
  it('accepts a discardable row with a reason of real length', () => {
    expect(() =>
      assertDiscardable('Policy', 'pol-1', PLACED, GOOD_REASON),
    ).not.toThrow();
  });

  /*
   * A PROGRAMMING ERROR, AND LOUD ON PURPOSE.
   *
   * An unregistered entity has no commitment rule, so letting it through would permit a COMMITTED
   * record to be discarded — the one thing the feature's third rule forbids. A plain `Error` rather
   * than an HTTP exception because no client can cause this: it means somebody wired a discard
   * without registering the entity.
   */
  it('refuses an entity that is not registered, with a plain Error naming the config file', () => {
    expect(() =>
      assertDiscardable('Customer', 'cus-1', PLACED, GOOD_REASON),
    ).toThrowError(/not registered as discardable in discard\.config\.ts/);
  });

  it('refuses a second discard with 409, because a discard is terminal', () => {
    const already = { ...PLACED, discardedAt: new Date('2026-01-01') };
    expect(() =>
      assertDiscardable('Policy', 'pol-1', already, GOOD_REASON),
    ).toThrow(ConflictException);
  });

  /*
   * THE REASON IS CHECKED AFTER TRIMMING, which is the half a length check usually gets wrong: a
   * field of spaces satisfies `length >= 10` and says nothing. The reason is the only part of a
   * discard nobody can reconstruct later — who and when are recoverable from an audit row.
   */
  it('refuses a reason that is too short, counting TRIMMED length', () => {
    expect(() => assertDiscardable('Policy', 'pol-1', PLACED, 'typo')).toThrow(
      UnprocessableEntityException,
    );
    const spaces = ' '.repeat(DISCARD_REASON_MIN_LENGTH + 5);
    expect(() => assertDiscardable('Policy', 'pol-1', PLACED, spaces)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('accepts a reason that reaches the floor exactly', () => {
    const exact = 'x'.repeat(DISCARD_REASON_MIN_LENGTH);
    expect(exact).toHaveLength(DISCARD_REASON_MIN_LENGTH);
    expect(() =>
      assertDiscardable('Policy', 'pol-1', PLACED, exact),
    ).not.toThrow();
  });

  /*
   * EVERY REGISTERED ENTITY, DERIVED FROM THE CONFIG rather than listed here — and ONE COMMITTED ROW
   * PER ENTITY, which is the correction this test needed.
   *
   * The first version fed all four the same row and the non-vacuity assertion below killed it:
   * `Endorsement`'s rule is a NEGATIVE (`status !== 'APPLIED' && status !== 'CLIENT_NOTIFIED'`), so an
   * arbitrary status is DISCARDABLE for it while being committed for the other three. There is no
   * single row that is committed for all four — which is exactly what `discard.config.ts` says in
   * prose: "the commitment point is a business fact and differs". A shared fixture was me treating it
   * as a shared "is it early" idea, the thing that comment refuses.
   *
   * Each row is the entity's own point of no return: a policy ISSUED, a claim REGISTERED, an
   * endorsement APPLIED, a recommendation SENT.
   */
  const COMMITTED_ROW: Record<string, DiscardableRow> = {
    Policy: { status: 'ISSUED', discardedAt: null },
    Claim: { status: 'REGISTERED', discardedAt: null },
    Endorsement: { status: 'APPLIED', discardedAt: null },
    Recommendation: {
      sentToClientAt: new Date('2026-01-01'),
      discardedAt: null,
    },
  };

  it('has a committed fixture for every registered entity', () => {
    // A fifth discardable entity must fail HERE rather than be silently skipped by `it.each` below,
    // which would leave it unasserted while the file still reads as complete.
    expect(Object.keys(COMMITTED_ROW).sort()).toEqual(
      DISCARDABLE_ENTITIES.map((e) => e.entityType).sort(),
    );
  });

  it.each(DISCARDABLE_ENTITIES.map((e) => [e.entityType, e] as const))(
    'refuses a committed %s with its own recorded refusal sentence',
    (entityType, entity) => {
      const committed = COMMITTED_ROW[entityType];

      // Non-vacuity: if the fixture were accidentally discardable this test would assert nothing.
      // This is the assertion that caught the shared-fixture version above.
      expect(entity.discardableWhen(committed)).toBe(false);

      expect(() =>
        assertDiscardable(entityType, 'id-1', committed, GOOD_REASON),
      ).toThrowError(entity.committedRefusal);
    },
  );

  /*
   * AND THE OTHER DIRECTION, which is what makes the four rows above mean something: each entity's
   * PRE-commitment row is accepted. Without this the four refusals would also pass against a
   * `discardableWhen` that returned false for everything — i.e. a discard nobody can ever perform.
   */
  const DISCARDABLE_ROW: Record<string, DiscardableRow> = {
    Policy: { status: 'PLACEMENT_CONFIRMED', discardedAt: null },
    Claim: { status: 'NOTIFIED', discardedAt: null },
    Endorsement: { status: 'SUBMITTED_TO_INSURER', discardedAt: null },
    Recommendation: { sentToClientAt: null, discardedAt: null },
  };

  it.each(DISCARDABLE_ENTITIES.map((e) => [e.entityType] as const))(
    'accepts an uncommitted %s',
    (entityType) => {
      const row = DISCARDABLE_ROW[entityType];
      expect(() =>
        assertDiscardable(entityType, 'id-1', row, GOOD_REASON),
      ).not.toThrow();
    },
  );

  /*
   * THE TRAP THE WHOLE FEATURE EXISTS FOR, pinned by name. `SUBMITTED_TO_INSURER` is DELIBERATELY
   * still discardable: the insurer has been told, which a discard cannot retract, so whoever discards
   * it has to tell them and the mandatory reason is where that is recorded. Refusing instead would
   * leave the only exit being to APPLY an endorsement nobody wants. Anybody "tightening" this rule
   * should have to delete this test first.
   */
  it('keeps an endorsement already submitted to the insurer discardable, on purpose', () => {
    expect(() =>
      assertDiscardable(
        'Endorsement',
        'end-1',
        { status: 'SUBMITTED_TO_INSURER', discardedAt: null },
        GOOD_REASON,
      ),
    ).not.toThrow();
  });

  /*
   * ORDER MATTERS, and this pins it. An already-discarded record is refused with 409 BEFORE the
   * reason is validated, so somebody racing a second discard is told the truth ("somebody already
   * did this") rather than being sent to fix a reason that would change nothing.
   */
  it('reports the terminal state before complaining about the reason', () => {
    const already = { ...PLACED, discardedAt: new Date('2026-01-01') };
    expect(() => assertDiscardable('Policy', 'pol-1', already, 'no')).toThrow(
      ConflictException,
    );
  });
});

describe('assertDiscardWon', () => {
  it('is silent when the conditional write won the race', () => {
    expect(() => assertDiscardWon('Policy', 'pol-1', true)).not.toThrow();
  });

  /*
   * A 409 RATHER THAN A SILENT SUCCESS, and that is the whole point of the function. The reason on
   * the record is the FIRST person's. Telling the second caller "done" would leave them believing
   * their sentence is what anybody reading the record later will see.
   */
  it('reports 409 when somebody else discarded it mid-flight', () => {
    expect(() => assertDiscardWon('Policy', 'pol-1', false)).toThrow(
      ConflictException,
    );
    expect(() => assertDiscardWon('Policy', 'pol-1', false)).toThrowError(
      /discarded by somebody else/,
    );
  });
});

describe('discardView', () => {
  it('is null on a record that is not discarded', () => {
    expect(
      discardView({
        discardedAt: null,
        discardedByUserId: null,
        discardedReason: null,
      }),
    ).toBeNull();
  });

  it('nests all three columns, so `discard === null` is the whole question', () => {
    const at = new Date('2026-03-04T00:00:00.000Z');
    expect(
      discardView({
        discardedAt: at,
        discardedByUserId: 'user-7',
        discardedReason: GOOD_REASON,
      }),
    ).toEqual({ at, byUserId: 'user-7', reason: GOOD_REASON });
  });

  /*
   * A PARTIAL ROW THROWS, and the direction is deliberate.
   *
   * It is impossible while the per-table all-or-nothing CHECK constraint exists, so reaching this
   * branch means that constraint has been dropped. The alternative — returning a view with a missing
   * actor, or returning null — would report a DISCARDED record as live, which is the one direction
   * that must not be silent.
   */
  it('throws when the actor is missing, because that means the CHECK constraint is gone', () => {
    expect(() =>
      discardView({
        discardedAt: new Date('2026-03-04'),
        discardedByUserId: null,
        discardedReason: GOOD_REASON,
      }),
    ).toThrowError(/all-or-nothing CHECK constraint/);
  });

  it('throws when the reason is missing, for the same reason', () => {
    expect(() =>
      discardView({
        discardedAt: new Date('2026-03-04'),
        discardedByUserId: 'user-7',
        discardedReason: null,
      }),
    ).toThrowError(/all-or-nothing CHECK constraint/);
  });
});

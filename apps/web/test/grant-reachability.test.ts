import { describe, expect, it } from 'vitest';
import {
  codesWithANavRoute,
  grantsWithNoNavRoute,
} from '../lib/admin/grant-reachability';
import { PERMISSION_CATALOGUE } from '../e2e/fixtures/role-permissions';

/**
 * MODULE 0 ITEM (i) — the grant-reachability warning.
 *
 * What these tests hold is the property the WARNING depends on: the reachable set is derived from
 * the navigation map, so it cannot be stale, and it is neither empty nor everything.
 *
 * Both of those failure modes are real and both are silent:
 *
 *   - an EMPTY set makes the screen warn about every grant an administrator ticks, which teaches
 *     them to ignore the warning within a day;
 *   - the set containing EVERY code makes it warn about none, which is the same as not shipping it.
 */

describe('item (i): the set of codes with a nav route', () => {
  it('is neither empty nor everything', () => {
    const reachable = codesWithANavRoute();
    // A floor rather than a pin. `scripts/measurements/permission-reachability.py` reports the exact
    // figures and is the thing to re-run; pinning them here would recreate the defect item (i) was
    // asked to fix — that script carried a hand-written `491` against a real `502` and stopped
    // running at all.
    expect(
      reachable.size,
      'no permission code gates any navigation destination — the destinations map or this derivation has drifted, and the warning would now fire on every grant.',
    ).toBeGreaterThan(50);
    expect(
      reachable.size,
      'every permission code gates a navigation destination, which cannot be true: several are read only by a control on a screen reached another way. The derivation is matching too much and the warning would never fire.',
    ).toBeLessThan(PERMISSION_CATALOGUE.length);
  });

  it('every code it names is a real permission', () => {
    // A code in the nav map that the catalogue does not have is a gate nobody can satisfy — the
    // § 1.62 shape — and it would also make this warning silently correct about an unreachable
    // screen rather than about a grant.
    const codes = new Set(PERMISSION_CATALOGUE.map((p) => p.code));
    const unknown = [...codesWithANavRoute()].filter((c) => !codes.has(c));
    expect(
      unknown,
      'a navigation destination is gated on a permission code that is not in the catalogue. Nobody can hold it, so the destination is unreachable by anyone.',
    ).toEqual([]);
  });
});

describe('item (i): which grants open no screen', () => {
  it('flags a code with no nav route and leaves a reachable one alone', () => {
    const reachable = [...codesWithANavRoute()];
    expect(reachable.length).toBeGreaterThan(0);
    const navigable = reachable[0];

    // Measured, not invented: `permission-reachability.py` reports these among the ten (role, code)
    // pairs in the seeded grid that open no navigation destination.
    const noRoute = ['refund.disburse', 'receipt.record'];
    for (const code of noRoute) {
      expect(
        grantsWithNoNavRoute([code]),
        `${code} is reported by permission-reachability.py as opening no nav destination, so the warning must flag it. If a screen now exists for it, re-run that measurement and change this list rather than the derivation.`,
      ).toEqual([code]);
    }

    expect(grantsWithNoNavRoute([navigable])).toEqual([]);
  });

  it('preserves input order, so the screen lists them as they were ticked', () => {
    const reachable = [...codesWithANavRoute()][0];
    expect(
      grantsWithNoNavRoute(['refund.disburse', reachable, 'receipt.record']),
    ).toEqual(['refund.disburse', 'receipt.record']);
  });

  it('an empty grant set warns about nothing', () => {
    // The ordinary case for a role being created before any box is ticked. A warning on an empty
    // form would be the first thing an administrator sees and the first thing they learn to ignore.
    expect(grantsWithNoNavRoute([])).toEqual([]);
  });
});

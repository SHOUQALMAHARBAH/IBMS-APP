import { describe, expect, it } from 'vitest';
import { PolicyStatus } from '@ibms/db';
import {
  CLOSED_POLICY_STATUSES,
  IN_FORCE_POLICY_STATUSES,
  OPEN_OBLIGATION_POLICY_STATUSES,
} from './policy.repository';

/**
 * The three policy-status sets partition `PolicyStatus` exactly.
 *
 * This is the test that makes the split survive. A future `PolicyStatus` value — a
 * `SUSPENDED`, a `LAPSED`, a `RUN_OFF` — would otherwise land in none of the three sets
 * and silently vanish from both halves of the insurer-deactivation impact count: not in
 * force, not awaiting an action, not closed, and therefore invisible in the record an
 * administrator relies on. Nothing would fail; the number would just be wrong.
 *
 * So the enum is read from the generated client rather than restated here, and the sets
 * must cover it with no overlap and no gap. Adding a status now breaks this test until
 * somebody decides which of the three it belongs to, which is exactly the decision that
 * should not be skippable.
 */

const ALL_STATUSES = Object.values(PolicyStatus);

describe('the policy-status sets partition PolicyStatus', () => {
  it('covers every status the enum defines', () => {
    const classified = new Set<string>([
      ...IN_FORCE_POLICY_STATUSES,
      ...OPEN_OBLIGATION_POLICY_STATUSES,
      ...CLOSED_POLICY_STATUSES,
    ]);
    const unclassified = ALL_STATUSES.filter((s) => !classified.has(s));
    expect(
      unclassified,
      'a PolicyStatus in none of the three sets disappears from the deactivation impact count',
    ).toEqual([]);
  });

  it('never puts one status in two sets', () => {
    const all = [
      ...IN_FORCE_POLICY_STATUSES,
      ...OPEN_OBLIGATION_POLICY_STATUSES,
      ...CLOSED_POLICY_STATUSES,
    ];
    const duplicated = all.filter((s, i) => all.indexOf(s) !== i);
    expect(
      duplicated,
      'a status in two sets would be counted twice by the impact figures',
    ).toEqual([]);
    expect(all).toHaveLength(ALL_STATUSES.length);
  });

  it('keeps in-force NARROW and open-obligation separate, which is the whole point', () => {
    // Pinned as values, not just as a partition: the cross-sell gap scan depends on
    // "in force" meaning `ACTIVE` alone, and widening it to serve the deactivation count
    // is precisely the change this split exists to prevent.
    expect([...IN_FORCE_POLICY_STATUSES]).toEqual(['ACTIVE']);
    // And the six the insurer still owes an action on — the set an administrator
    // deciding to stop dealing with a company needs most.
    expect([...OPEN_OBLIGATION_POLICY_STATUSES]).toEqual([
      'PLACEMENT_CONFIRMED',
      'ISSUED',
      'CHECKING_IN_PROGRESS',
      'DISCREPANCY',
      'VERIFIED',
      'DELIVERED',
    ]);
    expect([...CLOSED_POLICY_STATUSES]).toEqual(['CANCELLED', 'EXPIRED']);
  });

  it('agrees with the enum on its size, so the counts above are not stale', () => {
    // The count is asserted rather than described: "all nine statuses" in a comment goes
    // stale the day a tenth arrives, and nothing notices.
    expect(ALL_STATUSES).toHaveLength(9);
  });
});

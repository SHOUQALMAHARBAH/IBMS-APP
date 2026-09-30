import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { assertDifferentActors } from './maker-checker.util';

// One row per pair documented in the assertDifferentActors JSDoc table
// (Part 5.2). Table-driven so every entity's maker/checker pair is
// independently verified against the shared helper, even though most of
// these entities have no service layer yet to call it from.
const coveredPairs = [
  'KYCRecord.approve',
  'PolicyChecking.check',
  'Refund.approve',
  'DisposalBatch.dpoApprove',
  'DataSharingApproval.approve',
  'DataProcessingAgreement.dpoApprove',
  'Settlement.secondApprove',
  'CommissionLedgerEntry.approveOverride',
  'Recommendation.approve',
  'AccessRecertificationItem.decide',
];

describe('assertDifferentActors', () => {
  it.each(coveredPairs)('%s: throws when checker == maker', (context) => {
    expect(() => assertDifferentActors('user-1', 'user-1', context)).toThrow(
      ForbiddenException,
    );
  });

  it.each(coveredPairs)('%s: allows a different checker', (context) => {
    expect(() =>
      assertDifferentActors('user-1', 'user-2', context),
    ).not.toThrow();
  });

  it('allows a null checker (not yet decided)', () => {
    expect(() =>
      assertDifferentActors('user-1', null, 'Refund.approve'),
    ).not.toThrow();
  });

  it('allows an undefined checker (not yet decided)', () => {
    expect(() =>
      assertDifferentActors('user-1', undefined, 'Refund.approve'),
    ).not.toThrow();
  });

  it('includes the call-site context in the error message', () => {
    expect(() =>
      assertDifferentActors('user-1', 'user-1', 'Refund.approve'),
    ).toThrow(/Refund\.approve/);
  });

  it('names the REMEDY when the caller names the pair, and stays a refusal when it does not', () => {
    // Part 5's second honesty fix. The old message stated the rule and stopped — true, and useless to
    // whoever is holding it, because it does not say what to ask an administrator for.
    try {
      assertDifferentActors(
        'user-1',
        'user-1',
        'Refund.approve',
        'Refund_maker_checker_distinct',
      );
      throw new Error('expected a refusal');
    } catch (err) {
      const message = (err as Error).message;
      // The permission a SECOND person needs, and where to look for who holds it.
      expect(message).toContain('refund.approve');
      expect(message).toContain('Roles & permissions');
    }

    // Without the pair it is still a correct refusal, just without the remedy — which is why the parameter
    // is optional rather than required across 19 call sites at once.
    try {
      assertDifferentActors('user-1', 'user-1', 'SomethingUnmapped.approve');
      throw new Error('expected a refusal');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('SomethingUnmapped.approve');
      expect(message).not.toContain('A second person holding');
    }
  });
});

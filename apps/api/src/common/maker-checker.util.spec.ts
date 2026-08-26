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
});

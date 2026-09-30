import { describe, expect, it } from 'vitest';
import {
  refundIsPayable,
  type Endorsement,
} from '../lib/endorsement/endorsement-api';

/*
 * WHETHER MONEY CAN LEAVE THE OFFICE, as a condition that can be observed.
 *
 * `POST /refunds/:id/disburse` had NO web caller — IMPROVEMENTS § 1.44 — so an approved refund could not be
 * paid from the application at all. It is the first of the 33 unreachable routes to close because it is the
 * one with a balance attached.
 *
 * The button's condition is tested here rather than through the screen for a specific reason: three
 * independent facts have to agree, and the below-threshold branch is the one a reasonable person gets wrong.
 * A refund under the approval threshold is auto-cleared with `approvedByUserId` left NULL, so a condition
 * that simply checked for an approver would make every small refund permanently unpayable — and no fixture
 * in the endorsement e2e exercises a refund at all, so nothing would have caught it.
 */
type Refund = NonNullable<Endorsement['refund']>;

function refund(over: Partial<Refund> = {}): Refund {
  return {
    id: 'refund-1',
    combinedDutyAct: null,
    amount: '250.000',
    reason: 'Pro-rata return on cancellation',
    raisedByUserId: 'placement-1',
    approvedByUserId: 'finance-1',
    approvalThresholdMatrixLevel: 'manager',
    paidAt: null,
    needsApproval: true,
    ...over,
  };
}

describe('refundIsPayable', () => {
  it('pays an approved, unpaid refund', () => {
    expect(refundIsPayable(refund())).toBe(true);
  });

  it('is false when there is no refund at all', () => {
    // A positive endorsement produces none, and the APPLIED state is shared by both kinds.
    expect(refundIsPayable(null)).toBe(false);
  });

  it('is false once it has been paid', () => {
    // The service refuses a second disbursement with a 409 regardless — `paidAt` is a status-conditional
    // write, not a screen concern. This keeps the button from reappearing, which is a courtesy on top.
    expect(
      refundIsPayable(refund({ paidAt: '2026-11-20T00:00:00.000Z' })),
    ).toBe(false);
  });

  it('is false while an at-threshold refund is still awaiting its approver', () => {
    expect(
      refundIsPayable(refund({ approvedByUserId: null, needsApproval: true })),
    ).toBe(false);
  });

  it('PAYS a below-threshold refund that was auto-cleared with no approver', () => {
    // THE CASE A REASONABLE CONDITION GETS WRONG. Below the value threshold the refund is cleared
    // automatically: `approvedByUserId` stays NULL and `needsApproval` is false. Testing only for an
    // approver would make every small refund permanently unpayable, and nothing else would have noticed.
    expect(
      refundIsPayable(
        refund({
          approvedByUserId: null,
          needsApproval: false,
          approvalThresholdMatrixLevel: 'below_threshold_auto',
        }),
      ),
    ).toBe(true);
  });

  it('does not pay a below-threshold refund that was already paid', () => {
    // Both exemptions at once, so neither can mask the other.
    expect(
      refundIsPayable(
        refund({
          approvedByUserId: null,
          needsApproval: false,
          paidAt: '2026-11-20T00:00:00.000Z',
        }),
      ),
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import {
  CANCELLATION_BASES,
  CANCELLATION_CHANGE_TYPE,
  ENDORSEMENT_CHANGE_TYPES,
  REFUND_APPROVAL_THRESHOLD_JOD,
  SHORT_PERIOD_CLIENT_RETURN_PERCENT,
  cancellationAuditSnapshot,
  cancellationReturnPremium,
  commissionReversalAmount,
  commissionReversalAuditSnapshot,
  endorsementAuditSnapshot,
  premiumInForce,
  refundAuditSnapshot,
  refundNeedsApproval,
  signedPremiumAdjustment,
} from './endorsement.config';

const DAY = 86_400_000;
const inception = new Date('2026-01-01T00:00:00.000Z');
const expiry = new Date(inception.getTime() + 360 * DAY);

describe('endorsement.config', () => {
  it('keeps `cancellation` out of the ordinary endorsement change types', () => {
    expect([...ENDORSEMENT_CHANGE_TYPES]).not.toContain(
      CANCELLATION_CHANGE_TYPE,
    );
    expect([...CANCELLATION_BASES]).toEqual(['short_period', 'pro_rata']);
  });

  describe('signedPremiumAdjustment', () => {
    it('quantizes a POSITIVE amount to fils, sign unchanged', () => {
      expect(signedPremiumAdjustment('POSITIVE', '250.5').toFixed(3)).toBe(
        '250.500',
      );
    });

    it('negates a NEGATIVE (return-premium) amount', () => {
      expect(signedPremiumAdjustment('NEGATIVE', '250.5').toFixed(3)).toBe(
        '-250.500',
      );
    });
  });

  describe('premiumInForce — the premium a cancellation must be computed from', () => {
    /*
     * ADDED 2026-11-06 (module 0-c batch 6). `Policy.issuedPremium` is written ONCE, by
     * `recordIssuance`, and never again — an endorsement records its money as a signed
     * `premiumAdjustment` on its own row. So the premium a policy is covered for today is
     * `issuedPremium + the adjustments that were APPLIED`, and the cancellation refund was being
     * computed from the issuance figure alone.
     */
    it('adds an APPLIED positive adjustment, so the client is refunded on what they were charged', () => {
      expect(
        premiumInForce({
          issuedPremium: '1000.000',
          appliedAdjustments: '500.000',
        }).toString(),
      ).toBe('1500');
    });

    it('subtracts a negative adjustment, because the stored value is ALREADY signed', () => {
      // `signedPremiumAdjustment('NEGATIVE', x)` stores `0 - x`, so the sum must not re-sign it.
      // Re-signing here would turn a premium reduction into an increase — the same figure wrong in
      // the opposite direction, which is the failure mode a plain sum avoids.
      expect(
        premiumInForce({
          issuedPremium: '1000.000',
          appliedAdjustments: signedPremiumAdjustment(
            'NEGATIVE',
            '250.000',
          ).toString(),
        }).toString(),
      ).toBe('750');
    });

    it('is the issued premium unchanged when nothing has been applied', () => {
      expect(
        premiumInForce({
          issuedPremium: '1200.000',
          appliedAdjustments: '0',
        }).toString(),
      ).toBe('1200');
    });

    it('stays fils-exact rather than drifting through a float', () => {
      // 0.1 + 0.2 is the canonical float trap; through Decimal it is exact, and the quantize is to
      // three places because JOD's minor unit is the fils.
      expect(
        premiumInForce({
          issuedPremium: '0.100',
          appliedAdjustments: '0.200',
        }).toString(),
      ).toBe('0.3');
      expect(
        premiumInForce({
          issuedPremium: '1000.0005',
          appliedAdjustments: '0',
        }).toString(),
      ).toBe('1000.001');
    });

    it('does NOT clamp a negative result, so an impossible policy cannot look plausible', () => {
      // The caller refuses on a non-positive premium in force and names the policy. Clamping to
      // zero here would hand it a computable figure for a state that should not exist.
      expect(
        premiumInForce({
          issuedPremium: '100.000',
          appliedAdjustments: signedPremiumAdjustment(
            'NEGATIVE',
            '150.000',
          ).toString(),
        }).toString(),
      ).toBe('-50');
    });
  });

  describe('cancellationReturnPremium — composed with the premium in force', () => {
    it('refunds the ENDORSED premium, not the issued one: the figure row 70 was getting wrong', () => {
      // A policy issued at 1,200 that took an applied +600 endorsement, cancelled at the halfway
      // mark. Pro-rata on the issuance figure gives 600; on the premium actually in force it is
      // 900. The 300 difference is exactly the unexpired share of the adjustment, and it is money
      // owed to the client.
      const issued = '1200.000';
      const applied = '600.000';
      const cancelAt = new Date(inception.getTime() + 180 * DAY);

      const onIssuanceFigure = cancellationReturnPremium({
        issuedPremium: issued,
        inceptionDate: inception,
        expiryDate: expiry,
        cancellationDate: cancelAt,
        basis: 'pro_rata',
      });
      const onPremiumInForce = cancellationReturnPremium({
        issuedPremium: premiumInForce({
          issuedPremium: issued,
          appliedAdjustments: applied,
        }),
        inceptionDate: inception,
        expiryDate: expiry,
        cancellationDate: cancelAt,
        basis: 'pro_rata',
      });

      expect(onIssuanceFigure.returnPremium.toString()).toBe('600');
      expect(onPremiumInForce.returnPremium.toString()).toBe('900');
      // Stated as the difference too, so the test says what the defect COST rather than only that
      // two numbers differ.
      expect(
        onPremiumInForce.returnPremium
          .minus(onIssuanceFigure.returnPremium)
          .toString(),
      ).toBe('300');
    });
  });

  describe('cancellationReturnPremium', () => {
    it('pro_rata = issuedPremium × unexpiredDays / totalDays', () => {
      const { returnPremium, unexpiredDays, totalDays } =
        cancellationReturnPremium({
          issuedPremium: '1200.000',
          inceptionDate: inception,
          expiryDate: expiry,
          cancellationDate: new Date(inception.getTime() + 180 * DAY),
          basis: 'pro_rata',
        });
      expect(totalDays).toBe(360);
      expect(unexpiredDays).toBe(180);
      expect(returnPremium.toFixed(3)).toBe('600.000');
    });

    it('short_period = SHORT_PERIOD_CLIENT_RETURN_PERCENT% of the pro-rata figure', () => {
      const { returnPremium } = cancellationReturnPremium({
        issuedPremium: '1200.000',
        inceptionDate: inception,
        expiryDate: expiry,
        cancellationDate: new Date(inception.getTime() + 180 * DAY),
        basis: 'short_period',
      });
      // 600.000 pro-rata × 90% retained
      expect(returnPremium.toFixed(3)).toBe('540.000');
      expect(SHORT_PERIOD_CLIENT_RETURN_PERCENT).toBe('90');
    });

    it('clamps a cancellation date before inception to inception (full return)', () => {
      const { returnPremium, unexpiredDays } = cancellationReturnPremium({
        issuedPremium: '1200.000',
        inceptionDate: inception,
        expiryDate: expiry,
        cancellationDate: new Date(inception.getTime() - 30 * DAY),
        basis: 'pro_rata',
      });
      expect(unexpiredDays).toBe(360);
      expect(returnPremium.toFixed(3)).toBe('1200.000');
    });

    it('422s when the policy period is zero', () => {
      expect(() =>
        cancellationReturnPremium({
          issuedPremium: '1200.000',
          inceptionDate: inception,
          expiryDate: inception,
          cancellationDate: inception,
          basis: 'pro_rata',
        }),
      ).toThrow();
    });

    it('422s when the policy period is inverted (expiry before inception)', () => {
      expect(() =>
        cancellationReturnPremium({
          issuedPremium: '1200.000',
          inceptionDate: expiry,
          expiryDate: inception,
          cancellationDate: inception,
          basis: 'pro_rata',
        }),
      ).toThrow();
    });
  });

  describe('commissionReversalAmount', () => {
    it('is |return premium| × commission rate %, quantized to fils', () => {
      expect(commissionReversalAmount('600.000', '12.5').toFixed(3)).toBe(
        '75.000',
      );
    });

    it('accepts a Prisma.Decimal rate', () => {
      expect(
        commissionReversalAmount('600.000', new Prisma.Decimal('10')).toFixed(
          3,
        ),
      ).toBe('60.000');
    });
  });

  describe('refundNeedsApproval', () => {
    it('is true AT the threshold and above', () => {
      expect(refundNeedsApproval(REFUND_APPROVAL_THRESHOLD_JOD)).toBe(true);
      expect(refundNeedsApproval('5000.001')).toBe(true);
    });

    it('is false below the threshold', () => {
      expect(refundNeedsApproval('4999.999')).toBe(false);
    });
  });

  describe('audit snapshots', () => {
    it('endorsementAuditSnapshot carries money as a fixed string, no free text', () => {
      const snap = endorsementAuditSnapshot({
        id: 'end-1',
        policyId: 'pol-1',
        type: 'NEGATIVE',
        changeType: 'cancellation',
        status: 'REQUESTED',
        premiumAdjustment: new Prisma.Decimal('-600'),
        requestedByUserId: 'u-1',
      });
      expect(snap).toEqual({
        endorsementId: 'end-1',
        policyId: 'pol-1',
        type: 'NEGATIVE',
        changeType: 'cancellation',
        status: 'REQUESTED',
        premiumAdjustment: '-600.000',
        requestedByUserId: 'u-1',
      });
    });

    it('cancellationAuditSnapshot never carries the reason text', () => {
      const snap = cancellationAuditSnapshot({
        endorsementId: 'end-1',
        basis: 'pro_rata',
        returnPremium: new Prisma.Decimal('600'),
      });
      expect(snap).toEqual({
        endorsementId: 'end-1',
        basis: 'pro_rata',
        returnPremium: '600.000',
        hasReason: true,
      });
      expect(JSON.stringify(snap)).not.toContain('reason":"');
    });

    it('refundAuditSnapshot carries the maker / checker ids + money string', () => {
      const snap = refundAuditSnapshot({
        id: 'ref-1',
        endorsementId: 'end-1',
        amount: new Prisma.Decimal('600'),
        reason: 'cancellation',
        raisedByUserId: 'maker-1',
        approvedByUserId: 'checker-1',
        approvalThresholdMatrixLevel: 'approved',
      });
      expect(snap).toMatchObject({
        refundId: 'ref-1',
        endorsementId: 'end-1',
        amount: '600.000',
        raisedByUserId: 'maker-1',
        approvedByUserId: 'checker-1',
        approvalThresholdMatrixLevel: 'approved',
      });
    });

    it('commissionReversalAuditSnapshot is metadata + money only', () => {
      const snap = commissionReversalAuditSnapshot({
        id: 'cr-1',
        endorsementId: 'end-1',
        amount: new Prisma.Decimal('75'),
      });
      expect(snap).toEqual({
        commissionReversalId: 'cr-1',
        endorsementId: 'end-1',
        amount: '75.000',
      });
    });
  });
});

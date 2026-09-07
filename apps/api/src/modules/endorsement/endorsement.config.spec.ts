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

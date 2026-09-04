import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import {
  AML_FREQUENT_CANCELLATION_THRESHOLD_COUNT,
  AML_LARGE_PREMIUM_THRESHOLD_JOD,
  buildFrequentCancellationDetail,
  buildFrequentRefundDetail,
  countRecentByCustomer,
  deriveTransactionMonitoringAlertView,
  detectReceiptPatterns,
  isFrequentPattern,
  isLargePremiumPayment,
  isTerminalTransactionMonitoringStatus,
  isThirdPartyPaymentSource,
  isTransactionMonitoringPatternType,
  transactionMonitoringAlertAuditSnapshot,
  type TransactionMonitoringAlertRow,
} from './transaction-monitoring.config';

describe('isTransactionMonitoringPatternType / isTerminalTransactionMonitoringStatus', () => {
  it('accepts the five documented pattern types, rejects anything else', () => {
    for (const p of [
      'large_premium_payment',
      'frequent_cancellations',
      'frequent_refunds',
      'third_party_payment_source',
      'other',
    ]) {
      expect(isTransactionMonitoringPatternType(p)).toBe(true);
    }
    expect(isTransactionMonitoringPatternType('structuring')).toBe(false);
  });

  it('only "closed" is terminal', () => {
    expect(isTerminalTransactionMonitoringStatus('closed')).toBe(true);
    expect(isTerminalTransactionMonitoringStatus('open')).toBe(false);
  });
});

describe('isLargePremiumPayment (Process 48)', () => {
  it('below the threshold -> false', () => {
    expect(isLargePremiumPayment('14999.999')).toBe(false);
  });

  it('exactly at the threshold -> true', () => {
    expect(isLargePremiumPayment(AML_LARGE_PREMIUM_THRESHOLD_JOD)).toBe(true);
  });

  it('above the threshold -> true', () => {
    expect(isLargePremiumPayment('20000.000')).toBe(true);
  });

  it('accepts a Prisma.Decimal the same as a string', () => {
    expect(isLargePremiumPayment(new Prisma.Decimal('16000.000'))).toBe(true);
  });
});

describe('isThirdPartyPaymentSource (Process 48)', () => {
  it('no payment channel recorded -> false (a documented detection gap, not a false negative claimed as coverage)', () => {
    expect(
      isThirdPartyPaymentSource({
        invoiceCustomerId: 'cust-1',
        paymentChannel: null,
      }),
    ).toBe(false);
  });

  it('an insurer-owned channel -> false (only a customer-owned channel can be "third-party")', () => {
    expect(
      isThirdPartyPaymentSource({
        invoiceCustomerId: 'cust-1',
        paymentChannel: { ownerType: 'insurer', customerId: null },
      }),
    ).toBe(false);
  });

  it('the invoiced customer paying via their own channel -> false', () => {
    expect(
      isThirdPartyPaymentSource({
        invoiceCustomerId: 'cust-1',
        paymentChannel: { ownerType: 'customer', customerId: 'cust-1' },
      }),
    ).toBe(false);
  });

  it("a different customer's channel -> true", () => {
    expect(
      isThirdPartyPaymentSource({
        invoiceCustomerId: 'cust-1',
        paymentChannel: { ownerType: 'customer', customerId: 'cust-2' },
      }),
    ).toBe(true);
  });
});

describe('isFrequentPattern (Process 48)', () => {
  it('below threshold -> false, at/above -> true', () => {
    expect(
      isFrequentPattern(2, AML_FREQUENT_CANCELLATION_THRESHOLD_COUNT),
    ).toBe(false);
    expect(
      isFrequentPattern(3, AML_FREQUENT_CANCELLATION_THRESHOLD_COUNT),
    ).toBe(true);
    expect(
      isFrequentPattern(4, AML_FREQUENT_CANCELLATION_THRESHOLD_COUNT),
    ).toBe(true);
  });
});

describe('countRecentByCustomer (Process 48)', () => {
  const windowStart = new Date('2026-06-01T00:00:00.000Z');

  it('excludes rows before the window, groups the rest by customer', () => {
    const counts = countRecentByCustomer(
      [
        { customerId: 'a', createdAt: new Date('2026-05-01T00:00:00.000Z') }, // excluded
        { customerId: 'a', createdAt: new Date('2026-06-01T00:00:00.000Z') }, // boundary, included
        { customerId: 'a', createdAt: new Date('2026-07-01T00:00:00.000Z') },
        { customerId: 'b', createdAt: new Date('2026-07-01T00:00:00.000Z') },
      ],
      windowStart,
    );
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
  });

  it('an empty input yields an empty map', () => {
    expect(countRecentByCustomer([], windowStart).size).toBe(0);
  });
});

describe('detectReceiptPatterns (Process 48)', () => {
  const baseReceipt = {
    id: 'receipt-1',
    invoice: {
      id: 'invoice-1',
      customerId: 'cust-1',
      premiumAmount: new Prisma.Decimal('5000.000'),
    },
    paymentChannel: null,
  };

  it('neither pattern fires for an ordinary small, own-channel payment', () => {
    expect(detectReceiptPatterns(baseReceipt)).toEqual([]);
  });

  it('flags large_premium_payment alone when only the premium clears the threshold', () => {
    const candidates = detectReceiptPatterns({
      ...baseReceipt,
      invoice: {
        ...baseReceipt.invoice,
        premiumAmount: new Prisma.Decimal('20000.000'),
      },
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      patternType: 'large_premium_payment',
      customerId: 'cust-1',
      sourceEntityType: 'Receipt',
      sourceEntityId: 'receipt-1',
    });
  });

  it('flags third_party_payment_source alone when only the channel disagrees', () => {
    const candidates = detectReceiptPatterns({
      ...baseReceipt,
      paymentChannel: { ownerType: 'customer', customerId: 'cust-2' },
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].patternType).toBe('third_party_payment_source');
  });

  it('flags BOTH patterns independently on the same receipt', () => {
    const candidates = detectReceiptPatterns({
      id: 'receipt-2',
      invoice: {
        id: 'invoice-2',
        customerId: 'cust-1',
        premiumAmount: new Prisma.Decimal('99999.000'),
      },
      paymentChannel: { ownerType: 'customer', customerId: 'cust-2' },
    });
    expect(candidates.map((c) => c.patternType).sort()).toEqual([
      'large_premium_payment',
      'third_party_payment_source',
    ]);
    // Both candidates trace back to the same triggering Receipt.
    expect(candidates.every((c) => c.sourceEntityId === 'receipt-2')).toBe(
      true,
    );
  });
});

describe('buildFrequentCancellationDetail / buildFrequentRefundDetail (Process 48)', () => {
  it('mentions the count, the window, and the threshold', () => {
    expect(buildFrequentCancellationDetail(5, 90)).toContain(
      '5 cancellation(s)',
    );
    expect(buildFrequentCancellationDetail(5, 90)).toContain(
      '90 calendar days',
    );
    expect(buildFrequentRefundDetail(4, 90)).toContain('4 refund(s)');
  });
});

describe('deriveTransactionMonitoringAlertView (Process 48)', () => {
  const row: TransactionMonitoringAlertRow = {
    id: 'alert-1',
    customerId: 'cust-1',
    patternType: 'large_premium_payment',
    detailText: 'some detail',
    sourceEntityType: 'Receipt',
    sourceEntityId: 'receipt-1',
    detectedAt: new Date('2026-09-04T09:00:00.000Z'),
    escalatedToSuspiciousActivity: false,
    escalatedAt: null,
    reportedToAuthorityAt: null,
    status: 'open',
    classification: 'HIGHLY_CONFIDENTIAL',
  };

  it('renders a fresh open alert with ISO timestamps and null escalation fields', () => {
    expect(deriveTransactionMonitoringAlertView(row)).toEqual({
      id: 'alert-1',
      customerId: 'cust-1',
      patternType: 'large_premium_payment',
      detailText: 'some detail',
      sourceEntityType: 'Receipt',
      sourceEntityId: 'receipt-1',
      detectedAt: '2026-09-04T09:00:00.000Z',
      escalatedToSuspiciousActivity: false,
      escalatedAt: null,
      reportedToAuthorityAt: null,
      status: 'open',
      isClosed: false,
      classification: 'HIGHLY_CONFIDENTIAL',
    });
  });

  it('an escalated + reported + closed alert carries all three', () => {
    const v = deriveTransactionMonitoringAlertView({
      ...row,
      escalatedToSuspiciousActivity: true,
      escalatedAt: new Date('2026-09-05T00:00:00.000Z'),
      reportedToAuthorityAt: new Date('2026-09-06T00:00:00.000Z'),
      status: 'closed',
    });
    expect(v.escalatedToSuspiciousActivity).toBe(true);
    expect(v.escalatedAt).toBe('2026-09-05T00:00:00.000Z');
    expect(v.reportedToAuthorityAt).toBe('2026-09-06T00:00:00.000Z');
    expect(v.isClosed).toBe(true);
  });
});

describe('transactionMonitoringAlertAuditSnapshot (Process 48)', () => {
  it('carries ids + patternType + status + source provenance, never detailText', () => {
    const snapshot = transactionMonitoringAlertAuditSnapshot({
      alertId: 'alert-1',
      customerId: 'cust-1',
      patternType: 'large_premium_payment',
      status: 'open',
      sourceEntityType: 'Receipt',
      sourceEntityId: 'receipt-1',
    });
    expect(snapshot).toEqual({
      alertId: 'alert-1',
      customerId: 'cust-1',
      patternType: 'large_premium_payment',
      status: 'open',
      sourceEntityType: 'Receipt',
      sourceEntityId: 'receipt-1',
    });
    expect(snapshot).not.toHaveProperty('detailText');
  });

  it('omits escalation/report fields entirely when not passed (not just null)', () => {
    const snapshot = transactionMonitoringAlertAuditSnapshot({
      alertId: 'alert-1',
      customerId: 'cust-1',
      patternType: 'frequent_cancellations',
      status: 'open',
    });
    expect(snapshot).not.toHaveProperty('escalatedToSuspiciousActivity');
    expect(snapshot).not.toHaveProperty('reportedToAuthorityAt');
  });

  it('includes escalatedToSuspiciousActivity / reportedToAuthorityAt when explicitly passed', () => {
    const snapshot = transactionMonitoringAlertAuditSnapshot({
      alertId: 'alert-1',
      customerId: 'cust-1',
      patternType: 'large_premium_payment',
      status: 'open',
      escalatedToSuspiciousActivity: true,
      reportedToAuthorityAt: new Date('2026-09-06T00:00:00.000Z'),
    });
    expect(snapshot.escalatedToSuspiciousActivity).toBe(true);
    expect(snapshot.reportedToAuthorityAt).toBe('2026-09-06T00:00:00.000Z');
  });
});

import { Prisma } from '@ibms/db';
import { describe, expect, it } from 'vitest';
import {
  agreementAuditSnapshot,
  commissionEntryAuditSnapshot,
  computeCommissionAmount,
  computeCommissionVat,
  computeReversalState,
  deriveAgreementView,
  deriveLedgerEntryView,
  isCommissionEntryTransition,
  overrideAuditSnapshot,
  overrideProposalMatches,
  reversalAuditSnapshot,
  resolveGovernedRate,
  settlementAuditSnapshot,
  type CommissionAgreementLike,
  type CommissionLedgerEntryRow,
} from './commission.config';

const d = (v: string) => new Prisma.Decimal(v);
const D = (iso: string) => new Date(iso);

describe('resolveGovernedRate (Process 35)', () => {
  const agreements: CommissionAgreementLike[] = [
    // oldest closed window
    {
      id: 'a1',
      ratePercent: d('10'),
      vatRatePercent: d('0'),
      effectiveFrom: D('2025-01-01T00:00:00Z'),
      effectiveTo: D('2026-01-01T00:00:00Z'),
    },
    // middle closed window
    {
      id: 'a2',
      ratePercent: d('12.5'),
      vatRatePercent: d('16'),
      effectiveFrom: D('2026-01-01T00:00:00Z'),
      effectiveTo: D('2026-07-01T00:00:00Z'),
    },
    // current open window
    {
      id: 'a3',
      ratePercent: d('15'),
      vatRatePercent: d('16'),
      effectiveFrom: D('2026-07-01T00:00:00Z'),
      effectiveTo: null,
    },
  ];

  it('picks the window whose [effectiveFrom, effectiveTo) contains the date', () => {
    expect(resolveGovernedRate(agreements, D('2025-06-01T00:00:00Z'))?.id).toBe(
      'a1',
    );
    expect(resolveGovernedRate(agreements, D('2026-03-15T00:00:00Z'))?.id).toBe(
      'a2',
    );
    expect(resolveGovernedRate(agreements, D('2027-01-01T00:00:00Z'))?.id).toBe(
      'a3',
    );
  });

  it('treats effectiveFrom as inclusive and effectiveTo as exclusive', () => {
    expect(resolveGovernedRate(agreements, D('2026-01-01T00:00:00Z'))?.id).toBe(
      'a2',
    ); // exactly a2's start, a1's end
    expect(resolveGovernedRate(agreements, D('2026-07-01T00:00:00Z'))?.id).toBe(
      'a3',
    );
  });

  it('returns null when nothing covers the date (before any window)', () => {
    expect(
      resolveGovernedRate(agreements, D('2024-06-01T00:00:00Z')),
    ).toBeNull();
    expect(resolveGovernedRate([], D('2026-06-01T00:00:00Z'))).toBeNull();
  });
});

describe('computeCommissionAmount (Process 35)', () => {
  it('is premium x rate%, quantized to fils', () => {
    expect(computeCommissionAmount('120000.000', '15').toFixed(3)).toBe(
      '18000.000',
    );
    expect(computeCommissionAmount('120000.000', '12.5').toFixed(3)).toBe(
      '15000.000',
    );
  });

  it('quantizes half-up at the third decimal', () => {
    // 2500.5 x 15% = 375.075
    expect(computeCommissionAmount('2500.500', '15').toFixed(3)).toBe(
      '375.075',
    );
  });

  it('a zero rate yields zero', () => {
    expect(computeCommissionAmount('120000.000', '0').toFixed(3)).toBe('0.000');
  });
});

describe('computeCommissionVat (Process 36)', () => {
  it('is amount x vatRatePercent%, quantized to fils', () => {
    // 18000 x 16% = 2880
    expect(computeCommissionVat('18000.000', '16').toFixed(3)).toBe('2880.000');
    // 12000 x 16% = 1920 (the override case)
    expect(computeCommissionVat('12000.000', '16').toFixed(3)).toBe('1920.000');
  });

  it('a zero VAT rate yields zero (the #35 default)', () => {
    expect(computeCommissionVat('18000.000', '0').toFixed(3)).toBe('0.000');
  });
});

describe('isCommissionEntryTransition (Process 36)', () => {
  it('allows outstanding -> paid | reversed and paid -> reversed', () => {
    expect(isCommissionEntryTransition('outstanding', 'paid')).toBe(true);
    expect(isCommissionEntryTransition('outstanding', 'reversed')).toBe(true);
    expect(isCommissionEntryTransition('paid', 'reversed')).toBe(true);
  });

  it('rejects reversed -> anything, paid -> paid, and an unknown from', () => {
    expect(isCommissionEntryTransition('reversed', 'paid')).toBe(false);
    expect(isCommissionEntryTransition('reversed', 'reversed')).toBe(false);
    expect(isCommissionEntryTransition('paid', 'paid')).toBe(false);
    expect(isCommissionEntryTransition('nonsense', 'paid')).toBe(false);
  });
});

describe('computeReversalState (Process 36)', () => {
  it('pools the reversal amounts and is not fully reversed below the earned commission', () => {
    const s = computeReversalState({
      entryAmount: d('18000'),
      reversalAmounts: [d('5000'), d('3000')],
    });
    expect(s.reversedAmount.toFixed(3)).toBe('8000.000');
    expect(s.fullyReversed).toBe(false);
  });

  it('caps reversedAmount at the earned commission and flips fullyReversed once met', () => {
    const s = computeReversalState({
      entryAmount: d('18000'),
      reversalAmounts: [d('12000'), d('9000')], // pooled 21000 > 18000
    });
    expect(s.reversedAmount.toFixed(3)).toBe('18000.000'); // capped
    expect(s.fullyReversed).toBe(true);
  });

  it('no reversals -> zero, not fully reversed', () => {
    const s = computeReversalState({
      entryAmount: d('18000'),
      reversalAmounts: [],
    });
    expect(s.reversedAmount.toFixed(3)).toBe('0.000');
    expect(s.fullyReversed).toBe(false);
  });

  it('an exact-match single reversal is fully reversed', () => {
    const s = computeReversalState({
      entryAmount: d('18000'),
      reversalAmounts: [d('18000.000')],
    });
    expect(s.fullyReversed).toBe(true);
  });
});

describe('deriveAgreementView', () => {
  it('renders the rate to 2dp, dates to ISO, and isOpen from effectiveTo', () => {
    expect(
      deriveAgreementView({
        id: 'ag-1',
        insurerId: 'ins-1',
        insurerName: 'Acme Insurance',
        insuranceLine: 'Property All Risks',
        ratePercent: d('15'),
        vatRatePercent: d('16'),
        effectiveFrom: D('2026-07-01T00:00:00Z'),
        effectiveTo: null,
      }),
    ).toEqual({
      id: 'ag-1',
      insurerId: 'ins-1',
      insurerName: 'Acme Insurance',
      insuranceLine: 'Property All Risks',
      ratePercent: '15.00',
      vatRatePercent: '16.00',
      effectiveFrom: '2026-07-01T00:00:00.000Z',
      effectiveTo: null,
      isOpen: true,
    });
  });

  it('a closed window is not open', () => {
    const v = deriveAgreementView({
      id: 'ag-0',
      insurerId: 'ins-1',
      insurerName: 'Acme',
      insuranceLine: 'Motor',
      ratePercent: d('12'),
      vatRatePercent: d('0'),
      effectiveFrom: D('2025-01-01T00:00:00Z'),
      effectiveTo: D('2026-07-01T00:00:00Z'),
    });
    expect(v.isOpen).toBe(false);
    expect(v.effectiveTo).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('deriveLedgerEntryView', () => {
  const base: CommissionLedgerEntryRow = {
    id: 'cle-1',
    policyId: 'pol-1',
    commissionAgreementId: 'ag-1',
    amount: d('18000'),
    vatRatePercent: d('16'),
    vatAmount: d('2880'),
    overrideAmount: null,
    status: 'outstanding',
    isManualOverride: false,
    overrideReason: null,
    overrideRequestedByUserId: null,
    overrideApprovedByUserId: null,
    paidAmount: null,
    paidAt: null,
    paymentReference: null,
    reversedAmount: null,
    reversedAt: null,
    reversalReason: null,
    createdAt: D('2026-09-03T10:00:00Z'),
  };

  it('a governed entry: effectiveAmount = amount, gross = amount + vat, no override pending', () => {
    const v = deriveLedgerEntryView(base);
    expect(v).toMatchObject({
      amount: '18000.000',
      vatRatePercent: '16.00',
      vatAmount: '2880.000',
      grossAmount: '20880.000',
      overrideAmount: null,
      effectiveAmount: '18000.000',
      status: 'outstanding',
      isManualOverride: false,
      overridePending: false,
      paidAmount: null,
      reversedAmount: null,
    });
  });

  it('a paid entry surfaces the reconciliation fields', () => {
    const v = deriveLedgerEntryView({
      ...base,
      status: 'paid',
      paidAmount: d('18000'),
      paidAt: D('2026-10-01T09:00:00Z'),
      paymentReference: 'STMT-2026-10',
    });
    expect(v).toMatchObject({
      status: 'paid',
      paidAmount: '18000.000',
      paidAt: '2026-10-01T09:00:00.000Z',
      paymentReference: 'STMT-2026-10',
    });
  });

  it('a reversed entry surfaces the clawback fields', () => {
    const v = deriveLedgerEntryView({
      ...base,
      status: 'reversed',
      reversedAmount: d('18000'),
      reversedAt: D('2026-11-01T00:00:00Z'),
      reversalReason: 'Policy cancelled mid-term.',
    });
    expect(v).toMatchObject({
      status: 'reversed',
      reversedAmount: '18000.000',
      reversedAt: '2026-11-01T00:00:00.000Z',
      reversalReason: 'Policy cancelled mid-term.',
    });
  });

  it('a pending override: amount still governs, overridePending true', () => {
    const v = deriveLedgerEntryView({
      ...base,
      isManualOverride: true,
      overrideAmount: d('12000'),
      overrideReason: 'Negotiated a lower book rate for this account.',
      overrideRequestedByUserId: 'fin-1',
      overrideApprovedByUserId: null,
    });
    expect(v.effectiveAmount).toBe('18000.000'); // governed still governs
    expect(v.overrideAmount).toBe('12000.000');
    expect(v.overridePending).toBe(true);
  });

  it('an approved override: effectiveAmount = overrideAmount, not pending', () => {
    const v = deriveLedgerEntryView({
      ...base,
      amount: d('12000'), // approve copied overrideAmount into amount
      isManualOverride: true,
      overrideAmount: d('12000'),
      overrideReason: 'Negotiated a lower book rate for this account.',
      overrideRequestedByUserId: 'fin-1',
      overrideApprovedByUserId: 'mgr-1',
    });
    expect(v.effectiveAmount).toBe('12000.000');
    expect(v.overridePending).toBe(false);
  });
});

describe('overrideProposalMatches', () => {
  it('is true only when both the amount and the reason match', () => {
    const row = {
      overrideAmount: d('12000'),
      overrideReason: 'lower book rate',
    };
    expect(
      overrideProposalMatches(row, {
        overrideAmount: d('12000.000'),
        reason: 'lower book rate',
      }),
    ).toBe(true);
    expect(
      overrideProposalMatches(row, {
        overrideAmount: d('12500'),
        reason: 'lower book rate',
      }),
    ).toBe(false);
    expect(
      overrideProposalMatches(row, {
        overrideAmount: d('12000'),
        reason: 'different reason',
      }),
    ).toBe(false);
    expect(
      overrideProposalMatches(
        { overrideAmount: null, overrideReason: null },
        { overrideAmount: d('12000'), reason: 'x' },
      ),
    ).toBe(false);
  });
});

describe('audit snapshots', () => {
  it('agreementAuditSnapshot carries ids + rate + VAT rate + window + the superseded id', () => {
    expect(
      agreementAuditSnapshot({
        agreementId: 'ag-2',
        insurerId: 'ins-1',
        insuranceLine: 'Property All Risks',
        ratePercent: d('10'),
        vatRatePercent: d('16'),
        effectiveFrom: D('2026-09-03T00:00:00Z'),
        effectiveTo: null,
        supersededAgreementId: 'ag-1',
      }),
    ).toEqual({
      agreementId: 'ag-2',
      insurerId: 'ins-1',
      insuranceLine: 'Property All Risks',
      ratePercent: '10.00',
      vatRatePercent: '16.00',
      effectiveFrom: '2026-09-03T00:00:00.000Z',
      effectiveTo: null,
      supersededAgreementId: 'ag-1',
    });
  });

  it('commissionEntryAuditSnapshot carries the rate + VAT rate applied + amounts as fixed strings', () => {
    expect(
      commissionEntryAuditSnapshot({
        entryId: 'cle-1',
        policyId: 'pol-1',
        commissionAgreementId: 'ag-1',
        ratePercentApplied: '15.00',
        vatRatePercentApplied: '16.00',
        amount: d('18000'),
        vatAmount: d('2880'),
        status: 'outstanding',
      }),
    ).toMatchObject({
      ratePercentApplied: '15.00',
      vatRatePercentApplied: '16.00',
      amount: '18000.000',
      vatAmount: '2880.000',
      status: 'outstanding',
    });
  });

  it('settlementAuditSnapshot carries the paid figure + the statement reference', () => {
    expect(
      settlementAuditSnapshot({
        entryId: 'cle-1',
        policyId: 'pol-1',
        paidAmount: d('18000'),
        paymentReference: 'STMT-2026-10',
        status: 'paid',
      }),
    ).toEqual({
      entryId: 'cle-1',
      policyId: 'pol-1',
      paidAmount: '18000.000',
      paymentReference: 'STMT-2026-10',
      status: 'paid',
    });
  });

  it('reversalAuditSnapshot carries the reversed figure + the reason verbatim', () => {
    expect(
      reversalAuditSnapshot({
        entryId: 'cle-1',
        policyId: 'pol-1',
        reversedAmount: d('18000'),
        reversalReason:
          'Commission reversed by a Process 22 cancellation endorsement.',
        status: 'reversed',
      }),
    ).toMatchObject({
      reversedAmount: '18000.000',
      reversalReason:
        'Commission reversed by a Process 22 cancellation endorsement.',
      status: 'reversed',
    });
  });

  it('overrideAuditSnapshot carries the reason verbatim + the maker/checker ids', () => {
    const snap = overrideAuditSnapshot({
      entryId: 'cle-1',
      policyId: 'pol-1',
      overrideAmount: d('12000'),
      overrideReason: 'Negotiated a lower book rate for this account.',
      overrideRequestedByUserId: 'fin-1',
      overrideApprovedByUserId: 'mgr-1',
      amountAfter: d('12000'),
    });
    expect(snap).toMatchObject({
      overrideAmount: '12000.000',
      overrideReason: 'Negotiated a lower book rate for this account.',
      overrideRequestedByUserId: 'fin-1',
      overrideApprovedByUserId: 'mgr-1',
      amountAfter: '12000.000',
    });
  });
});

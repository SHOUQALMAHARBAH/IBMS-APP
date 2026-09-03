import { Prisma } from '@ibms/db';
import { describe, expect, it } from 'vitest';
import {
  agreementAuditSnapshot,
  commissionEntryAuditSnapshot,
  computeCommissionAmount,
  deriveAgreementView,
  deriveLedgerEntryView,
  overrideAuditSnapshot,
  overrideProposalMatches,
  resolveGovernedRate,
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
      effectiveFrom: D('2025-01-01T00:00:00Z'),
      effectiveTo: D('2026-01-01T00:00:00Z'),
    },
    // middle closed window
    {
      id: 'a2',
      ratePercent: d('12.5'),
      effectiveFrom: D('2026-01-01T00:00:00Z'),
      effectiveTo: D('2026-07-01T00:00:00Z'),
    },
    // current open window
    {
      id: 'a3',
      ratePercent: d('15'),
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

describe('deriveAgreementView', () => {
  it('renders the rate to 2dp, dates to ISO, and isOpen from effectiveTo', () => {
    expect(
      deriveAgreementView({
        id: 'ag-1',
        insurerId: 'ins-1',
        insurerName: 'Acme Insurance',
        insuranceLine: 'Property All Risks',
        ratePercent: d('15'),
        effectiveFrom: D('2026-07-01T00:00:00Z'),
        effectiveTo: null,
      }),
    ).toEqual({
      id: 'ag-1',
      insurerId: 'ins-1',
      insurerName: 'Acme Insurance',
      insuranceLine: 'Property All Risks',
      ratePercent: '15.00',
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
    vatAmount: d('0'),
    overrideAmount: null,
    status: 'outstanding',
    isManualOverride: false,
    overrideReason: null,
    overrideRequestedByUserId: null,
    overrideApprovedByUserId: null,
    createdAt: D('2026-09-03T10:00:00Z'),
  };

  it('a governed entry: effectiveAmount = amount, no override pending', () => {
    const v = deriveLedgerEntryView(base);
    expect(v).toMatchObject({
      amount: '18000.000',
      vatAmount: '0.000',
      overrideAmount: null,
      effectiveAmount: '18000.000',
      isManualOverride: false,
      overridePending: false,
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
  it('agreementAuditSnapshot carries ids + rate + window + the superseded id', () => {
    expect(
      agreementAuditSnapshot({
        agreementId: 'ag-2',
        insurerId: 'ins-1',
        insuranceLine: 'Property All Risks',
        ratePercent: d('10'),
        effectiveFrom: D('2026-09-03T00:00:00Z'),
        effectiveTo: null,
        supersededAgreementId: 'ag-1',
      }),
    ).toEqual({
      agreementId: 'ag-2',
      insurerId: 'ins-1',
      insuranceLine: 'Property All Risks',
      ratePercent: '10.00',
      effectiveFrom: '2026-09-03T00:00:00.000Z',
      effectiveTo: null,
      supersededAgreementId: 'ag-1',
    });
  });

  it('commissionEntryAuditSnapshot carries the rate applied + amount as a fixed string', () => {
    expect(
      commissionEntryAuditSnapshot({
        entryId: 'cle-1',
        policyId: 'pol-1',
        commissionAgreementId: 'ag-1',
        ratePercentApplied: '15.00',
        amount: d('18000'),
        status: 'outstanding',
      }),
    ).toMatchObject({
      ratePercentApplied: '15.00',
      amount: '18000.000',
      status: 'outstanding',
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

import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import { CommissionLedgerService } from './commission-ledger.service';
import type { CommissionRepository } from '../../repositories/commission.repository';
import type { PolicyRepository } from '../../repositories/policy.repository';
import type { AuditService } from '../audit/audit.service';

const d = (v: string) => new Prisma.Decimal(v);

const POLICY = {
  id: 'pol-1',
  insurerId: 'ins-1',
  insuranceLine: 'Property All Risks',
  issuedPremium: d('120000.000'),
  inceptionDate: new Date('2026-10-01T00:00:00.000Z'),
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
};

const OPEN_AGREEMENT = {
  id: 'ag-1',
  ratePercent: d('15'),
  effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
  effectiveTo: null,
};

const governedEntry = (over: Record<string, unknown> = {}) => ({
  id: 'cle-1',
  policyId: 'pol-1',
  commissionAgreementId: 'ag-1',
  amount: d('18000.000'), // 120000 x 15%
  vatAmount: d('0'),
  overrideAmount: null,
  status: 'outstanding',
  isManualOverride: false,
  overrideReason: null,
  overrideRequestedByUserId: null,
  overrideApprovedByUserId: null,
  createdAt: new Date('2026-09-03T10:00:00.000Z'),
  ...over,
});

function makeService(
  over: {
    policy?: unknown;
    commission?: Record<string, unknown>;
  } = {},
) {
  const policies = {
    findById: vi
      .fn()
      .mockResolvedValue(over.policy === undefined ? POLICY : over.policy),
  };
  const commission = {
    findLedgerEntryByPolicyId: vi.fn().mockResolvedValue(null),
    findLedgerEntryById: vi.fn(),
    findAgreementsForPair: vi.fn().mockResolvedValue([OPEN_AGREEMENT]),
    createLedgerEntry: vi.fn().mockResolvedValue(governedEntry()),
    findLedgerEntries: vi.fn().mockResolvedValue([]),
    recordOverrideRaise: vi.fn().mockResolvedValue({ count: 1 }),
    recordOverrideApproval: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.commission,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new CommissionLedgerService(
    commission as unknown as CommissionRepository,
    policies as unknown as PolicyRepository,
    audit as unknown as AuditService,
  );
  return { service, commission, policies, audit };
}

describe('CommissionLedgerService.calculate (Process 35)', () => {
  it('records the governed commission (premium x governed rate) + a CREATE audit row', async () => {
    const { service, commission, audit } = makeService();
    const v = await service.calculate({ policyId: 'pol-1' }, 'fin-1');

    expect(v).toMatchObject({
      amount: '18000.000',
      effectiveAmount: '18000.000',
      commissionAgreementId: 'ag-1',
      isManualOverride: false,
      status: 'outstanding',
    });
    expect(commission.createLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: 'pol-1',
        commissionAgreementId: 'ag-1',
      }),
    );
    const created = commission.createLedgerEntry.mock.calls[0]?.[0] as {
      amount: Prisma.Decimal;
    };
    expect(created.amount.toFixed(3)).toBe('18000.000');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'CommissionLedgerEntry',
      }),
    );
  });

  it('422s a policy with no issued premium', async () => {
    const { service } = makeService({
      policy: { ...POLICY, issuedPremium: null },
    });
    await expect(
      service.calculate({ policyId: 'pol-1' }, 'fin-1'),
    ).rejects.toThrow(/issued premium/i);
  });

  it('422s when no commission agreement is in force for the pair at inception', async () => {
    const { service } = makeService({
      commission: { findAgreementsForPair: vi.fn().mockResolvedValue([]) },
    });
    await expect(
      service.calculate({ policyId: 'pol-1' }, 'fin-1'),
    ).rejects.toThrow(/no commission agreement in force/i);
  });

  it('is write-once: a re-calc returns the existing governed entry', async () => {
    const { service, commission } = makeService({
      commission: {
        findLedgerEntryByPolicyId: vi.fn().mockResolvedValue(governedEntry()),
      },
    });
    const v = await service.calculate({ policyId: 'pol-1' }, 'fin-2');
    expect(v.id).toBe('cle-1');
    expect(commission.createLedgerEntry).not.toHaveBeenCalled();
  });

  it('409s a re-calc whose governed figure no longer matches the stored one', async () => {
    const { service } = makeService({
      commission: {
        findLedgerEntryByPolicyId: vi
          .fn()
          .mockResolvedValue(governedEntry({ amount: d('12000.000') })),
      },
    });
    await expect(
      service.calculate({ policyId: 'pol-1' }, 'fin-2'),
    ).rejects.toThrow(/recorded once/i);
  });

  it('still resolves an already-recorded entry even if the agreement was later closed', async () => {
    const { service } = makeService({
      commission: {
        findLedgerEntryByPolicyId: vi.fn().mockResolvedValue(governedEntry()),
        findAgreementsForPair: vi.fn().mockResolvedValue([]), // all closed now
      },
    });
    const v = await service.calculate({ policyId: 'pol-1' }, 'fin-2');
    expect(v.id).toBe('cle-1');
  });

  it('resumes before the no-issued-premium 422 for an already-recorded entry', async () => {
    const { service } = makeService({
      policy: { ...POLICY, issuedPremium: null },
      commission: {
        findLedgerEntryByPolicyId: vi.fn().mockResolvedValue(governedEntry()),
      },
    });
    const v = await service.calculate({ policyId: 'pol-1' }, 'fin-2');
    expect(v.id).toBe('cle-1');
  });

  it('resumes on a re-calc when the same numeric rate was re-opened under a new agreement id (figure-only match)', async () => {
    const { service } = makeService({
      commission: {
        findLedgerEntryByPolicyId: vi
          .fn()
          .mockResolvedValue(
            governedEntry({ commissionAgreementId: 'ag-OLD' }),
          ),
        // a new window, same 15% rate, different id
        findAgreementsForPair: vi
          .fn()
          .mockResolvedValue([{ ...OPEN_AGREEMENT, id: 'ag-NEW' }]),
      },
    });
    const v = await service.calculate({ policyId: 'pol-1' }, 'fin-2');
    expect(v.id).toBe('cle-1'); // resumed, not 409
  });
});

describe('CommissionLedgerService override (Process 35 — maker/checker)', () => {
  const REASON = 'Negotiated a lower book rate for this key account.';

  it('raise: records the proposal, leaves amount governed, marks it pending', async () => {
    const { service, commission, audit } = makeService({
      commission: {
        findLedgerEntryById: vi
          .fn()
          .mockResolvedValueOnce(governedEntry())
          .mockResolvedValue(
            governedEntry({
              isManualOverride: true,
              overrideAmount: d('12000.000'),
              overrideReason: REASON,
              overrideRequestedByUserId: 'fin-1',
            }),
          ),
      },
    });
    const v = await service.raiseOverride(
      'cle-1',
      { overrideAmount: '12000.000', reason: REASON },
      'fin-1',
    );

    expect(commission.recordOverrideRaise).toHaveBeenCalledWith(
      'cle-1',
      expect.objectContaining({
        overrideReason: REASON,
        overrideRequestedByUserId: 'fin-1',
      }),
    );
    const raiseArg = commission.recordOverrideRaise.mock.calls[0]?.[1] as {
      overrideAmount: Prisma.Decimal;
    };
    expect(raiseArg.overrideAmount.toFixed(3)).toBe('12000.000');
    expect(v).toMatchObject({
      amount: '18000.000', // governed, unchanged
      overrideAmount: '12000.000',
      effectiveAmount: '18000.000',
      overridePending: true,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE' }),
    );
  });

  it('raise: 422s a paid/reversed entry', async () => {
    const { service } = makeService({
      commission: {
        findLedgerEntryById: vi
          .fn()
          .mockResolvedValue(governedEntry({ status: 'paid' })),
      },
    });
    await expect(
      service.raiseOverride(
        'cle-1',
        { overrideAmount: '12000.000', reason: REASON },
        'fin-1',
      ),
    ).rejects.toThrow(/outstanding/i);
  });

  it("raise: 404s when the entry's policy is missing / not issued", async () => {
    const { service } = makeService({
      policy: null,
      commission: {
        findLedgerEntryById: vi.fn().mockResolvedValue(governedEntry()),
      },
    });
    await expect(
      service.raiseOverride(
        'cle-1',
        { overrideAmount: '12000.000', reason: REASON },
        'fin-1',
      ),
    ).rejects.toThrow(/missing or not issued/i);
  });

  it('raise: 422s an overrideAmount above the premium', async () => {
    const { service } = makeService({
      commission: {
        findLedgerEntryById: vi.fn().mockResolvedValue(governedEntry()),
      },
    });
    await expect(
      service.raiseOverride(
        'cle-1',
        { overrideAmount: '200000.000', reason: REASON },
        'fin-1',
      ),
    ).rejects.toThrow(/exceeds the premium/i);
  });

  it('approve: rejects the raiser approving their own override (403)', async () => {
    const pending = governedEntry({
      isManualOverride: true,
      overrideAmount: d('12000.000'),
      overrideReason: REASON,
      overrideRequestedByUserId: 'fin-1',
    });
    const { service } = makeService({
      commission: {
        findLedgerEntryById: vi.fn().mockResolvedValue(pending),
      },
    });
    await expect(service.approveOverride('cle-1', 'fin-1')).rejects.toThrow(
      /different user/i,
    );
  });

  it('approve: a distinct actor stamps the checker and copies overrideAmount into amount', async () => {
    const pending = governedEntry({
      isManualOverride: true,
      overrideAmount: d('12000.000'),
      overrideReason: REASON,
      overrideRequestedByUserId: 'fin-1',
    });
    const approved = governedEntry({
      amount: d('12000.000'),
      isManualOverride: true,
      overrideAmount: d('12000.000'),
      overrideReason: REASON,
      overrideRequestedByUserId: 'fin-1',
      overrideApprovedByUserId: 'mgr-1',
    });
    const { service, commission, audit } = makeService({
      commission: {
        findLedgerEntryById: vi
          .fn()
          .mockResolvedValueOnce(pending)
          .mockResolvedValue(approved),
        recordOverrideApproval: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const v = await service.approveOverride('cle-1', 'mgr-1');

    expect(commission.recordOverrideApproval).toHaveBeenCalledWith(
      'cle-1',
      'mgr-1',
      expect.objectContaining({ requestedByUserId: 'fin-1' }),
    );
    const approveArg = commission.recordOverrideApproval.mock.calls[0]?.[2] as {
      overrideAmount: Prisma.Decimal;
    };
    expect(approveArg.overrideAmount.toFixed(3)).toBe('12000.000');
    expect(v).toMatchObject({
      amount: '12000.000',
      effectiveAmount: '12000.000',
      overrideApprovedByUserId: 'mgr-1',
      overridePending: false,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPROVE',
        entityType: 'CommissionLedgerEntry',
      }),
    );
  });

  it('approve: 422s an entry with no override pending', async () => {
    const { service } = makeService({
      commission: {
        findLedgerEntryById: vi.fn().mockResolvedValue(governedEntry()),
      },
    });
    await expect(service.approveOverride('cle-1', 'mgr-1')).rejects.toThrow(
      /no override pending/i,
    );
  });

  it('approve: a different approver on an already-approved override is a 409', async () => {
    const approved = governedEntry({
      amount: d('12000.000'),
      isManualOverride: true,
      overrideAmount: d('12000.000'),
      overrideReason: REASON,
      overrideRequestedByUserId: 'fin-1',
      overrideApprovedByUserId: 'mgr-1',
    });
    const { service } = makeService({
      commission: {
        findLedgerEntryById: vi.fn().mockResolvedValue(approved),
      },
    });
    await expect(service.approveOverride('cle-1', 'mgr-2')).rejects.toThrow(
      /already approved/i,
    );
    // the same approver is idempotent
    const v = await service.approveOverride('cle-1', 'mgr-1');
    expect(v.overrideApprovedByUserId).toBe('mgr-1');
  });

  it('approve: a status-conditional 0-row update surfaces as a 409 (concurrent)', async () => {
    const pending = governedEntry({
      isManualOverride: true,
      overrideAmount: d('12000.000'),
      overrideReason: REASON,
      overrideRequestedByUserId: 'fin-1',
    });
    const { service } = makeService({
      commission: {
        findLedgerEntryById: vi
          .fn()
          .mockResolvedValueOnce(pending)
          .mockResolvedValue(pending), // still shows pending on reload -> not us
        recordOverrideApproval: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });
    await expect(service.approveOverride('cle-1', 'mgr-1')).rejects.toThrow(
      /concurrently/i,
    );
  });
});

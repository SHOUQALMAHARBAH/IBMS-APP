import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import { CommissionAgreementService } from './commission-agreement.service';
import type { CommissionRepository } from '../../repositories/commission.repository';
import type { AuditService } from '../audit/audit.service';
import type { InsuranceLineRepository } from '../../repositories/insurance-line.repository';

const d = (v: string) => new Prisma.Decimal(v);

function makeService(over: Partial<Record<string, unknown>> = {}) {
  const commission = {
    insurerExists: vi.fn().mockResolvedValue(true),
    listInsurers: vi.fn().mockResolvedValue([]),
    findOpenAgreement: vi.fn().mockResolvedValue(null),
    findAgreements: vi.fn().mockResolvedValue([]),
    findAgreementsForPair: vi.fn().mockResolvedValue([]),
    supersedeAndCreateAgreement: vi.fn(),
    ...over,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  // The managed catalogue the service resolves a typed line against. Real codes and names so the
  // resolver is exercised as written; the ids are fabricated because which uuid a database seeded
  // is not what these tests are about.
  const listStandard = vi.fn().mockResolvedValue([
    {
      id: 'line-property',
      code: 'PROPERTY_ALL_RISKS',
      nameEn: 'Property All Risks',
    },
    { id: 'line-cyber', code: 'CYBER', nameEn: 'Cyber' },
  ]);
  const lines = { listStandard };
  const service = new CommissionAgreementService(
    commission as unknown as CommissionRepository,
    audit as unknown as AuditService,
    lines as unknown as InsuranceLineRepository,
  );
  return { service, commission, audit, lines };
}

const agreementRow = (over: Record<string, unknown> = {}) => ({
  id: 'ag-new',
  insurerId: 'ins-1',
  insuranceLine: 'Property All Risks',
  ratePercent: d('15'),
  vatRatePercent: d('0'),
  effectiveFrom: new Date('2026-09-03T00:00:00.000Z'),
  effectiveTo: null,
  // Post Part I §5 split: the name lives on the global InsurerMaster.
  insurer: { insurerMaster: { legalName: 'Acme Insurance' } },
  ...over,
});

describe('CommissionAgreementService.create (Process 35)', () => {
  it('opens a new window for a pair with none, and audits it', async () => {
    const { service, commission, audit } = makeService({
      supersedeAndCreateAgreement: vi.fn().mockResolvedValue(agreementRow()),
    });

    const v = await service.create(
      {
        insurerId: 'ins-1',
        insuranceLine: 'Property All Risks',
        ratePercent: '15',
      },
      'mgr-1',
    );

    expect(v).toMatchObject({
      insurerId: 'ins-1',
      ratePercent: '15.00',
      isOpen: true,
    });
    expect(commission.supersedeAndCreateAgreement).toHaveBeenCalledWith(
      expect.objectContaining({ supersedeId: null }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'CommissionAgreement',
      }),
    );
  });

  it('supersedes the open window (its id is passed + an UPDATE audit row is written)', async () => {
    const open = {
      id: 'ag-old',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      ratePercent: d('12'),
    };
    const { service, commission, audit } = makeService({
      findOpenAgreement: vi.fn().mockResolvedValue(open),
      supersedeAndCreateAgreement: vi
        .fn()
        .mockResolvedValue(agreementRow({ id: 'ag-new2' })),
    });

    await service.create(
      {
        insurerId: 'ins-1',
        insuranceLine: 'Property All Risks',
        ratePercent: '15',
        effectiveFrom: '2026-09-03',
      },
      'mgr-1',
    );

    expect(commission.supersedeAndCreateAgreement).toHaveBeenCalledWith(
      expect.objectContaining({ supersedeId: 'ag-old' }),
    );
    const updateCall = audit.record.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'UPDATE',
    );
    expect(updateCall?.[0]).toMatchObject({
      entityType: 'CommissionAgreement',
      entityId: 'ag-old',
    });
  });

  it('422s a rate outside 0..100', async () => {
    const { service } = makeService();
    await expect(
      service.create(
        {
          insurerId: 'ins-1',
          insuranceLine: 'Property All Risks',
          ratePercent: '150',
        },
        'mgr-1',
      ),
    ).rejects.toThrow(/0\.\.100/);
  });

  it('422s a vatRatePercent outside 0..100 (Process 36)', async () => {
    const { service } = makeService();
    await expect(
      service.create(
        {
          insurerId: 'ins-1',
          insuranceLine: 'Property All Risks',
          ratePercent: '12',
          vatRatePercent: '150',
        },
        'mgr-1',
      ),
    ).rejects.toThrow(/vatRatePercent .* 0\.\.100/);
  });

  it('carries vatRatePercent onto the created window (Process 36)', async () => {
    const { service, commission } = makeService({
      supersedeAndCreateAgreement: vi
        .fn()
        .mockResolvedValue(agreementRow({ vatRatePercent: d('16') })),
    });
    const v = await service.create(
      {
        insurerId: 'ins-1',
        insuranceLine: 'Property All Risks',
        ratePercent: '15',
        vatRatePercent: '16',
      },
      'mgr-1',
    );
    expect(v.vatRatePercent).toBe('16.00');
    const arg = commission.supersedeAndCreateAgreement.mock.calls[0]?.[0] as {
      create: { vatRatePercent: Prisma.Decimal };
    };
    expect(arg.create.vatRatePercent.toFixed(2)).toBe('16.00');
  });

  it('422s an effectiveFrom earlier than the window it would supersede', async () => {
    const { service } = makeService({
      findOpenAgreement: vi.fn().mockResolvedValue({
        id: 'ag-old',
        effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
        ratePercent: d('12'),
      }),
    });
    await expect(
      service.create(
        {
          insurerId: 'ins-1',
          insuranceLine: 'Property All Risks',
          ratePercent: '15',
          effectiveFrom: '2026-01-01',
        },
        'mgr-1',
      ),
    ).rejects.toThrow(/earlier/i);
  });

  it('404s an unknown insurer', async () => {
    const { service } = makeService({
      insurerExists: vi.fn().mockResolvedValue(false),
    });
    await expect(
      service.create(
        {
          insurerId: 'nope',
          insuranceLine: 'Property All Risks',
          ratePercent: '15',
        },
        'mgr-1',
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('maps a concurrent-open P2002 to a 409', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'x',
    });
    const { service } = makeService({
      supersedeAndCreateAgreement: vi.fn().mockRejectedValue(p2002),
    });
    await expect(
      service.create(
        {
          insurerId: 'ins-1',
          insuranceLine: 'Property All Risks',
          ratePercent: '15',
        },
        'mgr-1',
      ),
    ).rejects.toThrow(/concurrently/i);
  });

  it('an omitted effectiveFrom opens at UTC midnight (so the no-date idempotency guard can engage)', async () => {
    const { service, commission } = makeService({
      supersedeAndCreateAgreement: vi.fn().mockResolvedValue(agreementRow()),
    });
    await service.create(
      {
        insurerId: 'ins-1',
        insuranceLine: 'Property All Risks',
        ratePercent: '15',
      },
      'mgr-1',
    );
    const arg = commission.supersedeAndCreateAgreement.mock.calls[0]?.[0] as {
      create: { effectiveFrom: Date };
    };
    const ef = arg.create.effectiveFrom;
    expect(ef.getUTCHours()).toBe(0);
    expect(ef.getUTCMinutes()).toBe(0);
    expect(ef.getUTCSeconds()).toBe(0);
    expect(ef.getUTCMilliseconds()).toBe(0);
  });

  it('idempotently returns the existing open window on a same-rate same-date re-post', async () => {
    const open = {
      id: 'ag-open',
      effectiveFrom: new Date('2026-09-03T00:00:00.000Z'),
      ratePercent: d('15'),
      vatRatePercent: d('0'),
    };
    const { service, commission } = makeService({
      findOpenAgreement: vi.fn().mockResolvedValue(open),
      findAgreements: vi
        .fn()
        .mockResolvedValue([agreementRow({ id: 'ag-open' })]),
    });
    const v = await service.create(
      {
        insurerId: 'ins-1',
        insuranceLine: 'Property All Risks',
        ratePercent: '15',
        effectiveFrom: '2026-09-03',
      },
      'mgr-1',
    );
    expect(v.id).toBe('ag-open');
    expect(commission.supersedeAndCreateAgreement).not.toHaveBeenCalled();
  });
});

describe('CommissionAgreementService.create — the managed line is resolved, not trusted', () => {
  it('REFUSES a line the catalogue does not have, rather than writing a rate nothing can match', async () => {
    // This is the table that decides what the broker is paid, matched to a Policy by line. A rate
    // recorded against a line no Policy can carry is a rate that will never be applied — so the
    // write is refused at the boundary instead of producing a row with a NULL identity. That
    // refusal is what stops the unmapped set growing (IMPROVEMENTS.md § 1.40).
    const { service, commission } = makeService();
    await expect(
      service.create(
        {
          insurerId: 'ins-1',
          insuranceLine: 'Moter Comprehensiv',
          ratePercent: '15',
          effectiveFrom: '2026-01-01',
        },
        'actor-1',
      ),
    ).rejects.toThrow(/not a line in the managed catalogue/i);
    // And nothing was superseded: the refusal comes before any window is touched.
    expect(commission.supersedeAndCreateAgreement).not.toHaveBeenCalled();
  });

  it('accepts a catalogue CODE as well as a catalogue name, and stores the resolved id', async () => {
    const { service, commission } = makeService({
      supersedeAndCreateAgreement: vi
        .fn()
        .mockResolvedValue(agreementRow({ insuranceLine: 'CYBER' })),
    });
    await service.create(
      {
        insurerId: 'ins-1',
        insuranceLine: 'CYBER',
        ratePercent: '12',
        effectiveFrom: '2026-01-01',
      },
      'actor-1',
    );
    const call = (
      commission.supersedeAndCreateAgreement as unknown as {
        mock: { calls: { 0: { create: Record<string, unknown> } }[] };
      }
    ).mock.calls[0][0];
    // The FK is the resolved catalogue id; the typed string is stored as typed, not rewritten.
    expect(call.create.insuranceLineId).toBe('line-cyber');
    expect(call.create.insuranceLine).toBe('CYBER');
  });

  it('matches a catalogue NAME case-insensitively but never by similarity', async () => {
    const { service, commission } = makeService({
      supersedeAndCreateAgreement: vi.fn().mockResolvedValue(agreementRow()),
    });
    await service.create(
      {
        insurerId: 'ins-1',
        insuranceLine: '  property all RISKS  ',
        ratePercent: '10',
        effectiveFrom: '2026-01-01',
      },
      'actor-1',
    );
    const call = (
      commission.supersedeAndCreateAgreement as unknown as {
        mock: { calls: { 0: { create: Record<string, unknown> } }[] };
      }
    ).mock.calls[0][0];
    expect(call.create.insuranceLineId).toBe('line-property');

    // "Property All Risks (Fire)" is a VARIANT, not this line — and it must not resolve to it.
    // Silently folding a fire-only rate onto the all-risks line would reprice real business.
    await expect(
      service.create(
        {
          insurerId: 'ins-1',
          insuranceLine: 'Property All Risks (Fire)',
          ratePercent: '10',
          effectiveFrom: '2026-01-01',
        },
        'actor-1',
      ),
    ).rejects.toThrow(/not a line in the managed catalogue/i);
  });
});

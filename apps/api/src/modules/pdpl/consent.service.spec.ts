import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConsentService } from './consent.service';
import type { ConsentRecordRepository } from '../../repositories/consent-record.repository';
import type { SlaTimerService } from '../sla/sla-timer.service';
import type { AuditService } from '../audit/audit.service';

const consentRow = (over: Record<string, unknown> = {}) => ({
  id: 'consent-1',
  customerId: 'cust-1',
  insuredPersonId: null,
  purpose: 'MARKETING',
  isMarketing: true,
  granted: true,
  consentTextVersion: 'privacy-notice-v1.2',
  grantedAt: new Date('2026-09-04T09:00:00.000Z'),
  withdrawnAt: null,
  createdAt: new Date('2026-09-04T09:00:00.000Z'),
  ...over,
});

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    customerExists: vi.fn().mockResolvedValue(true),
    insuredPersonExists: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue(consentRow()),
    findById: vi.fn().mockResolvedValue(consentRow()),
    findMany: vi.fn().mockResolvedValue([]),
    recordWithdrawal: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.repo,
  };
  const slaTimer = {
    computeDueAt: vi.fn().mockReturnValue(new Date('2026-09-08T00:00:00.000Z')),
    startTimer: vi
      .fn()
      .mockResolvedValue([
        { id: 'sla-1', dueAt: new Date('2026-09-08T00:00:00.000Z') },
      ]),
    resolve: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ConsentService(
    repo as unknown as ConsentRecordRepository,
    slaTimer as unknown as SlaTimerService,
    audit as unknown as AuditService,
  );
  return { service, repo, slaTimer, audit };
}

describe('ConsentService.create (M03)', () => {
  it('captures a grant, deriving isMarketing from purpose and stamping grantedAt', async () => {
    const { service, repo, audit } = makeService();
    const v = await service.create(
      {
        customerId: 'cust-1',
        purpose: 'MARKETING',
        granted: true,
        consentTextVersion: 'privacy-notice-v1.2',
      },
      'u-sales',
    );
    expect(v.isActive).toBe(true);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        insuredPersonId: null,
        purpose: 'MARKETING',
        isMarketing: true,
        granted: true,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'ConsentRecord',
      }),
    );
  });

  it('captures an explicit decline with no grantedAt and isMarketing false for a non-marketing purpose', async () => {
    const { service, repo } = makeService({
      repo: {
        create: vi.fn().mockResolvedValue(
          consentRow({
            purpose: 'KYC_AML',
            isMarketing: false,
            granted: false,
            grantedAt: null,
          }),
        ),
      },
    });
    const v = await service.create(
      {
        customerId: 'cust-1',
        purpose: 'KYC_AML',
        granted: false,
        consentTextVersion: 'kyc-notice-v1',
      },
      'u-sales',
    );
    expect(v.granted).toBe(false);
    expect(v.grantedAt).toBeNull();
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        isMarketing: false,
        granted: false,
        grantedAt: null,
      }),
    );
  });

  it('422s when both customerId and insuredPersonId are given', async () => {
    const { service, repo } = makeService();
    await expect(
      service.create(
        {
          customerId: 'cust-1',
          insuredPersonId: 'ip-1',
          purpose: 'MARKETING',
          granted: true,
          consentTextVersion: 'v1',
        },
        'u-sales',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('422s when neither customerId nor insuredPersonId is given', async () => {
    const { service, repo } = makeService();
    await expect(
      service.create(
        {
          purpose: 'MARKETING',
          granted: true,
          consentTextVersion: 'v1',
        },
        'u-sales',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('404s an unknown customer', async () => {
    const { service } = makeService({
      repo: { customerExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      service.create(
        {
          customerId: 'nope',
          purpose: 'MARKETING',
          granted: true,
          consentTextVersion: 'v1',
        },
        'u-sales',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s an unknown insured person', async () => {
    const { service } = makeService({
      repo: { insuredPersonExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      service.create(
        {
          insuredPersonId: 'nope',
          purpose: 'MARKETING',
          granted: true,
          consentTextVersion: 'v1',
        },
        'u-sales',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ConsentService.requestWithdrawal', () => {
  it('starts the SLA timer and does not mutate the record', async () => {
    const { service, repo, slaTimer } = makeService();
    const res = await service.requestWithdrawal('consent-1', 'u-dpo');
    expect(slaTimer.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ConsentRecord',
        entityId: 'consent-1',
        workflowName: 'consent_withdrawal',
      }),
    );
    expect(res.dueAt).toBe('2026-09-08T00:00:00.000Z');
    expect(repo.recordWithdrawal).not.toHaveBeenCalled();
  });

  it('422s a record that was never granted', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(consentRow({ granted: false, grantedAt: null })),
      },
    });
    await expect(
      service.requestWithdrawal('consent-1', 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s an already-withdrawn record', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            consentRow({ withdrawnAt: new Date('2026-09-05T00:00:00.000Z') }),
          ),
      },
    });
    await expect(
      service.requestWithdrawal('consent-1', 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('does not throw when the SLA timer fails to start (best-effort)', async () => {
    const { service } = makeService({});
    const service2 = new ConsentService(
      {
        findById: vi.fn().mockResolvedValue(consentRow()),
      } as unknown as ConsentRecordRepository,
      {
        computeDueAt: vi.fn().mockReturnValue(new Date()),
        startTimer: vi.fn().mockRejectedValue(new Error('db down')),
      } as unknown as SlaTimerService,
      { record: vi.fn() } as unknown as AuditService,
    );
    const res = await service2.requestWithdrawal('consent-1', 'u-dpo');
    expect(res.dueAt).toBeNull();
    expect(service).toBeDefined(); // keep the first fixture referenced
  });

  it('404s an unknown consent record', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.requestWithdrawal('nope', 'u-dpo'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ConsentService.confirmWithdrawal', () => {
  it('stamps withdrawnAt, resolves the SLA timer, and writes an UPDATE audit row', async () => {
    const { service, repo, slaTimer, audit } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(consentRow())
          .mockResolvedValueOnce(
            consentRow({ withdrawnAt: new Date('2026-09-06T00:00:00.000Z') }),
          ),
      },
    });
    const v = await service.confirmWithdrawal('consent-1', 'u-dpo');
    expect(v.isActive).toBe(false);
    expect(repo.recordWithdrawal).toHaveBeenCalledWith(
      'consent-1',
      expect.any(Date),
    );
    expect(slaTimer.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ConsentRecord',
        entityId: 'consent-1',
        workflowName: 'consent_withdrawal',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'ConsentRecord',
      }),
    );
  });

  it('is idempotent on an already-withdrawn record (no second write)', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            consentRow({ withdrawnAt: new Date('2026-09-05T00:00:00.000Z') }),
          ),
      },
    });
    const v = await service.confirmWithdrawal('consent-1', 'u-dpo');
    expect(v.isActive).toBe(false);
    expect(repo.recordWithdrawal).not.toHaveBeenCalled();
  });

  it('422s a record that was never granted', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(consentRow({ granted: false, grantedAt: null })),
      },
    });
    await expect(
      service.confirmWithdrawal('consent-1', 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('resolves a 0-row race by reloading — idempotent if a concurrent confirm already landed', async () => {
    const { service } = makeService({
      repo: {
        recordWithdrawal: vi.fn().mockResolvedValue({ count: 0 }),
        findById: vi
          .fn()
          .mockResolvedValueOnce(consentRow())
          .mockResolvedValueOnce(
            consentRow({ withdrawnAt: new Date('2026-09-06T00:00:00.000Z') }),
          ),
      },
    });
    const v = await service.confirmWithdrawal('consent-1', 'u-dpo');
    expect(v.isActive).toBe(false);
  });

  it('409s a 0-row race that is not actually resolved by a reload', async () => {
    const { service } = makeService({
      repo: {
        recordWithdrawal: vi.fn().mockResolvedValue({ count: 0 }),
        findById: vi.fn().mockResolvedValue(consentRow()),
      },
    });
    await expect(
      service.confirmWithdrawal('consent-1', 'u-dpo'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not throw when the SLA resolve call fails (best-effort)', async () => {
    const repo = {
      findById: vi
        .fn()
        .mockResolvedValueOnce(consentRow())
        .mockResolvedValueOnce(
          consentRow({ withdrawnAt: new Date('2026-09-06T00:00:00.000Z') }),
        ),
      recordWithdrawal: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new ConsentService(
      repo as unknown as ConsentRecordRepository,
      {
        resolve: vi.fn().mockRejectedValue(new Error('db down')),
      } as unknown as SlaTimerService,
      audit as unknown as AuditService,
    );
    const v = await service.confirmWithdrawal('consent-1', 'u-dpo');
    expect(v.isActive).toBe(false);
    expect(repo.recordWithdrawal).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalled();
  });
});

describe('ConsentService reads', () => {
  it('404s an unknown consent record on get', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists with filters passed through', async () => {
    const { service, repo } = makeService();
    await service.list({ customerId: 'cust-1', purpose: 'MARKETING' });
    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust-1', purpose: 'MARKETING' }),
      expect.any(Number),
    );
  });
});

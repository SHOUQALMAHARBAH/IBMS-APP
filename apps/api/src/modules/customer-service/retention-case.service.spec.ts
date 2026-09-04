import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RetentionCaseService } from './retention-case.service';
import type { RetentionCaseRepository } from '../../repositories/retention-case.repository';
import type { AuditService } from '../audit/audit.service';

const caseRow = (over: Record<string, unknown> = {}) => ({
  id: 'rc-1',
  customerId: 'cust-1',
  reason: 'lapse_risk',
  status: 'open',
  createdAt: new Date('2026-09-04T09:00:00.000Z'),
  closedAt: null,
  ...over,
});

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    customerExists: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue(caseRow()),
    findById: vi.fn().mockResolvedValue(caseRow()),
    findMany: vi.fn().mockResolvedValue([]),
    recordClosure: vi.fn().mockResolvedValue({ count: 1 }),
    findRenewalCasesForSweep: vi.fn().mockResolvedValue([]),
    stampRetentionEscalation: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new RetentionCaseService(
    repo as unknown as RetentionCaseRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('RetentionCaseService.create — manual open (Process 46)', () => {
  it('404s when the customer does not exist', async () => {
    const { service } = makeService({
      repo: { customerExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      service.create({ customerId: 'nope', reason: 'lapse_risk' }, 'u-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates the case and writes a CREATE audit row', async () => {
    const { service, repo, audit } = makeService();
    const v = await service.create(
      { customerId: 'cust-1', reason: 'lapse_risk' },
      'u-sales',
    );
    expect(v.id).toBe('rc-1');
    expect(v.status).toBe('open');
    expect(repo.create).toHaveBeenCalledWith({
      customerId: 'cust-1',
      reason: 'lapse_risk',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'RetentionCase',
        entityId: 'rc-1',
      }),
    );
  });
});

describe('RetentionCaseService.runSweep (Process 46)', () => {
  const renewalCase = (over: Record<string, unknown> = {}) => ({
    id: 'renewal-1',
    status: 'LAPSED',
    triggeredAt: new Date('2026-01-01T00:00:00.000Z'),
    policy: { customerId: 'cust-1' },
    ...over,
  });

  it('opens a RetentionCase for a LAPSED renewal case and stamps retentionEscalatedAt', async () => {
    const { service, repo } = makeService({
      repo: {
        findRenewalCasesForSweep: vi.fn().mockResolvedValue([renewalCase()]),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result).toEqual({
      scanned: 1,
      openedRenewalInactivity: 0,
      openedLapseRisk: 1,
      failed: 0,
    });
    expect(repo.stampRetentionEscalation).toHaveBeenCalledWith(
      'renewal-1',
      expect.any(Date),
    );
    expect(repo.create).toHaveBeenCalledWith({
      customerId: 'cust-1',
      reason: 'lapse_risk',
    });
  });

  it('opens a RetentionCase for renewal_inactivity when the case is stale and unresolved', async () => {
    const { service } = makeService({
      repo: {
        findRenewalCasesForSweep: vi.fn().mockResolvedValue([
          renewalCase({
            status: 'RENEWAL_DUE',
            triggeredAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        ]),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result).toEqual({
      scanned: 1,
      openedRenewalInactivity: 1,
      openedLapseRisk: 0,
      failed: 0,
    });
  });

  it('skips a candidate the pure classifier does not flag (not yet due)', async () => {
    const { service, repo } = makeService({
      repo: {
        findRenewalCasesForSweep: vi.fn().mockResolvedValue([
          renewalCase({
            status: 'RENEWAL_DUE',
            triggeredAt: new Date(),
          }),
        ]),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result).toEqual({
      scanned: 1,
      openedRenewalInactivity: 0,
      openedLapseRisk: 0,
      failed: 0,
    });
    expect(repo.stampRetentionEscalation).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('a lost race on the stamp (count 0) skips creating a RetentionCase', async () => {
    const { service, repo } = makeService({
      repo: {
        findRenewalCasesForSweep: vi.fn().mockResolvedValue([renewalCase()]),
        stampRetentionEscalation: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result.openedLapseRisk).toBe(0);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('one bad row does not abandon the rest of the sweep', async () => {
    const { service, repo } = makeService({
      repo: {
        findRenewalCasesForSweep: vi
          .fn()
          .mockResolvedValue([
            renewalCase({ id: 'bad' }),
            renewalCase({ id: 'good' }),
          ]),
        stampRetentionEscalation: vi
          .fn()
          .mockRejectedValueOnce(new Error('db blip'))
          .mockResolvedValueOnce({ count: 1 }),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result.failed).toBe(1);
    expect(result.openedLapseRisk).toBe(1);
    expect(repo.create).toHaveBeenCalledTimes(1);
  });
});

describe('RetentionCaseService.close (Process 46)', () => {
  it('open -> closed, writes an UPDATE audit row', async () => {
    const { service, repo, audit } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(caseRow({ status: 'open' }))
          .mockResolvedValueOnce(
            caseRow({
              status: 'closed',
              closedAt: new Date('2026-09-05T00:00:00.000Z'),
            }),
          ),
      },
    });
    const v = await service.close('rc-1', 'u-mgr');
    expect(v.status).toBe('closed');
    expect(v.closedAt).not.toBeNull();
    expect(repo.recordClosure).toHaveBeenCalledWith('rc-1', expect.any(Date));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'RetentionCase',
      }),
    );
  });

  it('closing an already-closed case is idempotent (no second audit write, no repo write)', async () => {
    const { service, repo, audit } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(caseRow({ status: 'closed' })),
      },
    });
    const v = await service.close('rc-1', 'u-mgr');
    expect(v.status).toBe('closed');
    expect(repo.recordClosure).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('404s for an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.close('nope', 'u-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('RetentionCaseService reads (Process 46)', () => {
  it('get() 404s for an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list() maps rows to views and passes the filters through', async () => {
    const { service, repo } = makeService({
      repo: { findMany: vi.fn().mockResolvedValue([caseRow()]) },
    });
    const rows = await service.list({ customerId: 'cust-1', status: 'open' });
    expect(rows).toHaveLength(1);
    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust-1', status: 'open' }),
      5000,
    );
  });
});

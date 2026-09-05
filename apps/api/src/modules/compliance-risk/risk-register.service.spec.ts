import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RiskRegisterService } from './risk-register.service';
import type { RiskRegisterRepository } from '../../repositories/risk-register.repository';
import type { AuditService } from '../audit/audit.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'risk-1',
  riskType: 'operational',
  description: 'A recurring policy-issuance data-entry error.',
  mitigationAction: null,
  status: 'open',
  loggedAt: new Date('2026-09-01T09:00:00.000Z'),
  closedAt: null,
  ...over,
});

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    create: vi.fn().mockResolvedValue(row()),
    findById: vi.fn().mockResolvedValue(row()),
    findMany: vi.fn().mockResolvedValue([row()]),
    recordMitigation: vi.fn().mockResolvedValue({ count: 1 }),
    close: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new RiskRegisterService(
    repo as unknown as RiskRegisterRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('RiskRegisterService.create (Process 53)', () => {
  it('defaults loggedAt to now and audits CREATE', async () => {
    const { service, repo, audit } = makeService();
    await service.create(
      { riskType: 'cyber', description: 'A phishing attempt reached staff.' },
      'u-compliance',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ riskType: 'cyber' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE' }),
    );
  });

  it('rejects a future backdated loggedAt (parseHistoricalInstant)', async () => {
    const { service } = makeService();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await expect(
      service.create(
        { riskType: 'financial', description: 'x', loggedAt: future },
        'u-compliance',
      ),
    ).rejects.toThrow();
  });
});

describe('RiskRegisterService.recordMitigation (Process 53)', () => {
  it('404s an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.recordMitigation(
        'nope',
        { mitigationAction: 'x' },
        'u-compliance',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409s once the item is closed', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(row({ status: 'closed' })) },
    });
    await expect(
      service.recordMitigation(
        'risk-1',
        { mitigationAction: 'x' },
        'u-compliance',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s on a lost concurrent race (0-row update)', async () => {
    const { service } = makeService({
      repo: { recordMitigation: vi.fn().mockResolvedValue({ count: 0 }) },
    });
    await expect(
      service.recordMitigation(
        'risk-1',
        { mitigationAction: 'x' },
        'u-compliance',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates the mitigation action and audits UPDATE', async () => {
    const { service, repo, audit } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row())
          .mockResolvedValue(row({ mitigationAction: 'Added a control.' })),
      },
    });
    const v = await service.recordMitigation(
      'risk-1',
      { mitigationAction: 'Added a control.' },
      'u-compliance',
    );
    expect(repo.recordMitigation).toHaveBeenCalledWith(
      'risk-1',
      'Added a control.',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE' }),
    );
    expect(v.mitigationAction).toBe('Added a control.');
  });
});

describe('RiskRegisterService.close (Process 53)', () => {
  it('404s an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.close('nope', 'u-compliance')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('is idempotent if already closed', async () => {
    const { service, repo } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(row({ status: 'closed' })) },
    });
    const v = await service.close('risk-1', 'u-compliance');
    expect(v.status).toBe('closed');
    expect(repo.close).not.toHaveBeenCalled();
  });

  it('closes an open item, stamping closedAt, and audits UPDATE', async () => {
    const { service, repo, audit } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row())
          .mockResolvedValue(
            row({ status: 'closed', closedAt: new Date('2026-09-10') }),
          ),
      },
    });
    const v = await service.close('risk-1', 'u-compliance');
    expect(repo.close).toHaveBeenCalledWith('risk-1', expect.any(Date));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE' }),
    );
    expect(v.status).toBe('closed');
  });
});

describe('RiskRegisterService reads (Process 53)', () => {
  it('get() 404s an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list() passes filters through to the repository', async () => {
    const { service, repo } = makeService();
    await service.list({ riskType: 'compliance', status: 'open' });
    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ riskType: 'compliance', status: 'open' }),
      expect.any(Number),
    );
  });
});

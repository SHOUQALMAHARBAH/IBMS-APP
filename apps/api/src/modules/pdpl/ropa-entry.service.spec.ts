import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RopaEntryService } from './ropa-entry.service';
import type { RopaEntryRepository } from '../../repositories/ropa-entry.repository';
import type { AuditService } from '../audit/audit.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'ropa-1',
  processingActivity: 'KYC identity verification',
  categoriesOfData: ['national_id'],
  purpose: 'Regulatory KYC compliance',
  recipients: ['Internal Compliance team'],
  retentionPeriodMonths: 120,
  updatedAt: new Date('2026-09-07T00:00:00.000Z'),
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  ...over,
});

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    create: vi.fn().mockResolvedValue(row()),
    findById: vi.fn().mockResolvedValue(row()),
    findMany: vi.fn().mockResolvedValue([row()]),
    update: vi
      .fn()
      .mockImplementation((id: string, data: Record<string, unknown>) =>
        Promise.resolve(row({ id, ...data })),
      ),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new RopaEntryService(
    repo as unknown as RopaEntryRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('RopaEntryService.create/update', () => {
  it('creates with a null retentionPeriodMonths when omitted', async () => {
    const { service, repo } = makeService();
    await service.create(
      {
        processingActivity: 'x',
        categoriesOfData: ['a'],
        purpose: 'p',
        recipients: ['r'],
      },
      'u-dpo',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ retentionPeriodMonths: null }),
    );
  });

  it('404s updating an unknown entry', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.update('nope', { purpose: 'x' }, 'u-dpo'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RopaEntryService.export', () => {
  it('returns every entry and records an EXPORT audit row with a synthetic entityId', async () => {
    const { service, audit } = makeService();
    const summary = await service.export('u-dpo');
    expect(summary.entryCount).toBe(1);
    expect(summary.entries).toHaveLength(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EXPORT',
        entityType: 'RopaEntry',
        entityId: 'ropa-register',
      }),
    );
  });
});

describe('RopaEntryService.get/list', () => {
  it('404s an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists every entry', async () => {
    const { service } = makeService();
    const rows = await service.list();
    expect(rows).toHaveLength(1);
  });
});

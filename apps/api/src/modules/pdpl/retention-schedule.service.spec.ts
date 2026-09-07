import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { RetentionScheduleService } from './retention-schedule.service';
import type { RetentionScheduleRepository } from '../../repositories/retention-schedule.repository';
import type { AuditService } from '../audit/audit.service';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'rsi-1',
  recordCategory: 'AuditLogEntry',
  retentionPeriodMonths: 120,
  legalBasis: 'DRAFT',
  confirmedByLegalCounselAt: null,
  ...over,
});

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    create: vi.fn().mockResolvedValue(row()),
    findById: vi.fn().mockResolvedValue(row()),
    findByRecordCategory: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([row()]),
    update: vi
      .fn()
      .mockImplementation((id: string, data: Record<string, unknown>) =>
        Promise.resolve(row({ id, ...data })),
      ),
    confirm: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new RetentionScheduleService(
    repo as unknown as RetentionScheduleRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('RetentionScheduleService.create', () => {
  it('creates a schedule item and writes a CREATE audit row', async () => {
    const { service, repo, audit } = makeService();
    const v = await service.create(
      {
        recordCategory: 'AuditLogEntry',
        retentionPeriodMonths: 120,
        legalBasis: 'DRAFT',
      },
      'u-compliance',
    );
    expect(v.recordCategory).toBe('AuditLogEntry');
    expect(repo.create).toHaveBeenCalledWith({
      recordCategory: 'AuditLogEntry',
      retentionPeriodMonths: 120,
      legalBasis: 'DRAFT',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'RetentionScheduleItem',
      }),
    );
  });

  it('409s a duplicate record category (the real unique constraint)', async () => {
    const { service } = makeService({
      repo: { create: vi.fn().mockRejectedValue(p2002()) },
    });
    await expect(
      service.create(
        { recordCategory: 'AuditLogEntry', retentionPeriodMonths: 120 },
        'u-compliance',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('RetentionScheduleService.update', () => {
  it('updates a not-yet-confirmed item', async () => {
    const { service, repo } = makeService();
    await service.update(
      'rsi-1',
      { retentionPeriodMonths: 84 },
      'u-compliance',
    );
    expect(repo.update).toHaveBeenCalledWith('rsi-1', {
      retentionPeriodMonths: 84,
      legalBasis: undefined,
    });
  });

  it('422s an attempt to edit an already-confirmed item', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ confirmedByLegalCounselAt: new Date() })),
      },
    });
    await expect(
      service.update('rsi-1', { retentionPeriodMonths: 84 }, 'u-compliance'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('404s an unknown item', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.update('nope', { retentionPeriodMonths: 84 }, 'u-compliance'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RetentionScheduleService.confirm', () => {
  it('stamps confirmedByLegalCounselAt', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row())
          .mockResolvedValueOnce(
            row({
              confirmedByLegalCounselAt: new Date('2026-09-14T00:00:00.000Z'),
            }),
          ),
      },
    });
    const v = await service.confirm('rsi-1', 'u-dpo');
    expect(v.isConfirmed).toBe(true);
    expect(repo.confirm).toHaveBeenCalledWith('rsi-1', expect.any(Date));
  });

  it('422s a re-confirm of an already-confirmed item', async () => {
    const { service } = makeService({
      repo: {
        confirm: vi.fn().mockResolvedValue({ count: 0 }),
        findById: vi
          .fn()
          .mockResolvedValue(row({ confirmedByLegalCounselAt: new Date() })),
      },
    });
    await expect(service.confirm('rsi-1', 'u-dpo')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('409s a genuine concurrent-change race (0 rows, still unconfirmed on reload)', async () => {
    const { service } = makeService({
      repo: {
        confirm: vi.fn().mockResolvedValue({ count: 0 }),
        findById: vi.fn().mockResolvedValue(row()),
      },
    });
    await expect(service.confirm('rsi-1', 'u-dpo')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('RetentionScheduleService reads', () => {
  it('lists every schedule item', async () => {
    const { service, repo } = makeService();
    const rows = await service.list();
    expect(rows).toHaveLength(1);
    expect(repo.findMany).toHaveBeenCalled();
  });

  it('404s an unknown item on get', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

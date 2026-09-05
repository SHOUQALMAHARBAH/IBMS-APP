import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { PiPolicyService } from './pi-policy.service';
import type { PiPolicyRepository } from '../../repositories/pi-policy.repository';
import type { AuditService } from '../audit/audit.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'pi-1',
  insurerName: 'Jordan Insurance Co.',
  coverageLimit: new Prisma.Decimal('1000000.000'),
  expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  claimsHistorySummary: null,
  ...over,
});

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    create: vi.fn().mockResolvedValue(row()),
    findCurrent: vi.fn().mockResolvedValue(row()),
    findById: vi.fn().mockResolvedValue(row()),
    findMany: vi.fn().mockResolvedValue([row()]),
    updateClaimsHistory: vi.fn().mockResolvedValue(row()),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new PiPolicyService(
    repo as unknown as PiPolicyRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('PiPolicyService.create (Process 53-54)', () => {
  it('creates a new row (not an in-place overwrite) and audits CREATE', async () => {
    const { service, repo, audit } = makeService();
    const v = await service.create(
      {
        insurerName: 'Jordan Insurance Co.',
        coverageLimit: '1000000.000',
        expiresAt: '2027-01-01',
      },
      'u-compliance',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ insurerName: 'Jordan Insurance Co.' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE' }),
    );
    expect(v.isCurrent).toBe(true);
  });
});

describe('PiPolicyService.recordClaimsHistory (Process 53-54)', () => {
  it('404s an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.recordClaimsHistory(
        'nope',
        { claimsHistorySummary: 'x' },
        'u-compliance',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('overwrites claimsHistorySummary and audits UPDATE', async () => {
    const { service, repo, audit } = makeService({
      repo: {
        updateClaimsHistory: vi
          .fn()
          .mockResolvedValue(row({ claimsHistorySummary: 'One claim.' })),
      },
    });
    const v = await service.recordClaimsHistory(
      'pi-1',
      { claimsHistorySummary: 'One claim.' },
      'u-compliance',
    );
    expect(repo.updateClaimsHistory).toHaveBeenCalledWith('pi-1', 'One claim.');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE' }),
    );
    expect(v.claimsHistorySummary).toBe('One claim.');
  });
});

describe('PiPolicyService.getCurrent (Process 53-54)', () => {
  it('404s when nothing has ever been logged', async () => {
    const { service } = makeService({
      repo: { findCurrent: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.getCurrent()).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the current record with isCurrent true', async () => {
    const { service } = makeService();
    const v = await service.getCurrent();
    expect(v.isCurrent).toBe(true);
  });
});

describe('PiPolicyService.get / list (Process 53-54)', () => {
  it('get() 404s an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('get() marks isCurrent false for a row that is not the current one', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ id: 'pi-old' })),
        findCurrent: vi.fn().mockResolvedValue(row({ id: 'pi-new' })),
      },
    });
    const v = await service.get('pi-old');
    expect(v.isCurrent).toBe(false);
  });

  it('list() marks exactly the current row across the whole set', async () => {
    const { service } = makeService({
      repo: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            row({ id: 'pi-old', expiresAt: new Date('2026-01-01') }),
            row({ id: 'pi-new', expiresAt: new Date('2027-01-01') }),
          ]),
        findCurrent: vi.fn().mockResolvedValue(row({ id: 'pi-new' })),
      },
    });
    const views = await service.list();
    expect(views.find((v) => v.id === 'pi-old')?.isCurrent).toBe(false);
    expect(views.find((v) => v.id === 'pi-new')?.isCurrent).toBe(true);
  });
});

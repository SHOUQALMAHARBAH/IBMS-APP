import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { BcpDrPlanService } from './bcp-dr-plan.service';
import type { BcpDrPlanRepository } from '../../repositories/bcp-dr-plan.repository';
import type { DocumentRepository } from '../../repositories/document.repository';
import type { AuditService } from '../audit/audit.service';

function basePlan(over: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    scenario: 'system_outage',
    planDocumentId: null,
    rtoHours: 4,
    rpoHours: 24,
    lastTestedAt: null,
    nextTestDueAt: null,
    ...over,
  };
}

function makeService(
  over: { repo?: Record<string, unknown>; docs?: Record<string, unknown> } = {},
) {
  const repo = {
    create: vi.fn().mockResolvedValue(basePlan()),
    findById: vi.fn().mockResolvedValue(basePlan()),
    findMany: vi.fn().mockResolvedValue([basePlan()]),
    update: vi.fn().mockResolvedValue(basePlan({ rtoHours: 8 })),
    recordTest: vi.fn().mockResolvedValue(
      basePlan({
        lastTestedAt: new Date('2026-09-06T09:00:00.000Z'),
        nextTestDueAt: new Date('2027-09-06T09:00:00.000Z'),
      }),
    ),
    ...over.repo,
  };
  const docs = {
    findById: vi.fn().mockResolvedValue({ id: 'doc-1' }),
    ...over.docs,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new BcpDrPlanService(
    repo as unknown as BcpDrPlanRepository,
    docs as unknown as DocumentRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, docs, audit };
}

describe('BcpDrPlanService.create', () => {
  it('creates a plan and writes a CREATE audit row', async () => {
    const { service, repo, audit } = makeService();
    const result = await service.create(
      { scenario: 'system_outage', rtoHours: 4, rpoHours: 24 },
      'actor-1',
    );
    expect(repo.create).toHaveBeenCalledWith({
      scenario: 'system_outage',
      planDocumentId: null,
      rtoHours: 4,
      rpoHours: 24,
    });
    expect(result.id).toBe('plan-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entityType: 'BcpDrPlan' }),
    );
  });

  it('404s when planDocumentId does not reference a real Document', async () => {
    const { service } = makeService({
      docs: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.create(
        { scenario: 'system_outage', planDocumentId: 'nope' },
        'actor-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('BcpDrPlanService.list / get', () => {
  it('passes the optional scenario filter through', async () => {
    const { service, repo } = makeService();
    await service.list({ scenario: 'cyberattack_ransomware' });
    expect(repo.findMany).toHaveBeenCalledWith({
      scenario: 'cyberattack_ransomware',
    });
  });

  it('404s for an unknown plan', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toThrow(NotFoundException);
  });
});

describe('BcpDrPlanService.coverage', () => {
  it('returns coverage across all five scenarios', async () => {
    const { service, repo } = makeService({
      repo: { findMany: vi.fn().mockResolvedValue([basePlan()]) },
    });
    const coverage = await service.coverage();
    expect(repo.findMany).toHaveBeenCalledWith({});
    expect(coverage).toHaveLength(5);
    expect(coverage.find((c) => c.scenario === 'system_outage')?.hasPlan).toBe(
      true,
    );
  });
});

describe('BcpDrPlanService.update', () => {
  it('updates the plan and writes an UPDATE audit row', async () => {
    const { service, repo, audit } = makeService();
    const result = await service.update('plan-1', { rtoHours: 8 }, 'actor-1');
    expect(repo.update).toHaveBeenCalledWith('plan-1', {
      planDocumentId: undefined,
      rtoHours: 8,
      rpoHours: undefined,
    });
    expect(result.rtoHours).toBe(8);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entityType: 'BcpDrPlan' }),
    );
  });

  it('404s updating an unknown plan', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.update('nope', { rtoHours: 1 }, 'actor-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('404s reassigning to a non-existent plan document', async () => {
    const { service } = makeService({
      docs: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.update('plan-1', { planDocumentId: 'nope' }, 'actor-1'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('BcpDrPlanService.recordTest', () => {
  it('records the test and the next-due date, and writes an audit row', async () => {
    const { service, repo, audit } = makeService();
    const result = await service.recordTest(
      'plan-1',
      { nextTestDueAt: '2027-09-06T09:00:00.000Z' },
      'actor-1',
    );
    expect(repo.recordTest).toHaveBeenCalledWith(
      'plan-1',
      expect.any(Date),
      new Date('2027-09-06T09:00:00.000Z'),
    );
    expect(result.lastTestedAt).toBeTruthy();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entityType: 'BcpDrPlan' }),
    );
  });

  it('404s recording a test for an unknown plan', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.recordTest(
        'nope',
        { nextTestDueAt: '2027-09-06T09:00:00.000Z' },
        'actor-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

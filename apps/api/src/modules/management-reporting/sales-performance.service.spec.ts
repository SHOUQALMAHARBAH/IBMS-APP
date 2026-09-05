import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { SalesTarget } from '@ibms/db';
import { SalesPerformanceService } from './sales-performance.service';
import type { SalesPerformanceRepository } from '../../repositories/sales-performance.repository';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const TARGET: SalesTarget = {
  id: 'target-1',
  ownerUserId: 'sales-1',
  branchId: null,
  periodLabel: '2026-Q4',
  periodStart: new Date('2026-10-01T00:00:00.000Z'),
  periodEnd: new Date('2027-01-01T00:00:00.000Z'),
  targetNewProspects: 10,
  createdByUserId: 'manager-1',
  createdAt: new Date('2026-09-10T00:00:00.000Z'),
  updatedAt: new Date('2026-09-10T00:00:00.000Z'),
};

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    create: vi.fn().mockResolvedValue(TARGET),
    updateTargetValue: vi.fn().mockResolvedValue(TARGET),
    findById: vi.fn().mockResolvedValue(TARGET),
    findByScopeAndLabel: vi.fn().mockResolvedValue(null),
    findCurrent: vi.fn().mockResolvedValue(TARGET),
    findMany: vi.fn().mockResolvedValue([TARGET]),
    findUserIdsInBranch: vi.fn().mockResolvedValue([{ id: 'sales-1' }]),
    countNewLeads: vi.fn().mockResolvedValue(9),
    countNewProspects: vi.fn().mockResolvedValue(4),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new SalesPerformanceService(
    repo as unknown as SalesPerformanceRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

const SALES_OFFICER: AuthenticatedUser = {
  id: 'sales-1',
  email: 'sales@ibms.test',
  roles: ['SALES_RELATIONSHIP_OFFICER'],
  sessionId: 's-1',
};
const MANAGER: AuthenticatedUser = {
  id: 'manager-1',
  email: 'manager@ibms.test',
  roles: ['BRANCH_DEPARTMENT_MANAGER'],
  sessionId: 's-2',
};

describe('SalesPerformanceService.createTarget', () => {
  it('rejects both ownerUserId and branchId set', async () => {
    const { service } = makeService();
    await expect(
      service.createTarget(
        {
          ownerUserId: 'u1',
          branchId: 'b1',
          periodLabel: 'x',
          periodStart: '2026-10-01',
          periodEnd: '2027-01-01',
          targetNewProspects: 10,
        },
        'manager-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects neither ownerUserId nor branchId set', async () => {
    const { service } = makeService();
    await expect(
      service.createTarget(
        {
          periodLabel: 'x',
          periodStart: '2026-10-01',
          periodEnd: '2027-01-01',
          targetNewProspects: 10,
        },
        'manager-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects periodEnd at or before periodStart', async () => {
    const { service } = makeService();
    await expect(
      service.createTarget(
        {
          ownerUserId: 'sales-1',
          periodLabel: '2026-Q4',
          periodStart: '2027-01-01',
          periodEnd: '2026-10-01',
          targetNewProspects: 10,
        },
        'manager-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('409s when a target already exists for this scope+period (pre-check)', async () => {
    const { service, repo } = makeService({
      repo: { findByScopeAndLabel: vi.fn().mockResolvedValue(TARGET) },
    });
    await expect(
      service.createTarget(
        {
          ownerUserId: 'sales-1',
          periodLabel: '2026-Q4',
          periodStart: '2026-10-01',
          periodEnd: '2027-01-01',
          targetNewProspects: 10,
        },
        'manager-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('creates a target and writes a CREATE audit row', async () => {
    const { service, repo, audit } = makeService();
    const view = await service.createTarget(
      {
        ownerUserId: 'sales-1',
        periodLabel: '2026-Q4',
        periodStart: '2026-10-01',
        periodEnd: '2027-01-01',
        targetNewProspects: 10,
      },
      'manager-1',
    );
    expect(view.id).toBe('target-1');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 'sales-1',
        branchId: null,
        createdByUserId: 'manager-1',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entityType: 'SalesTarget' }),
    );
  });
});

describe('SalesPerformanceService.updateTarget', () => {
  it('404s on a nonexistent target', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.updateTarget('missing', { targetNewProspects: 5 }, 'manager-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('revises the target figure and writes an UPDATE audit row', async () => {
    const { service, repo, audit } = makeService();
    await service.updateTarget(
      'target-1',
      { targetNewProspects: 15 },
      'manager-1',
    );
    expect(repo.updateTargetValue).toHaveBeenCalledWith('target-1', 15);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entityType: 'SalesTarget' }),
    );
  });
});

describe('SalesPerformanceService.report', () => {
  it('forces a non-privileged actor to their own ownerUserId regardless of query params', async () => {
    const { service, repo } = makeService();
    await service.report({ ownerUserId: 'someone-else' }, SALES_OFFICER);
    expect(repo.findCurrent).toHaveBeenCalledWith(
      { ownerUserId: 'sales-1' },
      expect.any(Date),
    );
  });

  it('forbids a non-privileged actor from requesting a branch view', async () => {
    const { service } = makeService();
    await expect(
      service.report({ branchId: 'branch-1' }, SALES_OFFICER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires exactly one scope from a privileged actor', async () => {
    const { service } = makeService();
    await expect(service.report({}, MANAGER)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(
      service.report({ ownerUserId: 'sales-1', branchId: 'branch-1' }, MANAGER),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('returns a null target/actual when no target is set yet for the current window', async () => {
    const { service, repo, audit } = makeService({
      repo: { findCurrent: vi.fn().mockResolvedValue(null) },
    });
    const view = await service.report({ ownerUserId: 'sales-1' }, MANAGER);
    expect(view).toEqual({
      scope: { ownerUserId: 'sales-1' },
      target: null,
      actual: null,
      achievementPercent: null,
    });
    expect(repo.countNewProspects).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'READ',
        entityType: 'SalesPerformance',
      }),
    );
  });

  it('404s when an explicit periodLabel has no matching target', async () => {
    const { service } = makeService({
      repo: { findByScopeAndLabel: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.report(
        { ownerUserId: 'sales-1', periodLabel: '2099-Q1' },
        MANAGER,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('computes actual vs. target and an achievement percent for an owner scope', async () => {
    const { service } = makeService();
    const view = await service.report({ ownerUserId: 'sales-1' }, MANAGER);
    expect(view.actual).toEqual({ newLeads: 9, newProspects: 4 });
    expect(view.achievementPercent).toBe(40);
    expect(view.target?.id).toBe('target-1');
  });

  it('resolves a branch scope to every user in that branch before counting', async () => {
    const { service, repo } = makeService({
      repo: {
        findCurrent: vi.fn().mockResolvedValue({
          ...TARGET,
          ownerUserId: null,
          branchId: 'branch-1',
        }),
        findUserIdsInBranch: vi
          .fn()
          .mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]),
      },
    });
    await service.report({ branchId: 'branch-1' }, MANAGER);
    expect(repo.findUserIdsInBranch).toHaveBeenCalledWith('branch-1');
    expect(repo.countNewLeads).toHaveBeenCalledWith(
      ['u1', 'u2'],
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('does not fail the read if the audit write itself fails', async () => {
    const { service, audit } = makeService();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(
      service.report({ ownerUserId: 'sales-1' }, MANAGER),
    ).resolves.toBeDefined();
  });
});

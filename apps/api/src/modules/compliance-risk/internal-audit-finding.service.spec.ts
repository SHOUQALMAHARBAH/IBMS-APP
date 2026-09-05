import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { InternalAuditFindingService } from './internal-audit-finding.service';
import type { InternalAuditFindingRepository } from '../../repositories/internal-audit-finding.repository';
import type { AuditService } from '../audit/audit.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'finding-1',
  auditPeriodLabel: 'Q3 2026 Internal Audit',
  finding: 'Two officers shared a login during a system outage.',
  remediationAction: null,
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
    recordRemediation: vi.fn().mockResolvedValue({ count: 1 }),
    close: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new InternalAuditFindingService(
    repo as unknown as InternalAuditFindingRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('InternalAuditFindingService.create (Process 57)', () => {
  it('defaults loggedAt to now and audits CREATE', async () => {
    const { service, repo, audit } = makeService();
    await service.create(
      {
        auditPeriodLabel: 'Q3 2026 Internal Audit',
        finding: 'A KYC record was approved without a screening result.',
      },
      'u-compliance',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ auditPeriodLabel: 'Q3 2026 Internal Audit' }),
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
        { auditPeriodLabel: 'Q3 2026', finding: 'x', loggedAt: future },
        'u-compliance',
      ),
    ).rejects.toThrow();
  });
});

describe('InternalAuditFindingService.recordRemediation (Process 57)', () => {
  it('404s an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.recordRemediation(
        'nope',
        { remediationAction: 'x' },
        'u-compliance',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409s once the finding is closed', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(row({ status: 'closed' })) },
    });
    await expect(
      service.recordRemediation(
        'finding-1',
        { remediationAction: 'x' },
        'u-compliance',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s on a lost concurrent race (0-row update)', async () => {
    const { service } = makeService({
      repo: { recordRemediation: vi.fn().mockResolvedValue({ count: 0 }) },
    });
    await expect(
      service.recordRemediation(
        'finding-1',
        { remediationAction: 'x' },
        'u-compliance',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates the remediation action and audits UPDATE', async () => {
    const { service, repo, audit } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row())
          .mockResolvedValue(
            row({ remediationAction: 'Retrained the officer.' }),
          ),
      },
    });
    const v = await service.recordRemediation(
      'finding-1',
      { remediationAction: 'Retrained the officer.' },
      'u-compliance',
    );
    expect(repo.recordRemediation).toHaveBeenCalledWith(
      'finding-1',
      'Retrained the officer.',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE' }),
    );
    expect(v.remediationAction).toBe('Retrained the officer.');
  });
});

describe('InternalAuditFindingService.close (Process 57)', () => {
  it('404s an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.close('nope', 'u-manager')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('is idempotent if already closed', async () => {
    const { service, repo } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(row({ status: 'closed' })) },
    });
    const v = await service.close('finding-1', 'u-manager');
    expect(v.status).toBe('closed');
    expect(repo.close).not.toHaveBeenCalled();
  });

  it('closes an open finding, stamping closedAt, and audits UPDATE', async () => {
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
    const v = await service.close('finding-1', 'u-manager');
    expect(repo.close).toHaveBeenCalledWith('finding-1', expect.any(Date));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE' }),
    );
    expect(v.status).toBe('closed');
  });
});

describe('InternalAuditFindingService reads (Process 57)', () => {
  it('get() 404s an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list() passes the status filter through to the repository', async () => {
    const { service, repo } = makeService();
    await service.list({ status: 'open' });
    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'open' }),
      expect.any(Number),
    );
  });
});

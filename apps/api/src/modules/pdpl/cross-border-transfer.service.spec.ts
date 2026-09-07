import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CrossBorderTransferService } from './cross-border-transfer.service';
import type { CrossBorderTransferRepository } from '../../repositories/cross-border-transfer.repository';
import type { AuditService } from '../audit/audit.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'cbt-1',
  description: 'Claims file shared with a UK reinsurer.',
  destinationCountry: 'United Kingdom',
  legalBasis: 'standard_contractual_clauses',
  legalBasisEvidenceRef: null,
  approvedByUserId: 'u-dpo',
  transferredAt: new Date('2026-09-07T00:00:00.000Z'),
  ...over,
});

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    create: vi.fn().mockResolvedValue(row()),
    findById: vi.fn().mockResolvedValue(row()),
    findMany: vi.fn().mockResolvedValue([row()]),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new CrossBorderTransferService(
    repo as unknown as CrossBorderTransferRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('CrossBorderTransferService.create', () => {
  it('stamps approvedByUserId to the caller — creation is approval', async () => {
    const { service, repo, audit } = makeService();
    const v = await service.create(
      {
        description: 'Claims file shared with a UK reinsurer.',
        destinationCountry: 'United Kingdom',
        legalBasis: 'standard_contractual_clauses',
      },
      'u-dpo',
    );
    expect(v.approvedByUserId).toBe('u-dpo');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ approvedByUserId: 'u-dpo' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'CrossBorderTransferRecord',
      }),
    );
  });

  it('rejects Jordan as a destination — this model only covers transfers outside Jordan', async () => {
    const { service } = makeService();
    await expect(
      service.create(
        {
          description: 'x',
          destinationCountry: 'Jordan',
          legalBasis: 'statutory_exception',
        },
        'u-dpo',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects Jordan case-insensitively and with surrounding whitespace', async () => {
    const { service } = makeService();
    await expect(
      service.create(
        {
          description: 'x',
          destinationCountry: ' JORDAN ',
          legalBasis: 'explicit_consent',
        },
        'u-dpo',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CrossBorderTransferService.get/list', () => {
  it('404s an unknown record', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists, forwarding legalBasis/destinationCountry filters', async () => {
    const { service, repo } = makeService();
    await service.list({
      legalBasis: 'explicit_consent',
      destinationCountry: 'Egypt',
    });
    expect(repo.findMany).toHaveBeenCalledWith(
      { legalBasis: 'explicit_consent', destinationCountry: 'Egypt' },
      expect.any(Number),
    );
  });
});

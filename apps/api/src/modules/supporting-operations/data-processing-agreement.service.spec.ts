import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataProcessingAgreementService } from './data-processing-agreement.service';
import type { DataProcessingAgreementRepository } from '../../repositories/data-processing-agreement.repository';
import type { VendorRepository } from '../../repositories/vendor.repository';
import type { AuditService } from '../audit/audit.service';

function baseDpa(over: Record<string, unknown> = {}) {
  return {
    id: 'dpa-1',
    vendorId: 'vendor-1',
    signedAt: null,
    assessedByUserId: 'assessor-1',
    dpoApprovedByUserId: null,
    expiresAt: null,
    ...over,
  };
}

function makeService(
  over: {
    dpaRepo?: Record<string, unknown>;
    vendorRepo?: Record<string, unknown>;
  } = {},
) {
  const dpaRepo = {
    create: vi.fn().mockResolvedValue(baseDpa()),
    findById: vi.fn().mockResolvedValue(baseDpa()),
    findByVendorId: vi.fn().mockResolvedValue([baseDpa()]),
    sign: vi.fn().mockResolvedValue(baseDpa({ signedAt: new Date() })),
    dpoApprove: vi
      .fn()
      .mockResolvedValue(baseDpa({ dpoApprovedByUserId: 'dpo-1' })),
    ...over.dpaRepo,
  };
  const vendorRepo = {
    findById: vi.fn().mockResolvedValue({ id: 'vendor-1' }),
    ...over.vendorRepo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new DataProcessingAgreementService(
    dpaRepo as unknown as DataProcessingAgreementRepository,
    vendorRepo as unknown as VendorRepository,
    audit as unknown as AuditService,
  );
  return { service, dpaRepo, vendorRepo, audit };
}

describe('DataProcessingAgreementService.create', () => {
  it('creates a DPA assessed by the actor and writes a CREATE audit row', async () => {
    const { service, dpaRepo, audit } = makeService();
    const result = await service.create('vendor-1', 'assessor-1');
    expect(dpaRepo.create).toHaveBeenCalledWith({
      vendorId: 'vendor-1',
      assessedByUserId: 'assessor-1',
    });
    expect(result.id).toBe('dpa-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'DataProcessingAgreement',
      }),
    );
  });

  it('404s creating a DPA for a non-existent vendor', async () => {
    const { service } = makeService({
      vendorRepo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.create('nope', 'assessor-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('DataProcessingAgreementService.listByVendor', () => {
  it('404s for a non-existent vendor', async () => {
    const { service } = makeService({
      vendorRepo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.listByVendor('nope')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('DataProcessingAgreementService.sign', () => {
  it('signs the DPA and writes an UPDATE audit row', async () => {
    const { service, dpaRepo, audit } = makeService();
    const result = await service.sign('dpa-1', 'assessor-1');
    expect(dpaRepo.sign).toHaveBeenCalledWith('dpa-1', expect.any(Date));
    expect(result.signedAt).toBeTruthy();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'DataProcessingAgreement',
      }),
    );
  });

  it('409s signing an already-signed DPA', async () => {
    const { service } = makeService({
      dpaRepo: { sign: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.sign('dpa-1', 'assessor-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('404s for an unknown DPA', async () => {
    const { service } = makeService({
      dpaRepo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.sign('nope', 'assessor-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('DataProcessingAgreementService.dpoApprove', () => {
  it('approves the DPA when the DPO differs from the assessor', async () => {
    const { service, dpaRepo, audit } = makeService();
    const result = await service.dpoApprove('dpa-1', 'dpo-1');
    expect(dpaRepo.dpoApprove).toHaveBeenCalledWith('dpa-1', 'dpo-1');
    expect(result.dpoApprovedByUserId).toBe('dpo-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'DataProcessingAgreement',
        isSensitiveDataAccess: true,
      }),
    );
  });

  it('rejects a self-approval (maker/checker)', async () => {
    const { service } = makeService();
    await expect(service.dpoApprove('dpa-1', 'assessor-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('409s approving an already-approved DPA', async () => {
    const { service } = makeService({
      dpaRepo: { dpoApprove: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.dpoApprove('dpa-1', 'dpo-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('404s for an unknown DPA', async () => {
    const { service } = makeService({
      dpaRepo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.dpoApprove('nope', 'dpo-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

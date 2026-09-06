import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { VendorService } from './vendor.service';
import type { VendorRepository } from '../../repositories/vendor.repository';
import type { AuditService } from '../audit/audit.service';

function baseVendor(over: Record<string, unknown> = {}) {
  return {
    id: 'vendor-1',
    name: 'Acme Office Supplies',
    vendorType: 'other',
    riskTier: null,
    annualReviewDueAt: null,
    terminationDataReturnConfirmedAt: null,
    accessRevokedAt: null,
    createdAt: new Date('2026-09-18T09:00:00.000Z'),
    ...over,
  };
}

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    create: vi.fn().mockResolvedValue(baseVendor()),
    findById: vi.fn().mockResolvedValue(baseVendor()),
    findMany: vi.fn().mockResolvedValue([baseVendor()]),
    update: vi.fn().mockResolvedValue(baseVendor({ name: 'Renamed Vendor' })),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new VendorService(
    repo as unknown as VendorRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('VendorService.create', () => {
  it('creates a vendor and writes a CREATE audit row', async () => {
    const { service, repo, audit } = makeService();
    const result = await service.create(
      { name: 'Acme Office Supplies', vendorType: 'other' },
      'actor-1',
    );
    expect(repo.create).toHaveBeenCalledWith({
      name: 'Acme Office Supplies',
      vendorType: 'other',
    });
    expect(result.id).toBe('vendor-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entityType: 'Vendor' }),
    );
  });

  it('does not fail the create if the audit write itself fails', async () => {
    const { service, audit } = makeService();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(
      service.create({ name: 'X', vendorType: 'other' }, 'actor-1'),
    ).resolves.toBeDefined();
  });
});

describe('VendorService.list', () => {
  it('passes the optional vendorType filter through', async () => {
    const { service, repo } = makeService();
    await service.list({ vendorType: 'other' });
    expect(repo.findMany).toHaveBeenCalledWith({ vendorType: 'other' });
  });

  it('lists with no filter when none is given', async () => {
    const { service, repo } = makeService();
    await service.list({});
    expect(repo.findMany).toHaveBeenCalledWith({ vendorType: undefined });
  });
});

describe('VendorService.get', () => {
  it('returns the vendor', async () => {
    const { service } = makeService();
    const vendor = await service.get('vendor-1');
    expect(vendor.id).toBe('vendor-1');
  });

  it('404s for an unknown vendor', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toThrow(NotFoundException);
  });
});

describe('VendorService.update', () => {
  it('updates the vendor and writes an UPDATE audit row', async () => {
    const { service, repo, audit } = makeService();
    const result = await service.update(
      'vendor-1',
      { name: 'Renamed Vendor' },
      'actor-1',
    );
    expect(repo.update).toHaveBeenCalledWith('vendor-1', {
      name: 'Renamed Vendor',
      vendorType: undefined,
    });
    expect(result.name).toBe('Renamed Vendor');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entityType: 'Vendor' }),
    );
  });

  it('404s updating an unknown vendor', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.update('nope', { name: 'X' }, 'actor-1'),
    ).rejects.toThrow(NotFoundException);
  });
});

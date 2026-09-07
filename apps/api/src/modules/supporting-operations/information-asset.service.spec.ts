import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { InformationAssetService } from './information-asset.service';
import type { InformationAssetRepository } from '../../repositories/information-asset.repository';
import type { UserRepository } from '../../repositories/user.repository';
import type { AuditService } from '../audit/audit.service';

function baseAsset(over: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    name: 'Customer Database',
    assetType: 'customer_data',
    ownerUserId: 'user-1',
    classification: 'HIGHLY_CONFIDENTIAL',
    createdAt: new Date('2026-09-20T09:00:00.000Z'),
    ...over,
  };
}

function makeService(
  over: {
    repo?: Record<string, unknown>;
    users?: Record<string, unknown>;
  } = {},
) {
  const repo = {
    create: vi.fn().mockResolvedValue(baseAsset()),
    findById: vi.fn().mockResolvedValue(baseAsset()),
    findMany: vi.fn().mockResolvedValue([baseAsset()]),
    update: vi.fn().mockResolvedValue(baseAsset({ name: 'Renamed Asset' })),
    ...over.repo,
  };
  const users = {
    findById: vi.fn().mockResolvedValue({ id: 'user-1' }),
    ...over.users,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new InformationAssetService(
    repo as unknown as InformationAssetRepository,
    users as unknown as UserRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, users, audit };
}

describe('InformationAssetService.create', () => {
  it('creates an asset and writes a CREATE audit row', async () => {
    const { service, repo, audit } = makeService();
    const result = await service.create(
      {
        name: 'Customer Database',
        assetType: 'customer_data',
        ownerUserId: 'user-1',
        classification: 'HIGHLY_CONFIDENTIAL',
      },
      'actor-1',
    );
    expect(repo.create).toHaveBeenCalledWith({
      name: 'Customer Database',
      assetType: 'customer_data',
      ownerUserId: 'user-1',
      classification: 'HIGHLY_CONFIDENTIAL',
    });
    expect(result.id).toBe('asset-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'InformationAsset',
      }),
    );
  });

  it('404s when ownerUserId does not reference a real user', async () => {
    const { service } = makeService({
      users: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.create(
        {
          name: 'X',
          assetType: 'other',
          ownerUserId: 'nope',
          classification: 'PUBLIC',
        },
        'actor-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('does not fail the create if the audit write itself fails', async () => {
    const { service, audit } = makeService();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(
      service.create(
        {
          name: 'X',
          assetType: 'other',
          ownerUserId: 'user-1',
          classification: 'PUBLIC',
        },
        'actor-1',
      ),
    ).resolves.toBeDefined();
  });
});

describe('InformationAssetService.list', () => {
  it('passes both optional filters through', async () => {
    const { service, repo } = makeService();
    await service.list({
      assetType: 'customer_data',
      classification: 'HIGHLY_CONFIDENTIAL',
    });
    expect(repo.findMany).toHaveBeenCalledWith({
      assetType: 'customer_data',
      classification: 'HIGHLY_CONFIDENTIAL',
    });
  });
});

describe('InformationAssetService.get', () => {
  it('returns the asset', async () => {
    const { service } = makeService();
    const asset = await service.get('asset-1');
    expect(asset.id).toBe('asset-1');
  });

  it('404s for an unknown asset', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toThrow(NotFoundException);
  });
});

describe('InformationAssetService.update', () => {
  it('updates the asset and writes an UPDATE audit row', async () => {
    const { service, repo, audit } = makeService();
    const result = await service.update(
      'asset-1',
      { name: 'Renamed Asset' },
      'actor-1',
    );
    expect(repo.update).toHaveBeenCalledWith('asset-1', {
      name: 'Renamed Asset',
      assetType: undefined,
      ownerUserId: undefined,
      classification: undefined,
    });
    expect(result.name).toBe('Renamed Asset');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'InformationAsset',
      }),
    );
  });

  it('404s updating an unknown asset', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.update('nope', { name: 'X' }, 'actor-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('404s reassigning ownership to a non-existent user', async () => {
    const { service } = makeService({
      users: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.update('asset-1', { ownerUserId: 'nope' }, 'actor-1'),
    ).rejects.toThrow(NotFoundException);
  });
});

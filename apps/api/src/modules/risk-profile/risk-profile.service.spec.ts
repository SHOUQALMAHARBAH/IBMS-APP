import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { RiskProfileService } from './risk-profile.service';
import type { RiskProfileRepository } from '../../repositories/risk-profile.repository';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';

function makeUser(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'sales-1',
    email: 'sales@ibms.test',
    roles: ['SALES_RELATIONSHIP_OFFICER'],
    sessionId: 'session-1',
    ...overrides,
  };
}

function assetRow(overrides?: Record<string, unknown>) {
  return {
    id: 'asset-1',
    riskProfileId: 'rp-1',
    assetType: 'building',
    description: null,
    declaredValue: null as Prisma.Decimal | null,
    annualGrossProfit: null as Prisma.Decimal | null,
    indemnityPeriodMonths: null as number | null,
    fleetVehicleCount: null as number | null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeDeps() {
  const create = vi
    .fn()
    .mockImplementation((input) =>
      Promise.resolve({ id: 'rp-1', createdAt: new Date(), ...input }),
    );
  const findById = vi.fn();
  const findManyByCustomerId = vi.fn().mockResolvedValue([]);
  const createAsset = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(assetRow({ id: 'asset-new', ...input })),
    );
  const findAssetById = vi.fn();
  const findAssetsByRiskProfileId = vi.fn().mockResolvedValue([]);
  const findAssetsByCustomerId = vi.fn().mockResolvedValue([]);
  const updateAsset = vi
    .fn()
    .mockImplementation((id: string, data: Record<string, unknown>) =>
      Promise.resolve(assetRow({ id, ...data })),
    );
  const deleteAsset = vi.fn().mockResolvedValue(assetRow());
  const riskProfiles = {
    create,
    findById,
    findManyByCustomerId,
    createAsset,
    findAssetById,
    findAssetsByRiskProfileId,
    findAssetsByCustomerId,
    updateAsset,
    deleteAsset,
  } as unknown as RiskProfileRepository;

  const findCustomerById = vi
    .fn()
    .mockResolvedValue({ id: 'cust-1', ownerUserId: 'sales-1' });
  const customers = {
    findById: findCustomerById,
  } as unknown as CustomerRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  return {
    service: new RiskProfileService(riskProfiles, customers, audit),
    mocks: {
      create,
      findById,
      findManyByCustomerId,
      createAsset,
      findAssetById,
      findAssetsByRiskProfileId,
      findAssetsByCustomerId,
      updateAsset,
      deleteAsset,
      findCustomerById,
      record,
    },
  };
}

describe('RiskProfileService', () => {
  describe('create', () => {
    it('creates a minimal risk profile for a customer the Sales Officer owns', async () => {
      const { service, mocks } = makeDeps();
      await service.create(
        { customerId: 'cust-1', siteLabel: 'HQ' },
        makeUser(),
      );
      expect(mocks.create).toHaveBeenCalledWith({
        customerId: 'cust-1',
        siteLabel: 'HQ',
        priorClaimsHistorySummary: undefined,
      });
    });

    it("hides another Sales Officer's customer behind a NotFoundException", async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-2',
      });
      await expect(
        service.create({ customerId: 'cust-1' }, makeUser({ id: 'sales-1' })),
      ).rejects.toThrow(NotFoundException);
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it('lets a Placement/Technical Officer create against any customer', async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-9',
      });
      await service.create(
        { customerId: 'cust-1' },
        makeUser({ id: 'placement-1', roles: ['PLACEMENT_TECHNICAL_OFFICER'] }),
      );
      expect(mocks.create).toHaveBeenCalled();
    });

    it('still returns the row when the audit write fails', async () => {
      const { service, mocks } = makeDeps();
      mocks.record.mockRejectedValueOnce(new Error('audit down'));
      const result = await service.create({ customerId: 'cust-1' }, makeUser());
      expect(result.id).toBe('rp-1');
    });
  });

  describe('list / get', () => {
    it('scopes list to a customer the caller can see', async () => {
      const { service, mocks } = makeDeps();
      await service.list('cust-1', makeUser());
      expect(mocks.findManyByCustomerId).toHaveBeenCalledWith('cust-1');
    });

    it('404s a get when the underlying customer is not visible', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'rp-1', customerId: 'cust-1' });
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-2',
      });
      await expect(
        service.get('rp-1', makeUser({ id: 'sales-1' })),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the asset survey and the derived Sum Insured on get', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'rp-1', customerId: 'cust-1' });
      mocks.findAssetsByRiskProfileId.mockResolvedValue([
        assetRow({
          assetType: 'building',
          declaredValue: new Prisma.Decimal('500000'),
        }),
        assetRow({
          assetType: 'vehicle',
          declaredValue: null,
          fleetVehicleCount: 6,
        }),
      ]);
      const result = await service.get('rp-1', makeUser());
      expect(result.assets).toHaveLength(2);
      expect(result.sumInsured.propertySumInsured).toBe('500000.000');
      expect(result.sumInsured.fleetVehicleCount).toBe(6);
    });
  });

  describe('addAsset', () => {
    it('quantizes the money fields and audits an Asset CREATE', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'rp-1', customerId: 'cust-1' });
      await service.addAsset(
        'rp-1',
        { assetType: 'building', declaredValue: '500000.5' },
        makeUser(),
      );
      const passed = mocks.createAsset.mock.calls[0][0] as {
        declaredValue: Prisma.Decimal;
      };
      expect(passed.declaredValue.toString()).toBe('500000.5');
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Asset' }),
      );
    });

    it("404s when the risk profile's customer is not visible", async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'rp-1', customerId: 'cust-1' });
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-2',
      });
      await expect(
        service.addAsset(
          'rp-1',
          { assetType: 'building', declaredValue: '1000' },
          makeUser({ id: 'sales-1' }),
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mocks.createAsset).not.toHaveBeenCalled();
    });

    it('404s when the risk profile does not exist', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(null);
      await expect(
        service.addAsset(
          'missing',
          { assetType: 'building', declaredValue: '1000' },
          makeUser(),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateAsset / removeAsset', () => {
    it('404s updating an asset that hangs off a different risk profile', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'rp-1', customerId: 'cust-1' });
      mocks.findAssetById.mockResolvedValue(
        assetRow({ id: 'asset-9', riskProfileId: 'rp-OTHER' }),
      );
      await expect(
        service.updateAsset(
          'rp-1',
          'asset-9',
          { assetType: 'stock', declaredValue: '5' },
          makeUser(),
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mocks.updateAsset).not.toHaveBeenCalled();
    });

    it('deletes an asset and audits an Asset DELETE', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'rp-1', customerId: 'cust-1' });
      mocks.findAssetById.mockResolvedValue(
        assetRow({ id: 'asset-1', riskProfileId: 'rp-1' }),
      );
      await service.removeAsset('rp-1', 'asset-1', makeUser());
      expect(mocks.deleteAsset).toHaveBeenCalledWith('asset-1');
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE', entityType: 'Asset' }),
      );
    });
  });

  describe('getConsolidated', () => {
    it('groups assets by site and rolls up the consolidated Sum Insured', async () => {
      const { service, mocks } = makeDeps();
      mocks.findManyByCustomerId.mockResolvedValue([
        { id: 'rp-1', siteLabel: 'HQ' },
        { id: 'rp-2', siteLabel: 'Aqaba' },
      ]);
      mocks.findAssetsByCustomerId.mockResolvedValue([
        assetRow({
          id: 'a1',
          riskProfileId: 'rp-1',
          declaredValue: new Prisma.Decimal('500000'),
        }),
        assetRow({
          id: 'a2',
          riskProfileId: 'rp-2',
          assetType: 'stock',
          declaredValue: new Prisma.Decimal('150000'),
        }),
      ]);
      const result = await service.getConsolidated('cust-1', makeUser());
      expect(result.sites.map((s) => s.siteLabel)).toEqual(['HQ', 'Aqaba']);
      expect(result.consolidated.propertySumInsured).toBe('650000.000');
      expect(result.consolidated.siteCount).toBe(2);
    });
  });
});

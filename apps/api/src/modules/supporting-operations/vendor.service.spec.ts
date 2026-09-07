import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { VendorService } from './vendor.service';
import type { VendorRepository } from '../../repositories/vendor.repository';
import type { DataProcessingAgreementRepository } from '../../repositories/data-processing-agreement.repository';
import type { SlaTimerService } from '../sla/sla-timer.service';
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

function makeService(
  over: {
    repo?: Record<string, unknown>;
    dpaRepo?: Record<string, unknown>;
    sla?: Record<string, unknown>;
  } = {},
) {
  const repo = {
    create: vi.fn().mockResolvedValue(baseVendor()),
    findById: vi.fn().mockResolvedValue(baseVendor()),
    findMany: vi.fn().mockResolvedValue([baseVendor()]),
    update: vi.fn().mockResolvedValue(baseVendor({ name: 'Renamed Vendor' })),
    setRiskTier: vi.fn().mockResolvedValue(baseVendor({ riskTier: 'medium' })),
    scheduleAnnualReview: vi.fn().mockResolvedValue(
      baseVendor({
        riskTier: 'medium',
        annualReviewDueAt: new Date('2027-09-18T09:00:00.000Z'),
      }),
    ),
    terminate: vi.fn().mockResolvedValue(
      baseVendor({
        terminationDataReturnConfirmedAt: new Date('2026-09-20T09:00:00.000Z'),
      }),
    ),
    revokeAccess: vi.fn().mockResolvedValue(
      baseVendor({
        terminationDataReturnConfirmedAt: new Date('2026-09-20T09:00:00.000Z'),
        accessRevokedAt: new Date('2026-09-21T09:00:00.000Z'),
      }),
    ),
    ...over.repo,
  };
  const dpaRepo = {
    findActiveByVendorId: vi.fn().mockResolvedValue(null),
    ...over.dpaRepo,
  };
  const sla = {
    computeDueAt: vi.fn().mockReturnValue(new Date('2027-09-18T09:00:00.000Z')),
    startTimer: vi.fn().mockResolvedValue([]),
    resolve: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.sla,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new VendorService(
    repo as unknown as VendorRepository,
    dpaRepo as unknown as DataProcessingAgreementRepository,
    sla as unknown as SlaTimerService,
    audit as unknown as AuditService,
  );
  return { service, repo, dpaRepo, sla, audit };
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

describe('VendorService.setRiskTier', () => {
  it('sets the tier and auto-schedules the annual review on a first Medium/High tiering', async () => {
    const { service, repo, sla } = makeService();
    const result = await service.setRiskTier(
      'vendor-1',
      { riskTier: 'medium' },
      'actor-1',
    );
    expect(repo.setRiskTier).toHaveBeenCalledWith('vendor-1', 'medium');
    expect(sla.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowName: 'vendor_annual_review',
        entityId: 'vendor-1',
      }),
    );
    expect(result.riskTier).toBe('medium');
  });

  it('does not re-schedule when a review is already scheduled', async () => {
    const { service, repo, sla } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            baseVendor({ riskTier: 'medium', annualReviewDueAt: new Date() }),
          ),
      },
    });
    await service.setRiskTier('vendor-1', { riskTier: 'high' }, 'actor-1');
    expect(repo.scheduleAnnualReview).not.toHaveBeenCalled();
    expect(sla.startTimer).not.toHaveBeenCalled();
  });

  it('does not schedule a review for Low tier', async () => {
    const { service, repo } = makeService();
    await service.setRiskTier('vendor-1', { riskTier: 'low' }, 'actor-1');
    expect(repo.scheduleAnnualReview).not.toHaveBeenCalled();
  });

  it('404s for an unknown vendor', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.setRiskTier('nope', { riskTier: 'low' }, 'actor-1'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('VendorService.recordAnnualReview', () => {
  it('resolves the old timer and starts a new one 12 months out', async () => {
    const { service, repo, sla } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            baseVendor({ riskTier: 'medium', annualReviewDueAt: new Date() }),
          ),
      },
    });
    await service.recordAnnualReview('vendor-1', 'actor-1');
    expect(sla.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: 'vendor_annual_review' }),
    );
    expect(sla.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: 'vendor_annual_review' }),
    );
    expect(repo.scheduleAnnualReview).toHaveBeenCalled();
  });

  it('422s when no review is currently scheduled', async () => {
    const { service } = makeService();
    await expect(
      service.recordAnnualReview('vendor-1', 'actor-1'),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('404s for an unknown vendor', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.recordAnnualReview('nope', 'actor-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('VendorService.terminate', () => {
  it('422s without an explicit confirmDataReturnOrDestruction attestation', async () => {
    const { service } = makeService();
    await expect(service.terminate('vendor-1', {}, 'actor-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('stamps terminationDataReturnConfirmedAt and starts the access-revocation SLA timer', async () => {
    const { service, repo, sla } = makeService();
    const result = await service.terminate(
      'vendor-1',
      { confirmDataReturnOrDestruction: true },
      'actor-1',
    );
    expect(repo.terminate).toHaveBeenCalledWith('vendor-1', expect.any(Date));
    expect(sla.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowName: 'vendor_termination_access_revocation',
      }),
    );
    expect(result.terminationDataReturnConfirmedAt).toBeTruthy();
  });

  it('409s terminating an already-terminated vendor', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            baseVendor({ terminationDataReturnConfirmedAt: new Date() }),
          ),
      },
    });
    await expect(
      service.terminate(
        'vendor-1',
        { confirmDataReturnOrDestruction: true },
        'actor-1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('404s for an unknown vendor', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.terminate(
        'nope',
        { confirmDataReturnOrDestruction: true },
        'actor-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('VendorService.revokeAccess', () => {
  it('422s revoking access before termination', async () => {
    const { service } = makeService();
    await expect(service.revokeAccess('vendor-1', 'actor-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('stamps accessRevokedAt and resolves the SLA timer', async () => {
    const { service, repo, sla } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            baseVendor({ terminationDataReturnConfirmedAt: new Date() }),
          ),
      },
    });
    const result = await service.revokeAccess('vendor-1', 'actor-1');
    expect(repo.revokeAccess).toHaveBeenCalledWith(
      'vendor-1',
      expect.any(Date),
    );
    expect(sla.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowName: 'vendor_termination_access_revocation',
      }),
    );
    expect(result.accessRevokedAt).toBeTruthy();
  });

  it('409s revoking access twice', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(
          baseVendor({
            terminationDataReturnConfirmedAt: new Date(),
            accessRevokedAt: new Date(),
          }),
        ),
      },
    });
    await expect(service.revokeAccess('vendor-1', 'actor-1')).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('VendorService.dataShareReadiness', () => {
  it('is not ready when no risk tier is assigned', async () => {
    const { service } = makeService();
    const result = await service.dataShareReadiness('vendor-1');
    expect(result.ready).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('is ready for Low tier with no DPA', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(baseVendor({ riskTier: 'low' })),
      },
    });
    const result = await service.dataShareReadiness('vendor-1');
    expect(result.ready).toBe(true);
  });

  it('is not ready for Medium tier with no signed DPA', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(baseVendor({ riskTier: 'medium' })),
      },
    });
    const result = await service.dataShareReadiness('vendor-1');
    expect(result.ready).toBe(false);
  });

  it('is ready for High tier once a DPO-approved DPA is on file', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(baseVendor({ riskTier: 'high' })),
      },
      dpaRepo: {
        findActiveByVendorId: vi.fn().mockResolvedValue({
          id: 'dpa-1',
          signedAt: new Date(),
          dpoApprovedByUserId: 'dpo-1',
        }),
      },
    });
    const result = await service.dataShareReadiness('vendor-1');
    expect(result.ready).toBe(true);
  });

  it('404s for an unknown vendor', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.dataShareReadiness('nope')).rejects.toThrow(
      NotFoundException,
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSharingApprovalService } from './data-sharing-approval.service';
import type { DataSharingApprovalRepository } from '../../repositories/data-sharing-approval.repository';
import type { VendorRepository } from '../../repositories/vendor.repository';
import type { DataProcessingAgreementRepository } from '../../repositories/data-processing-agreement.repository';
import type { SlaTimerService } from '../sla/sla-timer.service';
import type { AuditService } from '../audit/audit.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'dsa-1',
  vendorId: null,
  description:
    'Claims documents shared with a loss adjuster for a large fire claim.',
  classification: 'CONFIDENTIAL',
  channel: 'ENCRYPTED_EMAIL',
  isRegulatoryChannel: false,
  requestedByUserId: 'u-req',
  approvedByUserId: null,
  slaDueAt: new Date('2026-09-10T00:00:00.000Z'),
  decidedAt: null,
  createdAt: new Date('2026-09-07T00:00:00.000Z'),
  ...over,
});

function makeService(
  over: {
    repo?: Record<string, unknown>;
    vendors?: Record<string, unknown>;
    dpas?: Record<string, unknown>;
    slaTimer?: Record<string, unknown>;
  } = {},
) {
  const repo = {
    create: vi.fn().mockResolvedValue(row()),
    findById: vi.fn().mockResolvedValue(row()),
    findMany: vi.fn().mockResolvedValue([row()]),
    approve: vi.fn().mockResolvedValue({ count: 1 }),
    decline: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.repo,
  };
  const vendors = {
    findById: vi.fn().mockResolvedValue({ id: 'vendor-1', riskTier: 'low' }),
    ...over.vendors,
  };
  const dpas = {
    findActiveByVendorId: vi.fn().mockResolvedValue(null),
    ...over.dpas,
  };
  const slaTimer = {
    computeDueAt: vi.fn().mockReturnValue(new Date('2026-09-10T00:00:00.000Z')),
    startTimer: vi.fn().mockResolvedValue([{ id: 'sla-1' }]),
    resolve: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.slaTimer,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new DataSharingApprovalService(
    repo as unknown as DataSharingApprovalRepository,
    vendors as unknown as VendorRepository,
    dpas as unknown as DataProcessingAgreementRepository,
    slaTimer as unknown as SlaTimerService,
    audit as unknown as AuditService,
  );
  return { service, repo, vendors, dpas, slaTimer, audit };
}

const baseDto = {
  description:
    'Claims documents shared with a loss adjuster for a large fire claim.',
  classification: 'CONFIDENTIAL' as const,
  channel: 'ENCRYPTED_EMAIL' as const,
};

describe('DataSharingApprovalService.create', () => {
  it('rejects an insecure channel for CONFIDENTIAL data before touching the repo', async () => {
    const { service, repo } = makeService();
    await expect(
      service.create({ ...baseDto, channel: 'UNENCRYPTED_EMAIL' }, 'u-req'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('with no vendorId, skips the readiness check entirely and creates', async () => {
    const { service, repo, vendors, slaTimer } = makeService();
    const v = await service.create(baseDto, 'u-req');
    expect(vendors.findById).not.toHaveBeenCalled();
    expect(v.requestedByUserId).toBe('u-req');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ vendorId: null, requestedByUserId: 'u-req' }),
    );
    expect(slaTimer.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: 'data_sharing_decision' }),
    );
  });

  it('404s an unknown vendorId', async () => {
    const { service } = makeService({
      vendors: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.create({ ...baseDto, vendorId: 'nope' }, 'u-req'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('422s when the vendor is not data-share-ready (Medium tier, no DPA)', async () => {
    const { service } = makeService({
      vendors: {
        findById: vi.fn().mockResolvedValue({ id: 'v-1', riskTier: 'medium' }),
      },
    });
    await expect(
      service.create({ ...baseDto, vendorId: 'v-1' }, 'u-req'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('skips the vendor-readiness check for a regulatory channel even when the vendor is not ready', async () => {
    const { service, repo, dpas } = makeService({
      vendors: {
        findById: vi.fn().mockResolvedValue({ id: 'v-1', riskTier: 'high' }),
      },
    });
    await service.create(
      {
        ...baseDto,
        vendorId: 'v-1',
        channel: 'CBJ_REGULATORY_PORTAL',
        isRegulatoryChannel: true,
      },
      'u-req',
    );
    expect(dpas.findActiveByVendorId).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ vendorId: 'v-1', isRegulatoryChannel: true }),
    );
  });

  it('computes slaDueAt via the regulatory-channel-aware SLA lookup', async () => {
    const { service, slaTimer } = makeService();
    await service.create({ ...baseDto, isRegulatoryChannel: true }, 'u-req');
    expect(slaTimer.computeDueAt).toHaveBeenCalledWith(
      'data_sharing_decision',
      expect.any(Date),
      { regulatoryChannel: true },
    );
  });
});

describe('DataSharingApprovalService.approve/decline', () => {
  it('403s a same-actor approval attempt', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ requestedByUserId: 'u-req' })),
      },
    });
    await expect(service.approve('dsa-1', 'u-req')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('approves, stamping approvedByUserId and resolving the SLA timer', async () => {
    const { service, repo, slaTimer } = makeService();
    const v = await service.approve('dsa-1', 'u-dpo');
    expect(repo.approve).toHaveBeenCalledWith(
      'dsa-1',
      'u-dpo',
      expect.any(Date),
    );
    expect(slaTimer.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: 'data_sharing_decision' }),
    );
    expect(v).toBeDefined();
  });

  it('422s approving an already-decided request', async () => {
    const { service } = makeService({
      repo: { approve: vi.fn().mockResolvedValue({ count: 0 }) },
    });
    await expect(service.approve('dsa-1', 'u-dpo')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('declines, leaving approvedByUserId untouched, and resolves the SLA timer', async () => {
    const { service, repo, slaTimer } = makeService();
    await service.decline('dsa-1', 'u-dpo');
    expect(repo.decline).toHaveBeenCalledWith('dsa-1', expect.any(Date));
    expect(slaTimer.resolve).toHaveBeenCalled();
  });

  it('422s declining an already-decided request', async () => {
    const { service } = makeService({
      repo: { decline: vi.fn().mockResolvedValue({ count: 0 }) },
    });
    await expect(service.decline('dsa-1', 'u-dpo')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});

describe('DataSharingApprovalService.get/list', () => {
  it('404s an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists, forwarding filters', async () => {
    const { service, repo } = makeService();
    await service.list({ vendorId: 'v-1', pendingOnly: true });
    expect(repo.findMany).toHaveBeenCalledWith(
      { vendorId: 'v-1', classification: undefined, pendingOnly: true },
      expect.any(Number),
    );
  });
});

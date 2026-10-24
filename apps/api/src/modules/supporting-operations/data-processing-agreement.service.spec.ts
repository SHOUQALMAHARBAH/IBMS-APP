import { describe, expect, it, vi } from 'vitest';
import { segregatedOfficeDutySegregation } from '../duty-segregation/duty-segregation.double';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataProcessingAgreementService } from './data-processing-agreement.service';
import type { DataProcessingAgreementRepository } from '../../repositories/data-processing-agreement.repository';
import type { VendorRepository } from '../../repositories/vendor.repository';
import type { AuditService } from '../audit/audit.service';
import type { UserRepository } from '../../repositories/user.repository';

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
    users?: Record<string, unknown>;
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
  // The SHARED double, not a local `mockResolvedValue(null)`: a permissive mock would make this file's
  // own self-approval assertions pass on the mock rather than on the code.
  const dutySegregation = segregatedOfficeDutySegregation();

  /* Item 4(a) — decision 48's resolver. A REAL Map rather than an empty one, so a test asserting
   * the assessor's or approver's name observes the code rather than the double. */
  const users = {
    displayNamesForUserIds: vi.fn().mockResolvedValue(
      new Map([
        ['assessor-1', 'سامر عبدالله الحوراني'],
        ['dpo-1', 'ليلى محمود الزعبي'],
      ]),
    ),
    ...over.users,
  };
  const service = new DataProcessingAgreementService(
    dpaRepo as unknown as DataProcessingAgreementRepository,
    users as unknown as UserRepository,
    vendorRepo as unknown as VendorRepository,
    audit as unknown as AuditService,
    dutySegregation,
  );
  return { service, dpaRepo, vendorRepo, audit, users };
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
    expect(dpaRepo.dpoApprove).toHaveBeenCalledWith('dpa-1', 'dpo-1', null);
    expect(result.dpoApprovedByUserId).toBe('dpo-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'DataProcessingAgreement',
        isSensitiveDataAccess: true,
      }),
    );
  });

  /*
   * ITEM 4(a) — THE TWO PEOPLE BY NAME, ON ALL FOUR PATHS, AND THIS ASSERTION IS HERE BECAUSE A
   * PLAYWRIGHT TEST CANNOT SEE IT. Planting `dpoApprovedByName: r.dpoApprovedByUserId` — sending
   * the uuid as the name, the realistic edit because it always produces something to render — left
   * `vendor-detail.spec.ts` at 7/7, because that spec MOCKS the endpoint and so supplies the field
   * itself. A mocked endpoint cannot drop a field the api dropped. This is the layer that can.
   *
   * BOTH SIDES AND BOTH BRANCHES: the resolved name, and NO name rather than the uuid when the
   * account is gone. A test asserting only the resolved name would pass against the `?? id`
   * fallback, which is the whole defect.
   */
  it('names the assessor and the approver, and never falls back to a uuid', async () => {
    const { service, users } = makeService();
    const approved = await service.dpoApprove('dpa-1', 'dpo-1');
    expect(approved.assessedByName).toBe('سامر عبدالله الحوراني');
    expect(approved.dpoApprovedByName).toBe('ليلى محمود الزعبي');
    expect(approved.dpoApprovedByName).not.toBe(approved.dpoApprovedByUserId);
    // ONE batched resolve, both ids in one call — not two lookups per row.
    expect(users.displayNamesForUserIds).toHaveBeenCalledTimes(1);

    const { service: svc2 } = makeService({
      users: { displayNamesForUserIds: vi.fn().mockResolvedValue(new Map()) },
    });
    const unnamed = await svc2.dpoApprove('dpa-1', 'dpo-1');
    expect(unnamed.dpoApprovedByName).toBeNull();
    expect(unnamed.assessedByName).toBeNull();
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

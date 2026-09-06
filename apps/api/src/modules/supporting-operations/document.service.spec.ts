import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { DocumentService } from './document.service';
import type { DocumentRepository } from '../../repositories/document.repository';
import type { PolicyRepository } from '../../repositories/policy.repository';
import type { AuditService } from '../audit/audit.service';

function baseDocument(over: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    policyId: 'policy-1',
    customerId: null,
    category: 'POLICY',
    classification: 'CONFIDENTIAL',
    fileName: 'schedule.pdf',
    storageRef: 'obj://schedule-v1',
    versionNumber: 1,
    previousVersionId: null,
    uploadedByUserId: 'user-1',
    deletionLocked: true,
    deletionOverrideByUserId: null,
    createdAt: new Date('2026-09-20T09:00:00.000Z'),
    ...over,
  };
}

function makeService(
  over: {
    docs?: Record<string, unknown>;
    policies?: Record<string, unknown>;
  } = {},
) {
  const docs = {
    findById: vi.fn().mockResolvedValue(baseDocument()),
    findMany: vi.fn().mockResolvedValue([baseDocument()]),
    hasSuccessor: vi.fn().mockResolvedValue(false),
    hasClaimLink: vi.fn().mockResolvedValue(false),
    createVersion: vi.fn().mockResolvedValue(
      baseDocument({
        id: 'doc-2',
        versionNumber: 2,
        previousVersionId: 'doc-1',
      }),
    ),
    setDeletionOverride: vi.fn().mockResolvedValue(
      baseDocument({
        deletionLocked: false,
        deletionOverrideByUserId: 'admin-1',
      }),
    ),
    deleteIfUnlocked: vi.fn().mockResolvedValue(true),
    classificationsByPolicyId: vi
      .fn()
      .mockResolvedValue([{ classification: 'CONFIDENTIAL' }]),
    ...over.docs,
  };
  const policies = {
    findById: vi.fn().mockResolvedValue({ id: 'policy-1' }),
    ...over.policies,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new DocumentService(
    docs as unknown as DocumentRepository,
    policies as unknown as PolicyRepository,
    audit as unknown as AuditService,
  );
  return { service, docs, policies, audit };
}

describe('DocumentService.createVersion', () => {
  it('creates a new version inheriting policyId/customerId/category', async () => {
    const { service, docs, audit } = makeService();
    const result = await service.createVersion(
      'doc-1',
      {
        classification: 'HIGHLY_CONFIDENTIAL',
        fileName: 'schedule-v2.pdf',
        storageRef: 'obj://v2',
      },
      'actor-1',
    );
    expect(docs.createVersion).toHaveBeenCalledWith({
      policyId: 'policy-1',
      customerId: null,
      category: 'POLICY',
      classification: 'HIGHLY_CONFIDENTIAL',
      fileName: 'schedule-v2.pdf',
      storageRef: 'obj://v2',
      versionNumber: 2,
      previousVersionId: 'doc-1',
      uploadedByUserId: 'actor-1',
    });
    expect(result.id).toBe('doc-2');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entityType: 'Document' }),
    );
  });

  it('404s on an unknown document', async () => {
    const { service } = makeService({
      docs: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.createVersion(
        'nope',
        { classification: 'PUBLIC', fileName: 'x', storageRef: 'y' },
        'actor-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('422s when the target document has already been superseded', async () => {
    const { service } = makeService({
      docs: { hasSuccessor: vi.fn().mockResolvedValue(true) },
    });
    await expect(
      service.createVersion(
        'doc-1',
        { classification: 'PUBLIC', fileName: 'x', storageRef: 'y' },
        'actor-1',
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('409s when a concurrent version creation wins the DB unique-constraint race', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('conflict', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const { service } = makeService({
      docs: { createVersion: vi.fn().mockRejectedValue(p2002) },
    });
    await expect(
      service.createVersion(
        'doc-1',
        { classification: 'PUBLIC', fileName: 'x', storageRef: 'y' },
        'actor-1',
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('DocumentService.overrideDeletionLock', () => {
  it('unlocks the document and writes an UPDATE audit row', async () => {
    const { service, docs, audit } = makeService();
    const result = await service.overrideDeletionLock('doc-1', 'admin-1');
    expect(docs.setDeletionOverride).toHaveBeenCalledWith('doc-1', 'admin-1');
    expect(result.deletionLocked).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'Document',
        isSensitiveDataAccess: true,
      }),
    );
  });

  it('404s on an unknown document', async () => {
    const { service } = makeService({
      docs: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.overrideDeletionLock('nope', 'admin-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('409s when already unlocked (a concurrent override lost the status-conditional write)', async () => {
    const { service } = makeService({
      docs: { setDeletionOverride: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.overrideDeletionLock('doc-1', 'admin-1'),
    ).rejects.toThrow(ConflictException);
  });
});

describe('DocumentService.remove', () => {
  it('404s on an unknown document', async () => {
    const { service } = makeService({
      docs: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.remove('nope', 'admin-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('409s while the document is still locked', async () => {
    const { service } = makeService({
      docs: {
        findById: vi
          .fn()
          .mockResolvedValue(baseDocument({ deletionLocked: true })),
      },
    });
    await expect(service.remove('doc-1', 'admin-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('409s when a newer version exists', async () => {
    const { service } = makeService({
      docs: {
        findById: vi
          .fn()
          .mockResolvedValue(baseDocument({ deletionLocked: false })),
        hasSuccessor: vi.fn().mockResolvedValue(true),
      },
    });
    await expect(service.remove('doc-1', 'admin-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('409s when a ClaimDocument still links to it', async () => {
    const { service } = makeService({
      docs: {
        findById: vi
          .fn()
          .mockResolvedValue(baseDocument({ deletionLocked: false })),
        hasClaimLink: vi.fn().mockResolvedValue(true),
      },
    });
    await expect(service.remove('doc-1', 'admin-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('deletes an unlocked, leaf, unattached document and writes a DELETE audit row', async () => {
    const { service, docs, audit } = makeService({
      docs: {
        findById: vi
          .fn()
          .mockResolvedValue(baseDocument({ deletionLocked: false })),
      },
    });
    await service.remove('doc-1', 'admin-1');
    expect(docs.deleteIfUnlocked).toHaveBeenCalledWith('doc-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE',
        entityType: 'Document',
        isSensitiveDataAccess: true,
      }),
    );
  });
});

describe('DocumentService.policyFileClassification', () => {
  it('404s for an unknown policy', async () => {
    const { service } = makeService({
      policies: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.policyFileClassification('nope', 'actor-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns the highest classification present and a document count', async () => {
    const { service } = makeService({
      docs: {
        classificationsByPolicyId: vi
          .fn()
          .mockResolvedValue([
            { classification: 'PUBLIC' },
            { classification: 'HIGHLY_CONFIDENTIAL' },
            { classification: 'INTERNAL' },
          ]),
      },
    });
    const result = await service.policyFileClassification(
      'policy-1',
      'actor-1',
    );
    expect(result).toEqual({
      policyId: 'policy-1',
      documentCount: 3,
      highestClassification: 'HIGHLY_CONFIDENTIAL',
    });
  });

  it('returns null highestClassification for a policy with no documents', async () => {
    const { service } = makeService({
      docs: { classificationsByPolicyId: vi.fn().mockResolvedValue([]) },
    });
    const result = await service.policyFileClassification(
      'policy-1',
      'actor-1',
    );
    expect(result.highestClassification).toBeNull();
    expect(result.documentCount).toBe(0);
  });
});

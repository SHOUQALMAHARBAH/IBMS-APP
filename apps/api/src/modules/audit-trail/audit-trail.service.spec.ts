import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DEFAULT_PAGE_SIZE } from '../../common/pagination';
import { AuditTrailService } from './audit-trail.service';
import type { AuditTrailRepository } from '../../repositories/audit-trail.repository';
import type { AuditService } from '../audit/audit.service';
import type { UserRepository } from '../../repositories/user.repository';
import type {
  AuditLogEntryRow,
  DocumentVersionRow,
} from './audit-trail.config';

function logRow(over: Partial<AuditLogEntryRow> = {}): AuditLogEntryRow {
  return {
    id: 'audit-1',
    userId: 'user-1',
    action: 'UPDATE',
    entityType: 'Policy',
    entityId: 'policy-1',
    beforeValue: null,
    afterValue: { status: 'VERIFIED' },
    isSensitiveDataAccess: false,
    actorRoleIds: [],
    actorRoleNames: [],
    occurredAt: new Date('2026-09-07T08:00:00.000Z'),
    ...over,
  };
}

function docVersion(
  over: Partial<DocumentVersionRow> = {},
): DocumentVersionRow {
  return {
    id: 'doc-1',
    versionNumber: 1,
    fileName: 'policy-schedule.pdf',
    category: 'POLICY',
    classification: 'CONFIDENTIAL',
    uploadedByUserId: 'user-1',
    deletionLocked: true,
    deletionOverrideByUserId: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    previousVersionId: null,
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
    findAuditLog: vi.fn().mockResolvedValue([logRow()]),
    countAuditLog: vi.fn().mockResolvedValue(1),
    findWorkflowHistory: vi
      .fn()
      .mockResolvedValue([logRow({ action: 'TRANSITION' })]),
    findDocumentAuditTrail: vi
      .fn()
      .mockResolvedValue([
        logRow({ entityType: 'Document', entityId: 'doc-1' }),
      ]),
    findDocumentVersionChain: vi.fn().mockResolvedValue([docVersion()]),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  // Resolves the page's actor ids to names. Empty by default, so the existing cases assert the
  // unresolvable path — which is a real state (a seed, a scheduled sweep) and must render the id.
  const users = {
    findSummariesByIds: vi.fn().mockResolvedValue([]),
    ...over.users,
  };
  const service = new AuditTrailService(
    repo as unknown as AuditTrailRepository,
    audit as unknown as AuditService,
    users as unknown as UserRepository,
  );
  return { service, repo, audit, users };
}

describe('AuditTrailService.browseAuditLog (Process 57)', () => {
  it('passes filters through to the repository and audits the read', async () => {
    const { service, repo, audit } = makeService();
    const rows = await service.browseAuditLog(
      { entityType: 'Policy', entityId: 'policy-1' },
      'u-auditor',
    );
    // The page query and the count run on the SAME filter, so "of N" can
    // never contradict the rows on screen.
    const expectedFilter = expect.objectContaining({
      entityType: 'Policy',
      entityId: 'policy-1',
    }) as unknown;
    expect(repo.findAuditLog).toHaveBeenCalledWith(
      expectedFilter,
      DEFAULT_PAGE_SIZE,
      0,
    );
    expect(repo.countAuditLog).toHaveBeenCalledWith(expectedFilter);
    expect(rows.items).toHaveLength(1);
    expect(rows.total).toBe(1);
    expect(rows.page).toBe(0);
    expect(rows.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-auditor',
        action: 'READ',
        entityType: 'AuditLogEntry',
        entityId: 'browse',
        isSensitiveDataAccess: true,
      }),
    );
  });

  it('converts from/to query strings into Date filters', async () => {
    const { service, repo } = makeService();
    await service.browseAuditLog(
      { from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' },
      'u-auditor',
    );
    const [filterArg] = repo.findAuditLog.mock.calls[0] as [
      { from?: Date; to?: Date },
    ];
    expect(filterArg.from).toBeInstanceOf(Date);
    expect(filterArg.to).toBeInstanceOf(Date);
  });

  it('does not fail the read if the audit write itself fails', async () => {
    const { service, audit } = makeService();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    const page = await service.browseAuditLog({}, 'u-auditor');
    expect(page.items).toHaveLength(1);
  });
});

describe('AuditTrailService.documentHistory (Process 57)', () => {
  it('404s when the document does not exist', async () => {
    const { service } = makeService({
      repo: { findDocumentVersionChain: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.documentHistory('nope', 'u-auditor'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the ordered version chain plus its audit trail, and audits the read', async () => {
    const { service, repo, audit } = makeService({
      repo: {
        findDocumentVersionChain: vi.fn().mockResolvedValue([
          docVersion({ id: 'doc-1', versionNumber: 1 }),
          docVersion({
            id: 'doc-2',
            versionNumber: 2,
            previousVersionId: 'doc-1',
          }),
        ]),
      },
    });
    const history = await service.documentHistory('doc-2', 'u-auditor');
    expect(history.requestedDocumentId).toBe('doc-2');
    expect(history.versions.map((v) => v.id)).toEqual(['doc-1', 'doc-2']);
    expect(
      history.versions.find((v) => v.id === 'doc-2')?.isRequestedVersion,
    ).toBe(true);
    expect(repo.findDocumentAuditTrail).toHaveBeenCalledWith(
      ['doc-1', 'doc-2'],
      expect.any(Number),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-auditor',
        action: 'READ',
        entityType: 'Document',
        entityId: 'doc-2',
        isSensitiveDataAccess: true,
      }),
    );
  });
});

describe('AuditTrailService.workflowHistory (Process 57)', () => {
  it('queries TRANSITION rows for the given entity and audits the read against that entity', async () => {
    const { service, repo, audit } = makeService();
    const rows = await service.workflowHistory(
      { entityType: 'Claim', entityId: 'claim-1' },
      'u-auditor',
    );
    expect(repo.findWorkflowHistory).toHaveBeenCalledWith(
      'Claim',
      'claim-1',
      expect.any(Number),
    );
    expect(rows).toHaveLength(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-auditor',
        action: 'READ',
        entityType: 'Claim',
        entityId: 'claim-1',
        isSensitiveDataAccess: true,
      }),
    );
  });
});

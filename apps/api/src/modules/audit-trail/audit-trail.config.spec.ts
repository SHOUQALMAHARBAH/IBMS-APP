import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  buildDocumentVersionViews,
  deriveAuditLogEntryView,
  type AuditLogEntryRow,
  type DocumentVersionRow,
} from './audit-trail.config';

describe('AUDIT_ACTIONS', () => {
  it('is non-empty and includes the actions this module filters on', () => {
    expect(AUDIT_ACTIONS.length).toBeGreaterThan(0);
    expect(AUDIT_ACTIONS).toContain('CREATE');
    expect(AUDIT_ACTIONS).toContain('READ');
    expect(AUDIT_ACTIONS).toContain('TRANSITION');
  });
});

describe('deriveAuditLogEntryView', () => {
  it('maps every field and ISO-stamps occurredAt', () => {
    const row: AuditLogEntryRow = {
      id: 'audit-1',
      userId: 'user-1',
      action: 'UPDATE',
      entityType: 'Policy',
      entityId: 'policy-1',
      beforeValue: { status: 'ISSUED' },
      afterValue: { status: 'VERIFIED' },
      isSensitiveDataAccess: false,
      occurredAt: new Date('2026-09-07T08:00:00.000Z'),
    };
    expect(deriveAuditLogEntryView(row)).toEqual({
      id: 'audit-1',
      userId: 'user-1',
      action: 'UPDATE',
      entityType: 'Policy',
      entityId: 'policy-1',
      beforeValue: { status: 'ISSUED' },
      afterValue: { status: 'VERIFIED' },
      isSensitiveDataAccess: false,
      occurredAt: '2026-09-07T08:00:00.000Z',
    });
  });
});

describe('buildDocumentVersionViews', () => {
  function version(over: Partial<DocumentVersionRow> = {}): DocumentVersionRow {
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

  it('orders oldest-to-newest by versionNumber regardless of input order', () => {
    const chain = [
      version({ id: 'doc-3', versionNumber: 3 }),
      version({ id: 'doc-1', versionNumber: 1 }),
      version({ id: 'doc-2', versionNumber: 2 }),
    ];
    const views = buildDocumentVersionViews(chain, 'doc-2');
    expect(views.map((v) => v.id)).toEqual(['doc-1', 'doc-2', 'doc-3']);
  });

  it('flags only the requested version', () => {
    const chain = [
      version({ id: 'doc-1' }),
      version({ id: 'doc-2', versionNumber: 2 }),
    ];
    const views = buildDocumentVersionViews(chain, 'doc-2');
    expect(views.find((v) => v.id === 'doc-1')?.isRequestedVersion).toBe(false);
    expect(views.find((v) => v.id === 'doc-2')?.isRequestedVersion).toBe(true);
  });

  it('a single-document chain (the common, dormant-version-chain case today) still works', () => {
    const views = buildDocumentVersionViews([version()], 'doc-1');
    expect(views).toEqual([
      expect.objectContaining({ id: 'doc-1', isRequestedVersion: true }),
    ]);
  });
});

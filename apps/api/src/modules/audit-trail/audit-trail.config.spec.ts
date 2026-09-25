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
  it('resolves the actor name when the page supplied one, and leaves it null when it did not', () => {
    const row: AuditLogEntryRow = {
      id: 'audit-2',
      userId: 'user-7',
      action: 'READ',
      entityType: 'Customer',
      entityId: 'cus-1',
      beforeValue: null,
      afterValue: null,
      isSensitiveDataAccess: true,
      actorRoleIds: [],
      actorRoleNames: [],
      occurredAt: new Date('2026-09-25T08:00:00.000Z'),
    };
    const names = new Map([['user-7', 'سلمى خالد المحاربة']]);
    expect(deriveAuditLogEntryView(row, names).actorName).toBe(
      'سلمى خالد المحاربة',
    );
    // A map that does not contain this actor is the same as no map: null, never the empty string, so
    // "unresolvable" and "named nothing" cannot be confused on screen.
    expect(
      deriveAuditLogEntryView(row, new Map([['someone-else', 'X']])).actorName,
    ).toBeNull();
  });

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
      actorRoleIds: ['role-compliance'],
      actorRoleNames: ['Compliance Officer'],
      occurredAt: new Date('2026-09-07T08:00:00.000Z'),
    };
    expect(deriveAuditLogEntryView(row)).toEqual({
      id: 'audit-1',
      userId: 'user-1',
      // No name map passed: the actor is unresolvable, which is a real state (a seed, a scheduled
      // sweep) and must be null so the screen can fall back to showing the id.
      actorName: null,
      action: 'UPDATE',
      entityType: 'Policy',
      entityId: 'policy-1',
      beforeValue: { status: 'ISSUED' },
      afterValue: { status: 'VERIFIED' },
      isSensitiveDataAccess: false,
      // The roles the actor HELD, carried through to the view. `toEqual` on the whole object is
      // what makes this a mapping test rather than a spot check: a field added to the row and
      // forgotten in the derivation fails here.
      actorRoleIds: ['role-compliance'],
      actorRoleNames: ['Compliance Officer'],
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

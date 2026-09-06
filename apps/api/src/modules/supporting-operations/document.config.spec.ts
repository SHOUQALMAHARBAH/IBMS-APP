import { describe, expect, it } from 'vitest';
import {
  documentAuditSnapshot,
  highestClassification,
} from './document.config';

describe('highestClassification', () => {
  it('returns null for an empty set', () => {
    expect(highestClassification([])).toBeNull();
  });

  it('returns the single classification present', () => {
    expect(highestClassification(['CONFIDENTIAL'])).toBe('CONFIDENTIAL');
  });

  it('returns the highest of several, never averaged', () => {
    expect(
      highestClassification(['PUBLIC', 'HIGHLY_CONFIDENTIAL', 'INTERNAL']),
    ).toBe('HIGHLY_CONFIDENTIAL');
  });

  it('is order-independent', () => {
    expect(highestClassification(['CONFIDENTIAL', 'PUBLIC', 'INTERNAL'])).toBe(
      'CONFIDENTIAL',
    );
  });

  it('treats a single-element repeated set correctly', () => {
    expect(highestClassification(['PUBLIC', 'PUBLIC'])).toBe('PUBLIC');
  });
});

describe('documentAuditSnapshot', () => {
  it('excludes fileName and storageRef', () => {
    const snapshot = documentAuditSnapshot({
      id: 'doc-1',
      policyId: 'policy-1',
      customerId: null,
      category: 'POLICY',
      classification: 'CONFIDENTIAL',
      versionNumber: 2,
      previousVersionId: 'doc-0',
      uploadedByUserId: 'user-1',
    });
    expect(snapshot).toEqual({
      documentId: 'doc-1',
      policyId: 'policy-1',
      customerId: null,
      category: 'POLICY',
      classification: 'CONFIDENTIAL',
      versionNumber: 2,
      previousVersionId: 'doc-0',
      uploadedByUserId: 'user-1',
    });
    expect(snapshot).not.toHaveProperty('fileName');
    expect(snapshot).not.toHaveProperty('storageRef');
  });
});

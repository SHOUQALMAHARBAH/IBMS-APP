import { describe, expect, it } from 'vitest';
import {
  crossBorderTransferAuditSnapshot,
  deriveCrossBorderTransferView,
  type CrossBorderTransferRecordRow,
} from './cross-border-transfer.config';

const row = (
  over: Partial<CrossBorderTransferRecordRow> = {},
): CrossBorderTransferRecordRow => ({
  id: 'cbt-1',
  description: 'Reinsurance placement data shared with a Bermuda reinsurer.',
  destinationCountry: 'Bermuda',
  legalBasis: 'standard_contractual_clauses',
  legalBasisEvidenceRef: 'doc-scc-1',
  approvedByUserId: 'u-dpo',
  transferredAt: new Date('2026-09-07T00:00:00.000Z'),
  ...over,
});

describe('deriveCrossBorderTransferView', () => {
  it('serializes transferredAt to an ISO string', () => {
    const v = deriveCrossBorderTransferView(row());
    expect(v.transferredAt).toBe('2026-09-07T00:00:00.000Z');
    expect(v.legalBasis).toBe('standard_contractual_clauses');
    expect(v.approvedByUserId).toBe('u-dpo');
  });

  it('passes through a null legalBasisEvidenceRef', () => {
    const v = deriveCrossBorderTransferView(
      row({ legalBasisEvidenceRef: null }),
    );
    expect(v.legalBasisEvidenceRef).toBeNull();
  });
});

describe('crossBorderTransferAuditSnapshot', () => {
  it('includes the operational description, destination, and legal basis', () => {
    const snap = crossBorderTransferAuditSnapshot(row());
    expect(snap).toMatchObject({
      crossBorderTransferRecordId: 'cbt-1',
      destinationCountry: 'Bermuda',
      legalBasis: 'standard_contractual_clauses',
      description:
        'Reinsurance placement data shared with a Bermuda reinsurer.',
    });
  });
});

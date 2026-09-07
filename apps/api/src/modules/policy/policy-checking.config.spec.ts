import { describe, expect, it } from 'vitest';
import {
  diffCoverage,
  piRiskEventDescription,
  policyCheckingAuditSnapshot,
  type CoverageSnapshot,
} from './policy-checking.config';

const CLEAN_REQUESTED: CoverageSnapshot = {
  limits: { buildings: '5000000.000', contents: '1200000.000' },
  sumsInsured: { total: '6200000.000' },
  namedPerils: ['fire', 'flood', 'theft'],
  extensions: ['debris removal'],
};

describe('policy-checking.config', () => {
  describe('diffCoverage', () => {
    it('finds no discrepancy when the issued policy matches the requested coverage', () => {
      const diff = diffCoverage(CLEAN_REQUESTED, { ...CLEAN_REQUESTED });
      expect(diff.discrepancyFound).toBe(false);
      expect(diff.mismatchCount).toBe(0);
      expect(diff.summary).toBe('');
      expect(diff.checklist.limits.every((c) => c.match)).toBe(true);
      expect(diff.checklist.namedPerils.match).toBe(true);
    });

    it('treats money values as equal regardless of trailing-zero formatting', () => {
      const diff = diffCoverage(CLEAN_REQUESTED, {
        ...CLEAN_REQUESTED,
        limits: { buildings: '5000000', contents: '1200000.0' },
      });
      expect(diff.discrepancyFound).toBe(false);
    });

    it('does not raise a discrepancy for a casing / whitespace-only difference in a peril or extension', () => {
      const diff = diffCoverage(
        {
          ...CLEAN_REQUESTED,
          namedPerils: ['Fire', 'FLOOD', ' Theft '],
          extensions: ['Debris  Removal'],
        },
        CLEAN_REQUESTED,
      );
      expect(diff.discrepancyFound).toBe(false);
      expect(diff.checklist.namedPerils.match).toBe(true);
      expect(diff.checklist.extensions.match).toBe(true);
    });

    it('flags a limit that was issued lower than requested (the canonical PI exposure)', () => {
      const diff = diffCoverage(CLEAN_REQUESTED, {
        ...CLEAN_REQUESTED,
        limits: { buildings: '3000000.000', contents: '1200000.000' },
      });
      expect(diff.discrepancyFound).toBe(true);
      expect(diff.mismatchCount).toBe(1);
      expect(diff.summary).toContain('limits.buildings');
      expect(diff.summary).toContain('requested 5000000.000');
      expect(diff.summary).toContain('issued 3000000.000');
      const row = diff.checklist.limits.find((c) => c.key === 'buildings');
      expect(row?.match).toBe(false);
    });

    it('flags a key present on only one side', () => {
      const diff = diffCoverage(CLEAN_REQUESTED, {
        ...CLEAN_REQUESTED,
        sumsInsured: {},
      });
      expect(diff.discrepancyFound).toBe(true);
      const row = diff.checklist.sumsInsured.find((c) => c.key === 'total');
      expect(row).toEqual({
        key: 'total',
        requested: '6200000.000',
        issued: null,
        match: false,
      });
    });

    it('flags a named peril missing from the issued policy and an extra extension on it', () => {
      const diff = diffCoverage(CLEAN_REQUESTED, {
        ...CLEAN_REQUESTED,
        namedPerils: ['fire', 'theft'],
        extensions: ['debris removal', 'professional fees'],
      });
      expect(diff.discrepancyFound).toBe(true);
      expect(diff.mismatchCount).toBe(2);
      expect(diff.checklist.namedPerils.missing).toEqual(['flood']);
      expect(diff.checklist.extensions.extra).toEqual(['professional fees']);
      expect(diff.summary).toContain('namedPerils missing');
      expect(diff.summary).toContain(
        'extensions on issued policy but not requested',
      );
    });
  });

  describe('piRiskEventDescription', () => {
    it('names the policy number when set', () => {
      expect(piRiskEventDescription('POL-1', 'pol-uuid', 'x')).toBe(
        'Policy-checking discrepancy on policy POL-1: x',
      );
    });
    it('falls back to the policy id', () => {
      expect(piRiskEventDescription(null, 'pol-uuid', 'x')).toBe(
        'Policy-checking discrepancy on policy pol-uuid: x',
      );
    });
  });

  describe('policyCheckingAuditSnapshot', () => {
    it('carries counts + ids + booleans, never the checklist figures or detail text', () => {
      const snap = policyCheckingAuditSnapshot({
        policyId: 'pol-1',
        placedByUserId: 'plc-1',
        checkedByUserId: 'chk-1',
        discrepancyFound: true,
        mismatchCount: 2,
        discrepancyLoggedAsPiRiskEvent: true,
      });
      expect(snap).toEqual({
        policyId: 'pol-1',
        placedByUserId: 'plc-1',
        checkedByUserId: 'chk-1',
        discrepancyFound: true,
        mismatchCount: 2,
        discrepancyLoggedAsPiRiskEvent: true,
      });
      const json = JSON.stringify(snap);
      expect(json).not.toContain('checklist');
      expect(json).not.toContain('5000000');
    });
  });
});

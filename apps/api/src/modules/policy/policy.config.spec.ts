import { describe, expect, it } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import {
  assertCoverageFigures,
  parseCalendarDate,
  policyDocumentAuditSnapshot,
  policyPlacementAuditSnapshot,
  policyScheduleAuditSnapshot,
  premiumVariance,
} from './policy.config';

describe('policy.config', () => {
  describe('parseCalendarDate', () => {
    it('accepts a bare date as UTC midnight', () => {
      expect(
        parseCalendarDate('2026-10-01', 'inceptionDate').toISOString(),
      ).toBe('2026-10-01T00:00:00.000Z');
    });

    it('accepts a future date (a policy can incept next month)', () => {
      const d = parseCalendarDate('2099-01-01', 'inceptionDate');
      expect(d.getUTCFullYear()).toBe(2099);
    });

    it('accepts a datetime with an explicit offset', () => {
      expect(
        parseCalendarDate('2026-10-01T09:00:00+03:00', 'x').toISOString(),
      ).toBe('2026-10-01T06:00:00.000Z');
    });

    it('rejects a datetime with no offset (server-local shift trap)', () => {
      expect(() => parseCalendarDate('2026-10-01T09:00:00', 'x')).toThrow(
        UnprocessableEntityException,
      );
    });

    it('rejects an unparseable string', () => {
      expect(() => parseCalendarDate('not-a-date', 'x')).toThrow(
        UnprocessableEntityException,
      );
    });
  });

  describe('assertCoverageFigures', () => {
    it('passes a non-empty flat object of string/number values', () => {
      const v = assertCoverageFigures(
        { buildings: '5000000.000', contents: 1200000 },
        'schedule.limits',
      );
      expect(v).toEqual({ buildings: '5000000.000', contents: 1200000 });
    });

    it('rejects an empty object', () => {
      expect(() => assertCoverageFigures({}, 'schedule.limits')).toThrow(
        UnprocessableEntityException,
      );
    });

    it('rejects an array', () => {
      expect(() => assertCoverageFigures([1, 2], 'schedule.limits')).toThrow(
        UnprocessableEntityException,
      );
    });

    it('rejects a nested object value', () => {
      expect(() =>
        assertCoverageFigures({ a: { b: 1 } }, 'schedule.limits'),
      ).toThrow(UnprocessableEntityException);
    });

    it('rejects a non-finite number', () => {
      expect(() =>
        assertCoverageFigures({ a: Number.POSITIVE_INFINITY }, 'x'),
      ).toThrow(UnprocessableEntityException);
    });
  });

  describe('premiumVariance', () => {
    it('is null until the policy is issued', () => {
      expect(premiumVariance(new Prisma.Decimal('100000'), null)).toBeNull();
    });

    it('is the signed issued-minus-requested delta, fils precision', () => {
      expect(
        premiumVariance(
          new Prisma.Decimal('120000.000'),
          new Prisma.Decimal('118500.500'),
        ),
      ).toBe('-1499.500');
      expect(
        premiumVariance(
          new Prisma.Decimal('120000.000'),
          new Prisma.Decimal('121000'),
        ),
      ).toBe('1000.000');
    });
  });

  describe('audit snapshots exclude free text / file identity', () => {
    it('placement snapshot carries money as a string and no notes', () => {
      const snap = policyPlacementAuditSnapshot({
        opportunityId: 'opp-1',
        customerId: 'cust-1',
        insurerId: 'ins-1',
        insuranceLine: 'Property All Risks',
        status: 'PLACEMENT_CONFIRMED',
        inceptionDate: new Date('2026-10-01T00:00:00Z'),
        expiryDate: null,
        requestedPremium: new Prisma.Decimal('120000'),
        currency: 'JOD',
        placedByUserId: 'plc-1',
      });
      expect(snap.requestedPremium).toBe('120000.000');
      expect(snap.expiryDate).toBeNull();
      expect(Object.keys(snap)).not.toContain('notes');
    });

    it('schedule snapshot carries key names + counts, never the figures', () => {
      const snap = policyScheduleAuditSnapshot({
        policyId: 'pol-1',
        effectiveFrom: new Date('2026-10-01T00:00:00Z'),
        limits: { buildings: '5000000', contents: '1200000' },
        sumsInsured: { total: '6200000' },
        namedPerils: ['fire', 'flood', 'theft'],
        extensions: ['debris removal'],
      });
      expect(snap.limitKeys).toEqual(['buildings', 'contents']);
      expect(snap.sumsInsuredKeys).toEqual(['total']);
      expect(snap.namedPerilCount).toBe(3);
      expect(snap.extensionCount).toBe(1);
      expect(JSON.stringify(snap)).not.toContain('5000000');
    });

    it('document snapshot excludes fileName and storageRef', () => {
      const snap = policyDocumentAuditSnapshot({
        id: 'doc-1',
        policyId: 'pol-1',
        category: 'POLICY',
        classification: 'CONFIDENTIAL',
        versionNumber: 1,
        uploadedByUserId: 'plc-1',
      });
      const json = JSON.stringify(snap);
      expect(json).not.toContain('fileName');
      expect(json).not.toContain('storageRef');
      expect(snap.category).toBe('POLICY');
      expect(snap.classification).toBe('CONFIDENTIAL');
    });
  });
});

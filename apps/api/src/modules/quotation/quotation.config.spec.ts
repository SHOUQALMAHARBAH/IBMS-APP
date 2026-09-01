import { describe, expect, it } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import {
  normalizeQuotationTerms,
  quotationAuditSnapshot,
} from './quotation.config';

const BASE = { premium: '125000.500' };

describe('normalizeQuotationTerms', () => {
  it('quantizes premium to fils precision and returns a Prisma.Decimal', () => {
    const terms = normalizeQuotationTerms({ premium: '125000.5' });
    expect(terms.premium).toBeInstanceOf(Prisma.Decimal);
    expect(terms.premium.toFixed(3)).toBe('125000.500');
  });

  it('rounds a sub-fils premium rather than rejecting it (the DTO regex is the >3dp gate)', () => {
    expect(
      normalizeQuotationTerms({ premium: '1.9999' }).premium.toFixed(3),
    ).toBe('2.000');
  });

  it('rejects a zero premium', () => {
    expect(() => normalizeQuotationTerms({ premium: '0' })).toThrow(
      UnprocessableEntityException,
    );
  });

  it('rejects a negative amount on any money field', () => {
    expect(() =>
      normalizeQuotationTerms({ ...BASE, deductible: '-1.000' }),
    ).toThrow(/deductible cannot be negative/);
  });

  it('defaults currency to JOD and upper-cases what it is given', () => {
    expect(normalizeQuotationTerms(BASE).currency).toBe('JOD');
    expect(normalizeQuotationTerms({ ...BASE, currency: 'usd' }).currency).toBe(
      'USD',
    );
  });

  it('rejects a currency that is not three letters', () => {
    expect(() =>
      normalizeQuotationTerms({ ...BASE, currency: 'JODX' }),
    ).toThrow(UnprocessableEntityException);
  });

  it('leaves optional money / bi-period / commission fields null when absent', () => {
    const terms = normalizeQuotationTerms(BASE);
    expect(terms.deductible).toBeNull();
    expect(terms.liabilityLimit).toBeNull();
    expect(terms.biPeriodMonths).toBeNull();
    expect(terms.commissionRatePercent).toBeNull();
    expect(terms.limits).toBeNull();
  });

  it('accepts a bi-period within 1..120 and rejects one outside it', () => {
    expect(
      normalizeQuotationTerms({ ...BASE, biPeriodMonths: 12 }).biPeriodMonths,
    ).toBe(12);
    expect(() =>
      normalizeQuotationTerms({ ...BASE, biPeriodMonths: 0 }),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      normalizeQuotationTerms({ ...BASE, biPeriodMonths: 121 }),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      normalizeQuotationTerms({ ...BASE, biPeriodMonths: 1.5 }),
    ).toThrow(UnprocessableEntityException);
  });

  it('quantizes commissionRatePercent to 2dp and bounds it to 0..100', () => {
    expect(
      normalizeQuotationTerms({
        ...BASE,
        commissionRatePercent: '12.5',
      }).commissionRatePercent?.toFixed(2),
    ).toBe('12.50');
    expect(() =>
      normalizeQuotationTerms({ ...BASE, commissionRatePercent: '150' }),
    ).toThrow(UnprocessableEntityException);
  });

  it('trims exclusions / conditions and collapses blank text to null', () => {
    const terms = normalizeQuotationTerms({
      ...BASE,
      exclusions: '  war and terrorism  ',
      conditions: '   ',
    });
    expect(terms.exclusions).toBe('war and terrorism');
    expect(terms.conditions).toBeNull();
  });

  it('passes a non-empty limits object through unchanged', () => {
    const limits = { perOccurrence: '1000000.000', aggregate: '5000000.000' };
    expect(normalizeQuotationTerms({ ...BASE, limits }).limits).toEqual(limits);
  });

  it('normalizes an empty {} limits object to null (so hasLimits stays honest)', () => {
    expect(normalizeQuotationTerms({ ...BASE, limits: {} }).limits).toBeNull();
  });
});

describe('quotationAuditSnapshot', () => {
  const row = {
    rfqId: 'rfq-1',
    insurerId: 'ins-1',
    versionNumber: 2,
    isCurrentVersion: true,
    previousVersionId: 'q-1',
    premium: new Prisma.Decimal('125000.5'),
    currency: 'JOD',
    deductible: new Prisma.Decimal('500'),
    liabilityLimit: null,
    commissionRatePercent: new Prisma.Decimal('12.5'),
    biPeriodMonths: 12,
    exclusions: 'war and terrorism',
    conditions: null,
    limits: { aggregate: '5000000.000' },
  };

  it('carries the money + structural metadata (money as fixed strings)', () => {
    const snap = quotationAuditSnapshot(row);
    expect(snap).toMatchObject({
      rfqId: 'rfq-1',
      insurerId: 'ins-1',
      versionNumber: 2,
      isCurrentVersion: true,
      previousVersionId: 'q-1',
      premium: '125000.500',
      currency: 'JOD',
      deductible: '500.000',
      liabilityLimit: null,
      commissionRatePercent: '12.50',
      biPeriodMonths: 12,
    });
  });

  it('never carries the free-text exclusions / conditions or the limits blob — only presence booleans', () => {
    const snap = quotationAuditSnapshot(row);
    expect(snap).toMatchObject({
      hasExclusions: true,
      hasConditions: false,
      hasLimits: true,
    });
    expect(JSON.stringify(snap)).not.toContain('war and terrorism');
    expect(JSON.stringify(snap)).not.toContain('5000000.000');
  });
});

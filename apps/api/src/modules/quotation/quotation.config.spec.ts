import { describe, expect, it } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import {
  buildNegotiationHistory,
  normalizeQuotationTerms,
  quotationAuditSnapshot,
  type QuotationVersionLike,
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

  it('trims negotiationNotes and defaults it to null when absent or blank', () => {
    expect(normalizeQuotationTerms(BASE).negotiationNotes).toBeNull();
    expect(
      normalizeQuotationTerms({ ...BASE, negotiationNotes: '   ' })
        .negotiationNotes,
    ).toBeNull();
    expect(
      normalizeQuotationTerms({
        ...BASE,
        negotiationNotes: '  asked for 10% off + flood exclusion removed  ',
      }).negotiationNotes,
    ).toBe('asked for 10% off + flood exclusion removed');
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
    negotiationNotes: 'insurer conceded the flood exclusion after round 2',
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

  it('never carries the free-text exclusions / conditions / negotiationNotes or the limits blob — only presence booleans', () => {
    const snap = quotationAuditSnapshot(row);
    expect(snap).toMatchObject({
      hasExclusions: true,
      hasConditions: false,
      hasLimits: true,
      hasNegotiationNotes: true,
    });
    expect(JSON.stringify(snap)).not.toContain('war and terrorism');
    expect(JSON.stringify(snap)).not.toContain('5000000.000');
    expect(JSON.stringify(snap)).not.toContain('flood exclusion');
  });

  it('reports hasNegotiationNotes false when the round recorded no rationale', () => {
    const snap = quotationAuditSnapshot({ ...row, negotiationNotes: null });
    expect(snap).toMatchObject({ hasNegotiationNotes: false });
  });
});

describe('buildNegotiationHistory', () => {
  function version(
    over: Partial<QuotationVersionLike> & { versionNumber: number },
  ): QuotationVersionLike {
    return {
      id: `q-${over.versionNumber}`,
      isCurrentVersion: false,
      previousVersionId: null,
      receivedAt: new Date('2026-03-01T00:00:00.000Z'),
      capturedByUserId: 'plc-1',
      negotiationNotes: null,
      premium: new Prisma.Decimal('125000.000'),
      currency: 'JOD',
      deductible: null,
      limits: null,
      biPeriodMonths: null,
      liabilityLimit: null,
      exclusions: null,
      conditions: null,
      commissionRatePercent: null,
      ...over,
    };
  }

  it('labels the sole version of a chain as round 0 with no delta and no changed fields', () => {
    const [round] = buildNegotiationHistory([
      version({ versionNumber: 1, isCurrentVersion: true }),
    ]);
    expect(round).toMatchObject({
      round: 0,
      versionNumber: 1,
      premium: '125000.000',
      premiumDeltaFromPrevious: null,
      changedTermFields: [],
    });
  });

  it('sorts by versionNumber and numbers rounds from 0', () => {
    const history = buildNegotiationHistory([
      version({ versionNumber: 3, isCurrentVersion: true }),
      version({ versionNumber: 1 }),
      version({ versionNumber: 2 }),
    ]);
    expect(history.map((r) => r.round)).toEqual([0, 1, 2]);
    expect(history.map((r) => r.versionNumber)).toEqual([1, 2, 3]);
  });

  it('carries a signed premium delta from the previous round (negative when the premium came down)', () => {
    const history = buildNegotiationHistory([
      version({ versionNumber: 1, premium: new Prisma.Decimal('125000.000') }),
      version({ versionNumber: 2, premium: new Prisma.Decimal('119000.000') }),
      version({
        versionNumber: 3,
        premium: new Prisma.Decimal('121500.000'),
        isCurrentVersion: true,
      }),
    ]);
    expect(history[1].premiumDeltaFromPrevious).toBe('-6000.000');
    expect(history[2].premiumDeltaFromPrevious).toBe('2500.000');
  });

  it('lists exactly the term fields that moved between rounds', () => {
    const history = buildNegotiationHistory([
      version({ versionNumber: 1 }),
      version({
        versionNumber: 2,
        premium: new Prisma.Decimal('120000.000'),
        deductible: new Prisma.Decimal('500.000'),
        exclusions: 'flood',
        isCurrentVersion: true,
      }),
    ]);
    expect(history[1].changedTermFields).toEqual([
      'premium',
      'deductible',
      'exclusions',
    ]);
  });

  it('nulls the premium delta when the round changed currency, but still flags currency in changedTermFields', () => {
    const history = buildNegotiationHistory([
      version({ versionNumber: 1, currency: 'JOD' }),
      version({
        versionNumber: 2,
        currency: 'USD',
        premium: new Prisma.Decimal('90000.000'),
        isCurrentVersion: true,
      }),
    ]);
    expect(history[1].premiumDeltaFromPrevious).toBeNull();
    expect(history[1].changedTermFields).toContain('currency');
  });

  it('diffs a round against the version its previousVersionId names, not just the adjacent one', () => {
    const history = buildNegotiationHistory([
      { ...version({ versionNumber: 1 }), id: 'q-a' },
      {
        ...version({
          versionNumber: 2,
          premium: new Prisma.Decimal('118000.000'),
          isCurrentVersion: true,
        }),
        id: 'q-b',
        previousVersionId: 'q-a',
      },
    ]);
    expect(history[1].premiumDeltaFromPrevious).toBe('-7000.000');
  });

  it('detects a limits change (including a null -> object transition) and ignores an unchanged one', () => {
    const same = { aggregate: '1000000.000' };
    const changed = buildNegotiationHistory([
      version({ versionNumber: 1, limits: null }),
      version({ versionNumber: 2, limits: same, isCurrentVersion: true }),
    ]);
    expect(changed[1].changedTermFields).toContain('limits');

    const unchanged = buildNegotiationHistory([
      version({ versionNumber: 1, limits: { aggregate: '1000000.000' } }),
      version({
        versionNumber: 2,
        limits: { aggregate: '1000000.000' },
        premium: new Prisma.Decimal('124000.000'),
        isCurrentVersion: true,
      }),
    ]);
    expect(unchanged[1].changedTermFields).toEqual(['premium']);
  });

  it("passes each version's negotiationNotes through verbatim (round 0 is null in practice — capture has no such field)", () => {
    const history = buildNegotiationHistory([
      version({ versionNumber: 1, negotiationNotes: null }),
      version({
        versionNumber: 2,
        negotiationNotes: 'requested flood cover back in',
        isCurrentVersion: true,
      }),
    ]);
    expect(history[0].negotiationNotes).toBeNull();
    expect(history[1].negotiationNotes).toBe('requested flood cover back in');
  });
});

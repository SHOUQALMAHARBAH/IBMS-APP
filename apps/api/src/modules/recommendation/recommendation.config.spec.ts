import { describe, expect, it } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import {
  approvalRequired,
  commissionDiffAgainst,
  detectConflictOfInterest,
  normalizeRecommendationRationale,
  recommendationAuditSnapshot,
  type CoiQuote,
} from './recommendation.config';

const FACTORS = {
  coverage: 'Matches every requested peril and the two extensions.',
  price: 'Second-lowest premium; 4% above the cheapest.',
  financialStrength: 'A- rated, adequate for this exposure.',
  claimsService: 'Local adjuster panel, 10-day average settlement.',
  deductible: 'JOD 1,000 — in line with the market for this class.',
  policyConditions: 'No unusual warranties; standard subrogation clause.',
};

describe('normalizeRecommendationRationale', () => {
  it('trims and returns a complete rationale', () => {
    const out = normalizeRecommendationRationale({
      rationale: '  Recommend Insurer One on balance of price and service.  ',
      rationaleFactors: { ...FACTORS },
    });
    expect(out.rationale).toBe(
      'Recommend Insurer One on balance of price and service.',
    );
    expect(Object.keys(out.rationaleFactors).sort()).toEqual(
      [
        'claimsService',
        'coverage',
        'deductible',
        'financialStrength',
        'policyConditions',
        'price',
      ].sort(),
    );
  });

  it('rejects a too-short overall summary', () => {
    expect(() =>
      normalizeRecommendationRationale({
        rationale: 'ok',
        rationaleFactors: { ...FACTORS },
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('rejects a missing factor, naming it', () => {
    const rest: Record<string, string> = { ...FACTORS };
    delete rest.claimsService;
    expect(() =>
      normalizeRecommendationRationale({
        rationale: 'A sufficiently long written summary of the choice.',
        rationaleFactors: rest,
      }),
    ).toThrow(/claimsService/);
  });

  it('rejects a blank factor note', () => {
    expect(() =>
      normalizeRecommendationRationale({
        rationale: 'A sufficiently long written summary of the choice.',
        rationaleFactors: { ...FACTORS, deductible: '  ' },
      }),
    ).toThrow(/deductible/);
  });

  it('rejects an unknown factor key (a typo is caught, not dropped)', () => {
    expect(() =>
      normalizeRecommendationRationale({
        rationale: 'A sufficiently long written summary of the choice.',
        rationaleFactors: { ...FACTORS, finanicalStrength: 'typo' },
      }),
    ).toThrow(/unknown key/);
  });

  it('rejects a non-object rationaleFactors', () => {
    expect(() =>
      normalizeRecommendationRationale({
        rationale: 'A sufficiently long written summary of the choice.',
        rationaleFactors: 'nope',
      }),
    ).toThrow(UnprocessableEntityException);
  });
});

describe('approvalRequired', () => {
  it('is false when no threshold is set', () => {
    expect(approvalRequired('500000.000', null)).toBe(false);
  });
  it('is false when the premium is at or below the threshold', () => {
    expect(approvalRequired('250000.000', '250000.000')).toBe(false);
    expect(approvalRequired('249999.999', '250000.000')).toBe(false);
  });
  it('is true when the premium exceeds the threshold', () => {
    expect(approvalRequired('250000.001', '250000.000')).toBe(true);
  });
});

describe('detectConflictOfInterest', () => {
  const recommended: CoiQuote = {
    id: 'q-rec',
    insurerId: 'ins-rec',
    premium: '100000.000',
    commissionRatePercent: '15',
  };

  it('flags a comparable competitor with a materially lower commission', () => {
    const out = detectConflictOfInterest(recommended, [
      {
        id: 'q-cmp',
        insurerId: 'ins-cmp',
        premium: '104000.000', // within the 10% band
        commissionRatePercent: '10', // 5pp lower — material (>= 2pp)
      },
    ]);
    expect(out).toEqual({
      flagged: true,
      competingQuotationId: 'q-cmp',
      commissionDiffPercent: '5.00',
    });
  });

  it('does not flag a cheaper competitor whose commission is only marginally lower', () => {
    const out = detectConflictOfInterest(recommended, [
      {
        id: 'q-cmp',
        insurerId: 'ins-cmp',
        premium: '99000.000',
        commissionRatePercent: '13.5', // only 1.5pp lower
      },
    ]);
    expect(out.flagged).toBe(false);
  });

  it('ignores a competitor priced outside the comparable band', () => {
    const out = detectConflictOfInterest(recommended, [
      {
        id: 'q-expensive',
        insurerId: 'ins-x',
        premium: '120000.000', // 20% above — not a comparable offer
        commissionRatePercent: '5',
      },
    ]);
    expect(out.flagged).toBe(false);
  });

  it('cannot assess (not flagged) when the recommended quote has no commission rate', () => {
    const out = detectConflictOfInterest(
      { ...recommended, commissionRatePercent: null },
      [
        {
          id: 'q-cmp',
          insurerId: 'ins-cmp',
          premium: '100000.000',
          commissionRatePercent: '2',
        },
      ],
    );
    expect(out.flagged).toBe(false);
  });

  it('picks the lowest-commission comparable competitor deterministically', () => {
    const out = detectConflictOfInterest(recommended, [
      {
        id: 'q-b',
        insurerId: 'ins-b',
        premium: '101000.000',
        commissionRatePercent: '11',
      },
      {
        id: 'q-a',
        insurerId: 'ins-a',
        premium: '103000.000',
        commissionRatePercent: '9', // lowest — the one disclosed against
      },
    ]);
    expect(out.competingQuotationId).toBe('q-a');
    expect(out.commissionDiffPercent).toBe('6.00');
  });

  it('skips a comparable competitor with no commission rate on record', () => {
    const out = detectConflictOfInterest(recommended, [
      {
        id: 'q-norate',
        insurerId: 'ins-nr',
        premium: '100000.000',
        commissionRatePercent: null,
      },
    ]);
    expect(out.flagged).toBe(false);
  });
});

describe('commissionDiffAgainst', () => {
  it('returns recommended minus competitor rate, 2dp', () => {
    expect(commissionDiffAgainst('15', '9.5')).toBe('5.50');
  });
});

describe('recommendationAuditSnapshot', () => {
  const row = {
    opportunityId: 'opp-1',
    recommendedQuotationId: 'q-rec',
    draftedByUserId: 'plc-1',
    approvalRequired: true,
    conflictOfInterestFlagged: true,
    coiCompetingQuotationId: 'q-cmp',
    coiCommissionDiffPercent: new Prisma.Decimal('5'),
    rationale: 'A written summary of the choice.',
    rationaleFactors: FACTORS,
  };

  it('carries metadata + flags + the commission diff, never the rationale text', () => {
    const snap = recommendationAuditSnapshot(row);
    expect(snap).toMatchObject({
      opportunityId: 'opp-1',
      approvalRequired: true,
      conflictOfInterestFlagged: true,
      coiCompetingQuotationId: 'q-cmp',
      coiCommissionDiffPercent: '5.00',
      hasRationale: true,
      rationaleFactorsComplete: true,
    });
    expect(JSON.stringify(snap)).not.toContain('balance of price');
    expect(JSON.stringify(snap)).not.toContain('Local adjuster panel');
  });

  it('reports rationaleFactorsComplete false when a factor is missing', () => {
    const partial: Record<string, string> = { ...FACTORS };
    delete partial.claimsService;
    const snap = recommendationAuditSnapshot({
      ...row,
      rationaleFactors: partial,
    });
    expect(snap).toMatchObject({ rationaleFactorsComplete: false });
  });
});

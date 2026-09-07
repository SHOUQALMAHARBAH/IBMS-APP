import { describe, expect, it } from 'vitest';
import type { SumInsuredSummary } from '../risk-profile/risk-profile.config';
import { assembleProgramLines } from './insurance-program.config';

function summary(
  overrides: Partial<SumInsuredSummary> = {},
): SumInsuredSummary {
  return {
    propertySumInsured: '620000.500',
    businessInterruptionSumInsured: '480000.000',
    totalSumInsured: '1100000.500',
    indemnityPeriodMonths: 18,
    fleetVehicleCount: 9,
    assetCount: 4,
    ...overrides,
  };
}

const EMPTY_SURVEY = summary({
  propertySumInsured: '0.000',
  businessInterruptionSumInsured: '0.000',
  totalSumInsured: '0.000',
  indemnityPeriodMonths: null,
  fleetVehicleCount: 0,
  assetCount: 0,
});

describe('assembleProgramLines', () => {
  it('seeds only Property All Risks and Business Interruption from the survey', () => {
    const lines = assembleProgramLines(
      [
        'Property All Risks (Fire)',
        'Business Interruption',
        'Public Liability',
        'Motor Fleet',
        'Cyber',
      ],
      summary(),
    );

    expect(lines).toEqual([
      { insuranceLine: 'Property All Risks', sumInsuredBasis: '620000.500' },
      {
        insuranceLine: 'Business Interruption',
        sumInsuredBasis: '480000.000',
      },
      { insuranceLine: 'Public Liability', sumInsuredBasis: null },
      { insuranceLine: 'Motor Fleet', sumInsuredBasis: null },
      { insuranceLine: 'Cyber', sumInsuredBasis: null },
    ]);
  });

  it('is order-stable — lines come out in COVERAGE_LINES order regardless of input order', () => {
    const forward = assembleProgramLines(
      ['Property All Risks (Fire)', 'Business Interruption', 'Cyber'],
      summary(),
    );
    const reversed = assembleProgramLines(
      ['Cyber', 'Business Interruption', 'Property All Risks (Fire)'],
      summary(),
    );
    expect(reversed).toEqual(forward);
  });

  it('gives Property / BI a null basis when the asset survey is empty (not a misleading zero)', () => {
    const lines = assembleProgramLines(
      ['Property All Risks (Fire)', 'Business Interruption'],
      EMPTY_SURVEY,
    );
    expect(lines).toEqual([
      { insuranceLine: 'Property All Risks', sumInsuredBasis: null },
      { insuranceLine: 'Business Interruption', sumInsuredBasis: null },
    ]);
  });

  it('maps every recommended coverage line to exactly one program line', () => {
    const every = [
      'Property All Risks (Fire)',
      'Business Interruption',
      'Machinery Breakdown',
      'Burglary',
      'Workers Compensation',
      'Public Liability',
      'Product Liability',
      'Professional Indemnity',
      'Motor Fleet',
      'Marine Cargo / Goods in Transit',
      'Cyber',
      'Group Medical',
      'Group Life',
    ];
    const lines = assembleProgramLines(every, summary());
    expect(lines).toHaveLength(every.length);
    // Machinery Breakdown / Burglary are property-adjacent but not
    // separately surveyed — no asset-derived basis.
    expect(
      lines.find((l) => l.insuranceLine === 'Machinery Breakdown')
        ?.sumInsuredBasis,
    ).toBeNull();
    expect(
      lines.find((l) => l.insuranceLine === 'Burglary')?.sumInsuredBasis,
    ).toBeNull();
  });

  it('returns nothing for an empty coverage list', () => {
    expect(assembleProgramLines([], summary())).toEqual([]);
  });

  it('carries an unknown coverage string through with a null basis rather than dropping it', () => {
    const lines = assembleProgramLines(
      ['Property All Risks (Fire)', 'Kidnap & Ransom'],
      summary(),
    );
    expect(lines).toEqual([
      { insuranceLine: 'Property All Risks', sumInsuredBasis: '620000.500' },
      { insuranceLine: 'Kidnap & Ransom', sumInsuredBasis: null },
    ]);
  });

  it('deduplicates a repeated coverage line', () => {
    const lines = assembleProgramLines(['Cyber', 'Cyber', 'Cyber'], summary());
    expect(lines).toEqual([{ insuranceLine: 'Cyber', sumInsuredBasis: null }]);
  });
});

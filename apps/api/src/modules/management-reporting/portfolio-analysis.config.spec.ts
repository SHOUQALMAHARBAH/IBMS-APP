import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import {
  deriveLineOrInsurerBreakdown,
  reduceByClientSegment,
  reduceByGeography,
  UNASSIGNED_GEOGRAPHY_LABEL,
} from './portfolio-analysis.config';
import type {
  LineOrInsurerGroup,
  PolicyForCrossTableGrouping,
} from '../../repositories/portfolio-analysis.repository';

describe('deriveLineOrInsurerBreakdown', () => {
  const rows: LineOrInsurerGroup[] = [
    {
      key: 'motor',
      policyCount: 3,
      totalIssuedPremium: new Prisma.Decimal('9000'),
    },
    {
      key: 'property',
      policyCount: 5,
      totalIssuedPremium: new Prisma.Decimal('15000'),
    },
  ];

  it('formats each group and sorts descending by total premium', () => {
    const view = deriveLineOrInsurerBreakdown(rows);
    expect(view).toEqual([
      { key: 'property', policyCount: 5, totalIssuedPremiumJod: '15000.000' },
      { key: 'motor', policyCount: 3, totalIssuedPremiumJod: '9000.000' },
    ]);
  });

  it('resolves raw keys to display names when a map is supplied', () => {
    const insurerRows: LineOrInsurerGroup[] = [
      {
        key: 'insurer-1',
        policyCount: 2,
        totalIssuedPremium: new Prisma.Decimal('4000'),
      },
    ];
    const view = deriveLineOrInsurerBreakdown(
      insurerRows,
      new Map([['insurer-1', 'Jordan Insurance Co']]),
    );
    expect(view[0].key).toBe('Jordan Insurance Co');
  });

  it('falls back to the raw key when no name is found in the map', () => {
    const insurerRows: LineOrInsurerGroup[] = [
      {
        key: 'insurer-unknown',
        policyCount: 1,
        totalIssuedPremium: new Prisma.Decimal('1000'),
      },
    ];
    const view = deriveLineOrInsurerBreakdown(insurerRows, new Map());
    expect(view[0].key).toBe('insurer-unknown');
  });

  it('renders a null aggregate as zero, not a crash', () => {
    const view = deriveLineOrInsurerBreakdown([
      { key: 'liability', policyCount: 0, totalIssuedPremium: null },
    ]);
    expect(view[0].totalIssuedPremiumJod).toBe('0.000');
  });
});

describe('reduceByClientSegment', () => {
  it('groups by customerType, counting and summing premium per segment', () => {
    const rows: PolicyForCrossTableGrouping[] = [
      {
        issuedPremium: new Prisma.Decimal('1000'),
        customerType: 'CORPORATE',
        ownerUserId: 'u1',
      },
      {
        issuedPremium: new Prisma.Decimal('2000'),
        customerType: 'CORPORATE',
        ownerUserId: 'u2',
      },
      {
        issuedPremium: new Prisma.Decimal('500'),
        customerType: 'INDIVIDUAL',
        ownerUserId: 'u1',
      },
    ];
    expect(reduceByClientSegment(rows)).toEqual([
      { key: 'CORPORATE', policyCount: 2, totalIssuedPremiumJod: '3000.000' },
      { key: 'INDIVIDUAL', policyCount: 1, totalIssuedPremiumJod: '500.000' },
    ]);
  });

  it('returns an empty array for no policies', () => {
    expect(reduceByClientSegment([])).toEqual([]);
  });
});

describe('reduceByGeography', () => {
  it("groups by the owner's resolved branch name", () => {
    const rows: PolicyForCrossTableGrouping[] = [
      {
        issuedPremium: new Prisma.Decimal('1000'),
        customerType: 'CORPORATE',
        ownerUserId: 'u1',
      },
      {
        issuedPremium: new Prisma.Decimal('2000'),
        customerType: 'CORPORATE',
        ownerUserId: 'u2',
      },
    ];
    const branchNameByOwner = new Map([
      ['u1', 'Amman Branch'],
      ['u2', 'Amman Branch'],
    ]);
    expect(reduceByGeography(rows, branchNameByOwner)).toEqual([
      {
        key: 'Amman Branch',
        policyCount: 2,
        totalIssuedPremiumJod: '3000.000',
      },
    ]);
  });

  it('buckets an owner with no branch on file as Unassigned, never dropping the row', () => {
    const rows: PolicyForCrossTableGrouping[] = [
      {
        issuedPremium: new Prisma.Decimal('750'),
        customerType: 'INDIVIDUAL',
        ownerUserId: 'u3',
      },
    ];
    const view = reduceByGeography(rows, new Map([['u3', null]]));
    expect(view).toEqual([
      {
        key: UNASSIGNED_GEOGRAPHY_LABEL,
        policyCount: 1,
        totalIssuedPremiumJod: '750.000',
      },
    ]);
  });

  it('buckets an owner missing from the map entirely as Unassigned too', () => {
    const rows: PolicyForCrossTableGrouping[] = [
      {
        issuedPremium: new Prisma.Decimal('300'),
        customerType: 'INDIVIDUAL',
        ownerUserId: 'u-missing',
      },
    ];
    const view = reduceByGeography(rows, new Map());
    expect(view[0].key).toBe(UNASSIGNED_GEOGRAPHY_LABEL);
  });
});

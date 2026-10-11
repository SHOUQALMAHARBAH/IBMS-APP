import { describe, expect, it } from 'vitest';
import {
  assessCapital,
  branchCountByType,
  assessStaffing,
  breachesNaturalPersonOneTypeRule,
  requiredApprovedStaff,
  CAPITAL_BANDS,
  requiredCapitalForScope,
  requiredCapitalForType,
  typesInScope,
  type ScopedBranch,
} from './broker-license-scope.config';
import { toMoney } from '../../common/money.util';

/**
 * MODULE 0 ITEM (e) — the licence-scope rules.
 *
 * CBJ Instructions No. 9 of 2026 art. 3/a (types and branches; a natural person holds one type)
 * and art. 4/a (capital by branch count).
 */

// No `as InsuranceLineCategory` here: the return type already constrains the literal, so the cast
// was unnecessary and lint says so. A cast that changes nothing is a cast that hides the day it
// starts changing something.
const general = (n: number): ScopedBranch[] =>
  Array.from({ length: n }, () => ({ category: 'GENERAL' }));
const life = (n: number): ScopedBranch[] =>
  Array.from({ length: n }, () => ({ category: 'LIFE' }));

describe('requiredCapitalForType (art. 4/a)', () => {
  it('requires nothing for a type with no branches', () => {
    // A type with no branches is a type the office is not licensed for. Charging it 5,000 JOD
    // would invent a requirement for something nobody applied for.
    expect(requiredCapitalForType(0).toFixed(3)).toBe('0.000');
    expect(requiredCapitalForType(-1).toFixed(3)).toBe('0.000');
  });

  /*
   * THE BAND BOUNDARIES, asserted on both sides of each edge.
   *
   * "up to 6" includes 6 and "up to 12" includes 12; an implementation using `<` instead of `<=`
   * would be wrong by one branch at each edge, which is the classic defect in a band table and the
   * one no amount of mid-range testing can see.
   */
  it.each([
    [1, '5000.000'],
    [6, '5000.000'],
    [7, '7500.000'],
    [12, '7500.000'],
    [13, '10000.000'],
    [40, '10000.000'],
  ])('%i branch(es) requires %s JOD', (branches, expected) => {
    expect(requiredCapitalForType(branches).toFixed(3)).toBe(expected);
  });

  it('states the three bands the regulation names, and only three', () => {
    // A fourth band appearing here is a capital rule nobody decided.
    expect(CAPITAL_BANDS.map((b) => b.requiredJod)).toEqual([
      '5000',
      '7500',
      '10000',
    ]);
    expect(CAPITAL_BANDS.map((b) => b.upToBranches)).toEqual([
      6,
      12,
      Number.POSITIVE_INFINITY,
    ]);
  });
});

describe('the TYPES a licence covers are derived from its branches', () => {
  it('is empty for an empty scope', () => {
    expect(typesInScope([])).toEqual([]);
  });

  it('reports catalogue order, not the order branches were added', () => {
    // Otherwise the answer would depend on which branch somebody happened to record first, and a
    // screen listing "LIFE, GENERAL" for one office and "GENERAL, LIFE" for another would look
    // like a difference between the offices.
    expect(typesInScope([...life(1), ...general(1)])).toEqual([
      'GENERAL',
      'LIFE',
    ]);
    expect(typesInScope([...general(1), ...life(1)])).toEqual([
      'GENERAL',
      'LIFE',
    ]);
  });

  it('counts branches per type and omits a type with none', () => {
    const counts = branchCountByType([...general(3), ...life(2)]);
    expect(counts.get('GENERAL')).toBe(3);
    expect(counts.get('LIFE')).toBe(2);
    expect(branchCountByType(general(3)).has('LIFE')).toBe(false);
  });
});

describe('requiredCapitalForScope — "per type" is read as SUMMED', () => {
  it('is zero for an empty scope', () => {
    expect(requiredCapitalForScope([]).toFixed(3)).toBe('0.000');
  });

  it('charges one type once', () => {
    expect(requiredCapitalForScope(general(4)).toFixed(3)).toBe('5000.000');
  });

  it('charges BOTH types when both are held — 8 general + 3 life = 7,500 + 5,000', () => {
    // The reading, asserted so it is visible rather than buried: art. 4/a states its figures "per
    // type", so an office licensed for both pays both. Flagged in the config as a reading because
    // the comparison only ever produces a warning.
    expect(
      requiredCapitalForScope([...general(8), ...life(3)]).toFixed(3),
    ).toBe('12500.000');
  });

  it('is not the count of ALL branches lumped together', () => {
    // 4 general + 4 life is 8 branches in total but 5,000 + 5,000, NOT the 7,500 a single
    // eight-branch type would need. The distinction is the whole point of "per type".
    expect(
      requiredCapitalForScope([...general(4), ...life(4)]).toFixed(3),
    ).toBe('10000.000');
    expect(requiredCapitalForScope(general(8)).toFixed(3)).toBe('7500.000');
  });
});

describe('assessCapital — a WARNING input, never a refusal', () => {
  it('distinguishes NO capital recorded from capital that is too low', () => {
    // Conflating them would tell an office it is undercapitalised when nobody has typed the
    // number — a finding about its capital versus a missing fact about the office.
    const unrecorded = assessCapital(null, general(4));
    expect(unrecorded.capitalIsUnrecorded).toBe(true);
    expect(unrecorded.shortfall).toBeNull();
    expect(unrecorded.meetsRequirement).toBe(false);

    const tooLow = assessCapital(toMoney('3000'), general(4));
    expect(tooLow.capitalIsUnrecorded).toBe(false);
    expect(tooLow.shortfall?.toFixed(3)).toBe('2000.000');
    expect(tooLow.meetsRequirement).toBe(false);
  });

  it('meets the requirement exactly on the figure, not only above it', () => {
    const exact = assessCapital(toMoney('5000'), general(4));
    expect(exact.meetsRequirement).toBe(true);
    expect(exact.shortfall?.toFixed(3)).toBe('0.000');
  });

  it('reports a shortfall against the SUMMED requirement for both types', () => {
    const a = assessCapital(toMoney('10000'), [...general(8), ...life(3)]);
    expect(a.requiredCapital.toFixed(3)).toBe('12500.000');
    expect(a.shortfall?.toFixed(3)).toBe('2500.000');
  });

  it('is content with an empty scope and no capital figure at all', () => {
    // Nothing licensed, nothing required — but still "unrecorded", because the office genuinely
    // has not stated a capital and a screen should not imply it has.
    const a = assessCapital(null, []);
    expect(a.requiredCapital.toFixed(3)).toBe('0.000');
    expect(a.capitalIsUnrecorded).toBe(true);
  });
});

describe('breachesNaturalPersonOneTypeRule (art. 3/a)', () => {
  it('refuses a sole establishment holding BOTH types', () => {
    expect(
      breachesNaturalPersonOneTypeRule('NATURAL_PERSON', [
        ...general(1),
        ...life(1),
      ]),
    ).toBe(true);
  });

  it('allows a sole establishment many branches WITHIN one type', () => {
    // The limit is on TYPES, not branches — reading it as a branch limit would refuse a legitimate
    // sole establishment with a broad general practice.
    expect(
      breachesNaturalPersonOneTypeRule('NATURAL_PERSON', general(20)),
    ).toBe(false);
  });

  it('allows a CORPORATE broker both types', () => {
    expect(
      breachesNaturalPersonOneTypeRule('CORPORATE', [
        ...general(5),
        ...life(5),
      ]),
    ).toBe(false);
  });

  it('does not fire on a null broker kind — an insurance company is not a broker', () => {
    // `brokerKind` is NULL exactly when the organization is an insurance company (item (b)'s
    // CHECK), and art. 3/a is about brokers.
    expect(
      breachesNaturalPersonOneTypeRule(null, [...general(1), ...life(1)]),
    ).toBe(false);
  });
});

describe('item (f): the minimum approved staff a scope requires', () => {
  it('one type needs ONE approved person, both need TWO', () => {
    expect(requiredApprovedStaff(general(1))).toBe(1);
    expect(requiredApprovedStaff(general(12))).toBe(1);
    expect(requiredApprovedStaff([...general(1), ...life(1)])).toBe(2);
    expect(requiredApprovedStaff([...general(9), ...life(4)])).toBe(2);
  });

  it('the requirement follows the TYPE count, not the branch count', () => {
    // The distinction that keeps this from drifting into "more branches, more staff": art. 4/a
    // scales CAPITAL with branches, and item (f) scales STAFF with types. Twelve general branches
    // still need one approved person.
    expect(requiredApprovedStaff(general(12))).toBe(
      requiredApprovedStaff(general(1)),
    );
  });

  it('an EMPTY scope requires nobody — the gate nothing could satisfy', () => {
    /*
     * The case worth asserting rather than assuming. Returning 1 here would refuse the FIRST branch
     * of every brand-new office: it holds no branches, so it needs one approved person, so it can
     * never add the branch that would justify one. That is IMPROVEMENTS § 1.62's shape — a gate
     * whose precondition is unreachable — which this repository has shipped once already.
     */
    expect(requiredApprovedStaff([])).toBe(0);
    expect(assessStaffing([], 0).meetsRequirement).toBe(true);
  });

  it('assessStaffing reports BOTH numbers, so a refusal can state them', () => {
    const short = assessStaffing([...general(1), ...life(1)], 1);
    expect(short.requiredApprovedStaff).toBe(2);
    expect(short.currentApprovedStaff).toBe(1);
    expect(short.meetsRequirement).toBe(false);

    const met = assessStaffing([...general(1), ...life(1)], 2);
    expect(met.meetsRequirement).toBe(true);

    // More than enough is not a problem.
    expect(assessStaffing(general(3), 7).meetsRequirement).toBe(true);
  });
});

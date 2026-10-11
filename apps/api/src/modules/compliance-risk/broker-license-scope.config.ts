import { Prisma } from '@ibms/db';
import type { InsuranceLineCategory } from '@ibms/db';
import {
  compareMoney,
  subtractMoney,
  sumMoney,
  toMoney,
} from '../../common/money.util';

/**
 * MODULE 0 ITEM (e) — WHAT THE OFFICE IS LICENSED FOR, as pure functions.
 *
 * CBJ Instructions No. 9 of 2026:
 *   art. 3/a — a broker is licensed for insurance TYPES (life, general) and branches within each;
 *              a NATURAL PERSON (sole establishment) may hold ONE type only.
 *   art. 4/a — capital: 5,000 JOD per type up to 6 branches, 7,500 up to 12, 10,000 above 12.
 *
 * ## The TYPE is derived from the branch, never stored beside it
 *
 * `InsuranceLineCategory` has exactly two values — GENERAL and LIFE — which is precisely the pair
 * art. 3/a names, and every row of both line catalogues already carries one. So the types a licence
 * covers are the distinct categories of the branches it lists. A type column on the scope row would
 * be a second home for the same fact, and the copy is the one that drifts.
 */

/** One branch, reduced to the only property these rules need. Both catalogues satisfy it. */
export interface ScopedBranch {
  category: InsuranceLineCategory;
}

/**
 * ART. 4/a's BANDS, PER TYPE, BY BRANCH COUNT.
 *
 * Amounts are STRINGS, handed to `toMoney`. A JOD figure must never exist as a JS number in this
 * codebase (`money-decimal-jod.md`), and `5000` written as a numeric literal is exactly the kind
 * that gets added to another one with `+` three commits later.
 */
export const CAPITAL_BANDS: readonly {
  upToBranches: number;
  requiredJod: string;
}[] = [
  { upToBranches: 6, requiredJod: '5000' },
  { upToBranches: 12, requiredJod: '7500' },
  { upToBranches: Number.POSITIVE_INFINITY, requiredJod: '10000' },
];

/**
 * The capital art. 4/a requires FOR ONE TYPE, given how many branches are held in it.
 *
 * Zero branches requires zero: a type with no branches is a type the office is not licensed for, so
 * charging it 5,000 JOD would invent a requirement for something nobody applied for.
 */
export function requiredCapitalForType(branchCount: number): Prisma.Decimal {
  if (branchCount <= 0) return toMoney('0');
  const band = CAPITAL_BANDS.find((b) => branchCount <= b.upToBranches);
  // Unreachable while the last band is Infinity; `?? last` rather than a non-null assertion so a
  // future edit that bounds the top band degrades to the highest requirement rather than crashing.
  return toMoney((band ?? CAPITAL_BANDS[CAPITAL_BANDS.length - 1]).requiredJod);
}

/** How many branches the licence holds in each type. Types with none are absent, not zero. */
export function branchCountByType(
  branches: readonly ScopedBranch[],
): Map<InsuranceLineCategory, number> {
  const counts = new Map<InsuranceLineCategory, number>();
  for (const b of branches) {
    counts.set(b.category, (counts.get(b.category) ?? 0) + 1);
  }
  return counts;
}

/**
 * The TYPES this licence covers — the distinct categories of its branches, in catalogue order
 * (GENERAL, LIFE) rather than insertion order, so the answer does not depend on the order branches
 * happened to be added.
 */
export function typesInScope(
  branches: readonly ScopedBranch[],
): InsuranceLineCategory[] {
  const present = branchCountByType(branches);
  return (['GENERAL', 'LIFE'] as InsuranceLineCategory[]).filter((t) =>
    present.has(t),
  );
}

/**
 * The capital art. 4/a requires for the WHOLE scope.
 *
 * ## "PER TYPE" IS READ AS SUMMED, AND THAT IS A READING
 *
 * Art. 4/a states the figures "per type", so an office licensed for both pays both: general with 8
 * branches (7,500) plus life with 3 (5,000) requires 12,500. The alternative reading — one
 * requirement for the office, taken from whichever type has the most branches — is not obviously
 * wrong, and this is flagged rather than buried BECAUSE the comparison only ever produces a
 * WARNING. A reading that can only make a warning appear or not appear is a safe place to be
 * approximately right and say so; the same reading inside a refusal would not be.
 */
export function requiredCapitalForScope(
  branches: readonly ScopedBranch[],
): Prisma.Decimal {
  const perType = [...branchCountByType(branches).values()].map((count) =>
    requiredCapitalForType(count),
  );
  // `sumMoney([])` of an empty scope is zero, which is correct: nothing licensed, nothing required.
  return sumMoney(perType);
}

export interface CapitalAssessment {
  /** What art. 4/a requires for this scope, as a JOD amount at fils precision. */
  requiredCapital: Prisma.Decimal;
  /** What the office has recorded, or null when it has recorded nothing. */
  paidUpCapital: Prisma.Decimal | null;
  /** How far short, or zero. Null when no capital is recorded — see `capitalIsUnrecorded`. */
  shortfall: Prisma.Decimal | null;
  /** True only when a capital figure EXISTS and is at least the requirement. */
  meetsRequirement: boolean;
  /**
   * No capital recorded at all. Distinguished from "recorded and too low" deliberately: one is a
   * missing fact about the office and the other is a finding about its capital, and a screen that
   * conflated them would tell an office it is undercapitalised when nobody has typed the number.
   */
  capitalIsUnrecorded: boolean;
}

/** Art. 4/a, assessed. A WARNING input — nothing in this module refuses on it. */
export function assessCapital(
  paidUpCapital: Prisma.Decimal | null,
  branches: readonly ScopedBranch[],
): CapitalAssessment {
  const requiredCapital = requiredCapitalForScope(branches);
  if (paidUpCapital === null) {
    return {
      requiredCapital,
      paidUpCapital: null,
      shortfall: null,
      meetsRequirement: false,
      capitalIsUnrecorded: true,
    };
  }
  const meets = compareMoney(paidUpCapital, requiredCapital) >= 0;
  return {
    requiredCapital,
    paidUpCapital,
    shortfall: meets
      ? toMoney('0')
      : subtractMoney(requiredCapital, paidUpCapital),
    meetsRequirement: meets,
    capitalIsUnrecorded: false,
  };
}

/**
 * ART. 3/a — would this scope leave a NATURAL PERSON holding more than one insurance type?
 *
 * A sole establishment is one person and may hold ONE type only. A corporate broker may hold both,
 * so this is false for them whatever the scope.
 *
 * Item (b) recorded this rule and deliberately did not enforce it, because no column stored a scope
 * to check against. This is that enforcement — and it is APPLICATION-LEVEL by necessity, not by
 * preference: deciding it needs `Organization.brokerKind`, the scope rows, and the catalogue's
 * `category`, which is three tables. A Postgres CHECK compares columns of one row of one table.
 */
export function breachesNaturalPersonOneTypeRule(
  brokerKind: 'NATURAL_PERSON' | 'CORPORATE' | null,
  branches: readonly ScopedBranch[],
): boolean {
  if (brokerKind !== 'NATURAL_PERSON') return false;
  return typesInScope(branches).length > 1;
}

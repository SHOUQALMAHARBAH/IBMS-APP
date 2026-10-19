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
 * ## ART. 13/b/2 IS DECLARED UNIMPLEMENTED, AND MUST NOT BE BUILT FROM ITS CAPITAL FIGURE ALONE
 *
 * Art. 13/b allows a CORPORATE broker to open more than five branches INSIDE THE KINGDOM, or any
 * branch abroad, subject to four CONJUNCTIVE conditions: three years since licensing with actual
 * practice (13/b/1), paid-up capital of at least 50,000 JOD (13/b/2), operating profits in the two
 * preceding years (13/b/3), and a legal form of public shareholding, private shareholding or LLC
 * (13/b/4).
 *
 * NONE OF IT IS IMPLEMENTED, and the reason is that the system does not model what it counts: art.
 * 13's فروع are PHYSICAL BRANCH OFFICES, and this product has no physical-branch concept at all.
 * Art. 4/a's فروع above are INSURANCE BRANCHES — lines within a type — which is a different noun
 * sharing a word.
 *
 * So a guard written against the branch count THIS file has would fire on insurance lines and tell
 * every office holding six or more of them — the ordinary case — that it needs 50,000 JOD, with no
 * basis in the text. That is the same class of false regulatory finding as the provider being
 * reported as an unlicensed office, and it is why the article is named here and left unbuilt
 * rather than approximated.
 *
 * Were physical branches modelled later, a capital-only guard would STILL be wrong: the four
 * conditions are conjunctive, and capital is one of them.
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
/**
 * The insurance TYPES, in catalogue order.
 *
 * Exported because item (g) derives a PERSON's approved types the same way this file derives a
 * LICENCE's, and two copies of an order are two chances for two screens to list them differently.
 * It is not `Object.values(InsuranceLineCategory)` because a Prisma enum's runtime order follows the
 * schema and a reordered schema would silently reorder every screen.
 */
export const INSURANCE_LINE_CATEGORIES: readonly InsuranceLineCategory[] = [
  'GENERAL',
  'LIFE',
];

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
  return INSURANCE_LINE_CATEGORIES.filter((t) => present.has(t));
}

/**
 * THE UNIT THE BRANCHES ARE COUNTED IN IS UNDER VERIFICATION WITH THE CENTRAL BANK.
 *
 * Art. 4/a's slabs count BRANCHES within a type — up to 6, up to 12, more than 12 — so the counting
 * unit decides how much capital an office must hold. This function counts rows of OUR catalogue,
 * which is 32 lines.
 *
 * An unattributed reply to a question put to the Central Bank states that those 32 are a COMMERCIAL
 * PRODUCT catalogue while the Bank licenses against a shorter REGULATORY classification — its
 * example being that our several liability lines fall under one regulatory branch, "general
 * liability". That is consistent with the 18-general-and-8-life list in the Bank's own published
 * broker re-registration form, which reads like a licensing classification rather than a product
 * list.
 *
 * ## WHY NOTHING IS CHANGED HERE, AND WHY THE NOTE EXISTS ANYWAY
 *
 * The reply is NOT AUTHORITATIVE and is recorded as unattributed: no reference number, no signature,
 * it does not contain the form or the list that was asked for, and its own closing line directs us to
 * submit a formal written request to obtain the annexes. Nothing is built on it.
 *
 * So the catalogue is untouched — merging or renaming a line would change what every existing licence
 * MEANS — and no mapping column is added, because an empty column with no reader is the
 * `dpoAlternateApproverUserId` precedent: it existed for exactly this kind of problem, acquired no
 * reader, and is now marked superseded. The column arrives with the official list that populates it.
 *
 * What IS done is to stop the screens stating a settled answer. The figure below is still computed
 * and still shown; what changes is that both surfaces displaying it now say the counting unit is
 * under verification. The owner's rule is that the system does not state as settled what is not, and
 * a capital requirement is a money figure an office acts on.
 *
 * ## 2026-10-19 — THE REOPENING CONDITION ABOVE IS MET. THE ANSWER IS WRITTEN AND ATTRIBUTED.
 *
 * The owner's folder holds a written answer from the Central Bank's insurance supervision side:
 * **26 officially recognised branches, 18 general and 8 life/medical**, with the instruction that
 * *"for the purposes of the article 4/a capital tiers you must base your screen on the 26 official
 * branches only, and any extra branch in your catalogue must be programmatically linked as a
 * Sub-category belonging to one of the 18 general or the 8 life, so that your arithmetic matches the
 * supervisory system."*
 *
 * So this function is WRONG as it stands — it counts our rows — and the fix is authorised. It is not
 * built yet, and what is missing is the LIST: which 18 and which 8, and which of our 32 belongs to
 * each. That is a regulatory classification, and inventing it would put an internal guess inside a
 * capital figure, which is the one thing this whole comment exists to refuse.
 *
 * ## AND THE MEASUREMENT THAT DECIDES THE SHAPE — it is NOT the collapse the instruction assumes
 *
 * Measured on the seeded catalogue: ours is **27 GENERAL and 5 LIFE**.
 *
 *     GENERAL   27 ours -> 18 official   nine of ours collapse into parents
 *     LIFE       5 ours ->  8 official   THREE OFFICIAL BRANCHES HAVE NO CHILD IN OUR CATALOGUE
 *
 * A parent FK on our 32 rows can express the first line and CANNOT express the second: three
 * official life/medical branches would exist only as the absence of a row. Since the tier counts
 * DISTINCT OFFICIAL BRANCHES an office is licensed for, an office licensed for one of those three
 * could not be represented at all, and its capital tier would be computed on a scope that cannot
 * include it — the same arithmetic error one level down.
 *
 * So the 26 must be their OWN managed table, seeded with all 26 including the three we have no child
 * for, and `InsuranceLine` points INTO it. That is a bigger change than "a parent column", it is the
 * only shape that makes the arithmetic match the supervisory system, and it is what the list will
 * populate when it arrives.
 *
 * ## WHY THE WARNING LINE IS STILL HERE
 *
 * The instruction drops it, on the ground that there is no longer a divergence to warn about. There
 * is, until the mapping lands: this function still counts our rows, so the figure can still name a
 * higher tier than the regulator would. Dropping the sentence now would leave the figure wrong AND
 * unflagged, which is strictly worse than either. It goes with the mapping, in one change.
 */

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

/**
 * MODULE 0 ITEM (f) — THE MINIMUM APPROVED STAFF a licence scope requires.
 *
 * One approved person for one insurance type; two for both. A whole number, not a per-type map: the
 * requirement is about the office having enough approved people, and an office licensed for both
 * types with two approved people satisfies it however those two are themselves scoped.
 *
 * ## Why the ZERO case is 1 and not 0
 *
 * A scope with no branches at all has no types, and `requiredApprovedStaff([])` returns 0 —
 * truthfully, because an office that is licensed for nothing needs nobody approved. The moment it
 * holds one branch it needs one approved person. Returning 1 for the empty scope would refuse the
 * FIRST branch of a brand-new office forever, which is a gate nothing can satisfy — the § 1.62 shape
 * this repository has already shipped once.
 */
export function requiredApprovedStaff(
  branches: readonly ScopedBranch[],
): number {
  const types = typesInScope(branches).length;
  if (types === 0) return 0;
  return types >= 2 ? 2 : 1;
}

/** What item (f) decided, with both numbers, so a refusal can state them rather than assert them. */
export interface StaffingAssessment {
  requiredApprovedStaff: number;
  currentApprovedStaff: number;
  meetsRequirement: boolean;
}

export function assessStaffing(
  branches: readonly ScopedBranch[],
  currentApprovedStaff: number,
): StaffingAssessment {
  const required = requiredApprovedStaff(branches);
  return {
    requiredApprovedStaff: required,
    currentApprovedStaff,
    meetsRequirement: currentApprovedStaff >= required,
  };
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

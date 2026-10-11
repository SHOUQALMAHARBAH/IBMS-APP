import type { CbjApprovalStatus, InsuranceLineCategory } from '@ibms/db';
import { INSURANCE_LINE_CATEGORIES } from '../compliance-risk/broker-license-scope.config';
// Re-exported so a reader of the marker finds the refusal that protects it; the HOME is
// `common/`, because both DTOs that carry it live there and in a module, and `common` importing
// from `modules` is the wrong direction.
export {
  CBJ_IN_LICENSED_ROLE_REFUSAL,
  looksLikeCbjApproval,
} from '../../common/is-not-cbj-approval.validator';

/**
 * MODULE 0 ITEM (g) — A PERSON'S CBJ APPROVAL, as pure logic.
 *
 * ## What this is, and what it deliberately is not
 *
 * The marker records that the CBJ approved ONE PERSON to act for this broker, in which insurance
 * type, for which branches, on what date, and with what standing. Item (f)'s minimum-staff rule
 * reads it, and the vacancy timers and training counter will.
 *
 * It is **not an authorization input.** Item (h) puts scope on the ROLE; a permission decision never
 * reads this. That is not a style preference — a marker on a person that silently widened or
 * narrowed what they could do would be a second role system with no matrix, no catalogue and no
 * screen that lists it. `employee-cbj-approval.guard.spec.ts` fails if any permission-evaluation
 * site starts reading it.
 *
 * ## The TYPE is derived from the BRANCH, exactly as it is for the licence
 *
 * Item (e) established the argument one level up and it holds here unchanged: `InsuranceLineCategory`
 * already carries GENERAL / LIFE on every row of both line catalogues, so the types a person is
 * approved for ARE the distinct categories of their approved branches. A stored type beside the
 * branch would be a second home for one fact, and the copy is the one that drifts.
 */

/** The branch shape these functions need — the category alone, so they stay pure and testable. */
export interface ApprovedBranch {
  category: InsuranceLineCategory;
}

/**
 * The insurance types a person is approved for: the distinct categories of their branches, in
 * CATALOGUE order rather than insertion order, so the answer cannot depend on which branch somebody
 * happened to record first.
 */
export function approvedTypes(
  branches: readonly ApprovedBranch[],
): InsuranceLineCategory[] {
  const present = new Set(branches.map((b) => b.category));
  return INSURANCE_LINE_CATEGORIES.filter((category) => present.has(category));
}

/**
 * Whether an approval counts toward item (f)'s minimum staff.
 *
 * ONLY `CURRENT`. A suspended approval is precisely the case the status exists to represent — the
 * person is still on the record and may not act — and counting it would let an office satisfy the
 * staffing minimum with somebody the CBJ has stood down. `CANCELLED` likewise.
 *
 * Written as an explicit equality rather than `!== 'CANCELLED'`, so a FOURTH status added later
 * fails closed (it would not count) instead of being silently admitted.
 */
export function approvalCounts(
  status: CbjApprovalStatus | null | undefined,
): boolean {
  return status === 'CURRENT';
}

/** The approval as a screen reads it. `types` is derived, never stored, and never sent in. */
export interface CbjApprovalView {
  status: CbjApprovalStatus | null;
  /** NULL is a real state: 54 migrated rows carry a status whose date nobody recorded. */
  approvalDate: string | null;
  /** Derived from `branches`. Catalogue order. */
  types: InsuranceLineCategory[];
  branches: {
    id: string;
    insuranceLineId: string | null;
    officeInsuranceLineId: string | null;
    category: InsuranceLineCategory;
    nameEn: string;
    nameAr: string;
    code: string | null;
  }[];
  /** Whether this person counts toward item (f)'s minimum staff. Computed, so a screen and the
   *  refusal cannot disagree about who counts. */
  countsTowardMinimumStaff: boolean;
}

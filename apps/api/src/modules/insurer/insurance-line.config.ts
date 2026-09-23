import { canonicalNameKey } from '../../common/company-name.util';
import type {
  OfficeLineRow,
  StandardLineRow,
} from '../../repositories/insurance-line.repository';

/**
 * The insurance-line vocabulary — the pure half.
 *
 * One view type covers both halves of the list, because a caller picking a line
 * should not have to care whether it came from the standard 32 or from something
 * this office added. `isStandard` is exposed anyway, for the one thing that does
 * differ: only an office's own addition can be renamed.
 */
export interface InsuranceLineView {
  id: string;
  /** The stable machine name, for a standard line. NULL for an office addition:
   *  codes are platform-wide identifiers and an office cannot mint one, because two
   *  offices inventing `PET` for different things would make the code meaningless. */
  code: string | null;
  nameEn: string;
  nameAr: string;
  category: 'GENERAL' | 'LIFE';
  /** FALSE for a line this office added. The only behavioural difference. */
  isStandard: boolean;
}

export function standardLineView(row: StandardLineRow): InsuranceLineView {
  return {
    id: row.id,
    code: row.code,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    category: row.category,
    isStandard: true,
  };
}

export function officeLineView(row: OfficeLineRow): InsuranceLineView {
  return {
    id: row.id,
    code: null,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    category: row.category,
    isStandard: false,
  };
}

/** Both canonical keys for a pair of names, computed by the one function that
 *  decides whether two names are the same name. */
export function canonicalKeysFor(names: { nameEn: string; nameAr: string }): {
  canonicalEn: string;
  canonicalAr: string;
} {
  return {
    canonicalEn: canonicalNameKey(names.nameEn),
    canonicalAr: canonicalNameKey(names.nameAr),
  };
}

/**
 * The standard line that already means this, if there is one.
 *
 * The check an addition has to pass first, and the reason it is blocking rather than
 * a suggestion: the standard list is the shared vocabulary, so an office adding its
 * own copy of a line that already exists creates exactly the fragmentation the
 * managed list exists to prevent — two ids meaning Motor Comprehensive, one of which
 * no other office can match.
 *
 * Matched on EITHER script. Somebody adding a line usually types one name carefully
 * and the other casually, so a collision in one language is a duplicate even when
 * the other differs.
 *
 * Computed in memory over 32 rows rather than by storing canonical keys on the
 * standard table: the application cannot write that table, so a stale derived column
 * there would have no repair path.
 */
export function standardLineColliding(
  standard: readonly StandardLineRow[],
  keys: { canonicalEn: string; canonicalAr: string },
): StandardLineRow | null {
  return (
    standard.find(
      (row) =>
        canonicalNameKey(row.nameEn) === keys.canonicalEn ||
        canonicalNameKey(row.nameAr) === keys.canonicalAr,
    ) ?? null
  );
}

/**
 * The whole pickable vocabulary for one office: the standard list first, in market
 * order, then the office's own additions.
 *
 * Standard-first rather than interleaved alphabetically, deliberately. The standard
 * order is how the market names these products (compulsory motor before
 * comprehensive, the four engineering lines together), and sorting the merged list
 * alphabetically in either script would destroy that grouping — which is the one
 * thing `displayOrder` exists to carry.
 */
export function pickableLines(
  standard: readonly StandardLineRow[],
  additions: readonly OfficeLineRow[],
): InsuranceLineView[] {
  return [...standard.map(standardLineView), ...additions.map(officeLineView)];
}

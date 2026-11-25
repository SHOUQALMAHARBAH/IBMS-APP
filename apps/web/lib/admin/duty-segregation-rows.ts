import type { Language, TranslationKey } from '../i18n/translations';
import { permissionDisplayName } from './permission-names';
import type { DutySegregationReadiness } from './role-admin-api';

/*
 * 🔴 OWNER DECISION 163 RULING 4 — THE TWO ROWS OF THE DUAL-CONTROL TABLE THAT READ ALIKE.
 *
 * `NeedsAssessment` has TWO maker/checker pairs — reviewer and approver — and both are gated by
 * `needs-assessment.approve`, so `/settings/roles`'s table showed «يعتمد تقييم حاجات العميل» on
 * two rows with nothing to tell them apart. Decision 157 ruling 11 recorded that as a defect the
 * owner accepted at the time («عيب معلوم قبلته الإدارة»); she has now ruled it:
 *
 *     «يعتمد تقييم حاجات العميل (راجعه)»   and   «يعتمد تقييم حاجات العميل (اعتمده)»
 *
 * ⛔ AND THE TWO WORDS ARE NOT COMPOSED. Her ruling says «الكلمتان موجودتان بصفحة التقييم», and
 * they are: `nadReviewedBy` («راجعه») and `nadApprovedBy` («اعتمده») are the labels
 * `/needs-assessments/[id]` already shows beside the two people. The format
 * `dutySegPermissionQualified` carries a parenthesis and two placeholders and no word of its own.
 *
 * ⛔ THE QUALIFIER IS KEYED ON THE CHECKER FIELD, NEVER ON THE PERMISSION OR THE ENTITY. Both
 * rows share the permission AND the entity; the field is the one thing they differ by, and it is
 * the pair's identity in the registry — one escape column per constraint, which
 * `maker-checker-pairs.config.ts` calls load-bearing by name. ⛔ And never by splitting
 * `pairLabel`: that is prose, decision 157 ruling 11 took it off this table for being
 * programmatic, and a screen parsing it breaks the day somebody rewords it.
 *
 * ⛔ AND THE REGISTRY IS NOT DE-DUPLICATED. They are two different acts with two different
 * escape columns; collapsing them would let a declared combined REVIEW excuse a self-APPROVAL.
 * What changed is the DISPLAY.
 */
const CHECKER_FIELD_QUALIFIER: Record<string, TranslationKey> = {
  reviewedByUserId: 'nadReviewedBy',
  approvedByUserId: 'nadApprovedBy',
};

type DutyRow = Pick<
  DutySegregationReadiness,
  'checkerPermission' | 'checkerField'
>;

/**
 * The qualifier key for one row IN THE CONTEXT OF THE WHOLE TABLE, or `null` where the row needs
 * none.
 *
 * 🔴 AND THE SECOND ARGUMENT IS NOT A CONVENIENCE — `duty-segregation-rows.test.ts` CAUGHT ITS
 * ABSENCE. The first version keyed on the checker field alone, and `kyc.approve` also writes
 * `approvedByUserId`: its row would have read «… (اعتمده)» while being the only row with that
 * name, which is noise on a table a reader scans. ⟶ A qualifier exists to tell two rows apart,
 * so whether a row gets one is a property of the TABLE and never of the row by itself.
 */
export function dutyRowQualifierKey(
  row: DutyRow,
  rows: readonly DutyRow[],
): TranslationKey | null {
  const sharesName = rows.some(
    (other) =>
      other.checkerPermission === row.checkerPermission &&
      other.checkerField !== row.checkerField,
  );
  if (!sharesName) return null;
  return CHECKER_FIELD_QUALIFIER[row.checkerField] ?? null;
}

/**
 * The name the dual-control table shows for one row — the permission's ratified name, qualified
 * where two rows would otherwise read alike.
 *
 * English keeps the CODE (decision 127: no English name is ruled) and is qualified the same way,
 * because the duplication is a property of the ROWS rather than of the Arabic.
 */
export function dutyRowName(
  row: DutyRow,
  rows: readonly DutyRow[],
  language: Language,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const name = permissionDisplayName(row.checkerPermission, language);
  const key = dutyRowQualifierKey(row, rows);
  if (!key) return name;
  return t('dutySegPermissionQualified', { name, qualifier: t(key) });
}

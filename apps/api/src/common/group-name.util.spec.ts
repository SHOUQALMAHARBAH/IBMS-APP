import { describe, expect, it } from 'vitest';
import { unanimousGroupName } from './group-name.util';

/**
 * Contents §أ row ١١ — the rule that decides a GROUP's Arabic name from its rows'.
 *
 * Every branch, because each one is a different wrong answer if it is got wrong: branch one
 * renders the name, and the other two render the stored English the group key already carries.
 */
describe('unanimousGroupName (contents §أ row ١١)', () => {
  it('answers the one name when every row that has one agrees', () => {
    expect(
      unanimousGroupName([
        'تأمين جميع أخطار الممتلكات',
        'تأمين جميع أخطار الممتلكات',
      ]),
    ).toBe('تأمين جميع أخطار الممتلكات');
  });

  it('answers null when no row carries a name', () => {
    expect(unanimousGroupName([null, null, undefined])).toBeNull();
    expect(unanimousGroupName([])).toBeNull();
  });

  /**
   * 🔴 THE BRANCH THAT IS THE WHOLE REASON THIS IS NOT «THE FIRST ROW'S NAME».
   *
   * The by-line group key is the STORED ENGLISH STRING and the Arabic name comes from the line
   * FK, so one group can hold rows pointing at different catalogue rows. Taking either name
   * would print a label that names one line over rows belonging to another — and WHICH one it
   * took would depend on the planner's window, since the analytics queries read
   * `orderBy: { createdAt: 'asc' }` with a `take` cap.
   */
  it('answers null when two rows disagree, rather than picking one', () => {
    expect(
      unanimousGroupName(['تأمين المركبات الشامل', 'تأمين الحياة الجماعي']),
    ).toBeNull();
  });

  /**
   * ⚠️ ABSENCE IS NOT A DISAGREEMENT, and this is the case that makes the rule useful rather
   * than merely safe. `insuranceLineId` is NULLABLE — migration `20261019100000` «mapped what
   * it could» — so an unmigrated row answers `null`, which means «no Arabic name is KNOWN for
   * this row», not «this line has none». It abstains; it does not vote. A rule that demanded
   * every row carry the name would drop the Arabic label from any group holding one old row.
   */
  it('ignores a row that carries no name instead of counting it as a second answer', () => {
    expect(
      unanimousGroupName([null, 'تأمين المسؤولية المدنية العامة', undefined]),
    ).toBe('تأمين المسؤولية المدنية العامة');
  });

  /**
   * ⚠️ A BLANK IS ABSENT, NOT A VALUE — matching `insuranceLineNameAr` and `preferLanguage`.
   * An empty string renders as nothing at all, which is decision 148's own defect: a missing
   * label printed an empty category cell on four screens and nobody was told.
   */
  it('treats a blank or whitespace-only name as absent', () => {
    expect(unanimousGroupName(['   ', ''])).toBeNull();
    expect(unanimousGroupName(['  ', 'التأمين الصحي / الطبي'])).toBe(
      'التأمين الصحي / الطبي',
    );
  });

  it('trims, so one name written with padding is not two names', () => {
    expect(
      unanimousGroupName(['تأمين الحياة الجماعي', '  تأمين الحياة الجماعي  ']),
    ).toBe('تأمين الحياة الجماعي');
  });
});

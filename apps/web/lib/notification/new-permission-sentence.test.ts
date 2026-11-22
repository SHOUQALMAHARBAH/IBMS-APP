import { describe, expect, it } from 'vitest';

import { PERMISSION_CATALOGUE } from '../../e2e/fixtures/role-permissions';
import { describePermission } from '../admin/permission-descriptions';
import { permissionNameAr } from '../admin/permission-names';
import { translate, type TranslationKey } from '../i18n/translations';
import { newPermissionSentence } from './new-permission-sentence';

/**
 * 🔴 OWNER DECISION 156 RULING 2 — THE BELL DOES NOT SAY THE SAME WORDS TWICE.
 *
 * Her sentence (decision 133) has a NAME slot and a DESCRIPTION slot. 158 of the 196 ratified
 * names are sliced out of the opening of the very description that follows them, so once
 * decision 127's names shipped the bell would have read:
 *
 *   «صلاحية جديدة في النظام: يُقرّ بأن ترخيص المكتب قيد التجديد. يُقرّ بأن ترخيص المكتب قيد
 *    التجديد، وأنه لم يصله…»
 *
 * Her ruling: where the name is inside the description, print the already-ratified sentence
 * that has NO name slot. ⛔ Neither template's words change — only which is chosen.
 *
 * And its second half, «الشرح الذي ينتهي بنقطة لا تُضاف بعده نقطة ثانية»: 17 of the 234 Arabic
 * descriptions already end in a full stop and the template writes its own after the slot.
 */

const t = ((key: TranslationKey, vars?: Record<string, string>) =>
  translate('AR', key, vars)) as (
  key: TranslationKey,
  vars?: Record<string, string>,
) => string;

const tEn = ((key: TranslationKey, vars?: Record<string, string>) =>
  translate('EN', key, vars)) as (
  key: TranslationKey,
  vars?: Record<string, string>,
) => string;

const notice = (code: string) => ({ code, screen: null, routes: ['GET /x'] });

describe('owner decision 156 ruling 2 — the new-permission sentence', () => {
  it('prints a sliced name ONCE, not twice — license-renewal.declare', () => {
    const code = 'license-renewal.declare';
    const name = permissionNameAr(code);
    const sentence = newPermissionSentence(notice(code), t, 'AR');

    // The name IS the opening of its own description, which is why this case exists.
    expect(describePermission(code, 'AR')).toContain(name);
    // So the words appear exactly once in the rendered sentence.
    expect(sentence.split(name).length - 1).toBe(1);
  });

  it('writes no «..» after a description that already ends in a full stop', () => {
    const code = 'license-renewal.declare';
    // The precondition, asserted rather than assumed: this is one of the 17 that end in a stop.
    expect(describePermission(code, 'AR')?.trimEnd().endsWith('.')).toBe(true);
    expect(newPermissionSentence(notice(code), t, 'AR')).not.toContain('..');
  });

  it('still prints name THEN description when the name is not inside it', () => {
    // `retention.archive.retrieve` is one of the 17 names that are the owner's own words rather
    // than a slice, so it is NOT in its description and her name slot is the right one.
    const code = 'retention.archive.retrieve';
    const name = permissionNameAr(code);
    const description = describePermission(code, 'AR') ?? '';
    expect(description).not.toContain(name);

    const sentence = newPermissionSentence(notice(code), t, 'AR');
    expect(sentence).toContain(name);
    expect(sentence).toContain(description);
    expect(sentence.indexOf(name)).toBeLessThan(sentence.indexOf(description));
  });

  it('prints a family name for a code a family row covers', () => {
    // `customer.read` has no single name; «عميل · عرض» is not in its description, so it is named.
    const sentence = newPermissionSentence(notice('customer.read'), t, 'AR');
    expect(sentence).toContain(permissionNameAr('customer.read'));
  });

  /*
   * NON-VACUITY, and it is what makes the ruling checkable rather than asserted. If EVERY code
   * took the no-name branch the first three tests would still pass — so the split is measured
   * against the whole catalogue and both sides must be non-empty, at her own figures.
   */
  it('splits the catalogue the way her table does: 158 contained, 76 not', () => {
    let contained = 0;
    let named = 0;
    for (const entry of PERMISSION_CATALOGUE) {
      const name = permissionNameAr(entry.code);
      const description = describePermission(entry.code, 'AR') ?? '';
      if (description.includes(name)) contained += 1;
      else named += 1;
    }
    expect(contained).toBe(158);
    expect(named).toBe(76);
    expect(contained + named).toBe(234);
  });

  /*
   * ⛔ ENGLISH TAKES THE NO-NAME BRANCH, which is what it rendered before: 233 of the 234 codes
   * had no name at all. Putting an Arabic name into an English sentence would be inventing an
   * English behaviour nobody has ruled.
   */
  it('puts no Arabic name into the English sentence', () => {
    const code = 'retention.archive.retrieve';
    const sentence = newPermissionSentence(notice(code), tEn, 'EN');
    expect(sentence).not.toContain(permissionNameAr(code));
    expect(sentence).toContain(describePermission(code, 'EN') ?? '');
  });
});

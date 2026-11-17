import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ENUM_LABEL } from './enum-labels';
import { LANGUAGES, lookupOptional } from './translations';

/**
 * 🔴 OWNER DECISION 148 — THE DOCUMENT-CATEGORY LABELS, RE-SLICED FROM HER PAPER AND COMPARED.
 *
 * ## THIS CLOSED A DEFECT IN SOMETHING ALREADY BUILT
 *
 * Measured 2026-11-16: `ENUM_LABEL.DocumentCategory` carried **13 keys for 16 schema members**,
 * and `translate()` returns `undefined` for a missing key — so React rendered NOTHING. **7 of 15
 * `Document` rows on dev showed a BLANK category cell**, on `/documents`, `/audit-trail`,
 * `PolicySection` and `EntitySearch`. Nothing failed, because nothing was checking: the map is
 * `satisfies Labels<string>`, which enforces no coverage at all.
 *
 * ⟶ The three words are HERS. They are sliced from decision 148 §٣ by script and never retyped
 *   here or in the dictionary, and this file re-slices them so a hand-edit fails with the source
 *   named.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const D148 = join(
  REPO,
  'docs',
  'decision-148-document-category-labels-and-download-button.md',
);

/**
 * Her §٣ table, by site cell.
 *
 * ⚠️ FOUND BY SITE CELL RATHER THAN BY POSITION. The table carries FIVE ratified strings and
 * four of them are categories; the fifth is the download button. A slice taking «the last row»
 * would put a button label on a document category, and the comparison would still pass against a
 * dictionary that had made the same mistake.
 */
function ratified(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(D148, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 2 || /^-+$/.test(cells[0])) continue;
    out[cells[0]] = cells[1];
  }
  return out;
}

/** The label she ratified for one schema member. */
function forMember(member: string): string {
  const rows = ratified();
  const key = `فئة المستند \`${member}\``;
  expect(
    rows[key],
    `decision 148 has no ratified label for ${member} — the slice source moved`,
  ).toBeTruthy();
  return rows[key];
}

function ar(key: string): string {
  const value = lookupOptional('AR', key);
  expect(value, `${key} has no Arabic value at all`).toBeTruthy();
  return value as string;
}

describe('OWNER DECISION 148 — the document-category labels are hers, byte for byte', () => {
  it('slices her whole table, non-vacuously', () => {
    /*
     * The floor every comparison below rests on. A drifted row matcher would make each assertion
     * compare undefined to undefined — the clean-nothing shape this repository has paid for.
     */
    const rows = ratified();
    expect(Object.keys(rows)).toHaveLength(6); // her heading row plus five ratified strings
    expect(
      Object.keys(rows).filter((k) => k.startsWith('فئة المستند')),
    ).toHaveLength(4);
  });

  it('🔴 and the DOWNLOAD BUTTON is hers too — the fifth string in that table', () => {
    /*
     * `GET /documents/:id/content` shipped built, enforced and e2e-proven with NO control, because
     * «تنزيل» ships on seven sibling buttons and «الملف» on the documents screen itself — and
     * joining two shipped words into a third is the one thing decision 125 forbids. She ruled it.
     *
     * ⚠️ FOUND BY ITS SITE CELL, not by position: four of the five rows are CATEGORIES, and a
     * slice taking «the last row» would survive a reordering of her table while silently
     * swapping a category label onto a button.
     */
    const rows = ratified();
    const site = Object.keys(rows).find((k) => k.startsWith('زرّ تنزيل'));
    expect(site, 'decision 148 no longer carries the download-button row').toBeTruthy();
    expect(
      ar('docDownloadStoredButton'),
      'the stored-file download label is not byte-identical to OWNER DECISION 148',
    ).toBe(rows[site!]);
    expect(lookupOptional('EN', 'docDownloadStoredButton')).toBeTruthy();
  });

  it.each([
    ['BROKER_LICENSE_CERTIFICATE', 'docCategoryBrokerLicenseCertificate'],
    ['INSURER_LICENSE_CERTIFICATE', 'docCategoryInsurerLicenseCertificate'],
    ['REGULATORY_DECISION', 'docCategoryRegulatoryDecision'],
    // OWNER DECISION 142's stored certificate, worded by the same decision 148.
    ['CERTIFICATE_OF_INSURANCE', 'docCategoryCertificateOfInsurance'],
  ])('%s carries exactly what she ratified', (member, key) => {
    expect(
      ar(key),
      `${member}'s label is not byte-identical to OWNER DECISION 148. It is HER word: ` +
        're-slice it from docs/decision-148-...md rather than editing it here.',
    ).toBe(forMember(member));
  });

  it('⛔ and the two licence certificates do NOT share a label', () => {
    /*
     * Not decoration. They are DIFFERENT INSTRUMENTS (Law No. 12 of 2021 art. 82), which is why
     * the schema gives each its own category rather than sharing one — and her two labels differ
     * only by «الوسيط» against «شركة التأمين». A copy-paste that left them identical would make
     * the two indistinguishable in exactly the query a CBJ inspection asks.
     */
    expect(ar('docCategoryBrokerLicenseCertificate')).not.toBe(
      ar('docCategoryInsurerLicenseCertificate'),
    );
  });

  it('and every one of the three has an English side, because the screens are bilingual', () => {
    for (const key of [
      'docCategoryBrokerLicenseCertificate',
      'docCategoryInsurerLicenseCertificate',
      'docCategoryRegulatoryDecision',
    ]) {
      for (const language of LANGUAGES) {
        expect(lookupOptional(language, key), `${key} has no ${language}`).toBeTruthy();
      }
    }
  });

  it('🔴 and the map reaches them — a label nothing points at is still a blank cell', () => {
    /*
     * THE HALF A DICTIONARY TEST CANNOT SEE. Adding the three strings and forgetting the three
     * `ENUM_LABEL` entries leaves every screen exactly as broken as before, with three keys that
     * resolve perfectly and nothing asking for them.
     */
    const map = ENUM_LABEL.DocumentCategory as Record<string, string>;
    expect(map.BROKER_LICENSE_CERTIFICATE).toBe(
      'docCategoryBrokerLicenseCertificate',
    );
    expect(map.INSURER_LICENSE_CERTIFICATE).toBe(
      'docCategoryInsurerLicenseCertificate',
    );
    expect(map.REGULATORY_DECISION).toBe('docCategoryRegulatoryDecision');
  });
});

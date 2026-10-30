import { describe, expect, it } from 'vitest';
import { buildImportTemplate } from '../lib/customer/import-template';
import {
  IMPORT_FIELDS,
  IMPORT_REQUIRED_FIELDS,
} from '../lib/customer/legacy-import-api';

/*
 * THE TEMPLATE THE OFFICE FILLS IN.
 *
 * «لما أجيت أضيف ملف ما عندي واحد بصيغة csv، و أصلاً احنا احكينا مش رح يطلع من
 *  النظام زي قالب عشان المكتب يعبّيه بمعلومات عملائه كاملين و يرفعهم مرة وحدة»
 * — the owner's walk, 2026-10-26.
 *
 * ## WHERE THE ROUND TRIP IS PROVEN, AND WHY IT IS IN THREE PLACES
 *
 * The generator is web-side (that is where the Arabic labels are) and the parser
 * is api-side, and no file can import both — which is the same constraint that
 * put `legacy-import-shape-parity.spec.ts` in `packages/db` reading both as text.
 * So the round trip is proven in three parts, and each part is named here so the
 * split is a stated design rather than a gap somebody finds later:
 *
 *   1. HERE — the template's own structure: the columns ARE the importer's field
 *      list in order, the mandatory ones are marked, the headings map agrees with
 *      the header row character for character, and the bytes are parseable.
 *   2. `customer-import.spec.ts` — download, then upload THAT FILE, and assert
 *      the mapping the screen sends is exactly the template's headings. This is
 *      the half that would break if the mapping were filled from a second copy.
 *   3. `legacy-import.e2e-spec.ts` — a BOM-prefixed, Arabic-headed file with an
 *      exact mapping imports a real customer through the real parser.
 *
 * What NONE of them covers, stated: that the Arabic in the template is the Arabic
 * on the screen. That is one `t()` call in the page, and `screen-copy.test.ts`
 * holds the keys themselves.
 */

const LABEL: Record<string, string> = {
  legalName: 'الاسم القانوني',
  customerType: 'نوع العميل (فرد / شركة)',
  registrationNumber: 'رقم التسجيل',
  nationality: 'الجنسية',
  contactEmail: 'البريد الإلكتروني',
  contactPhone: 'الهاتف',
  registeredAddress: 'العنوان المسجَّل',
};

function build() {
  return buildImportTemplate({
    label: (f) => LABEL[f] ?? f,
    requiredWord: 'إلزامي',
    exampleWord: 'مثال',
  });
}

/** Minimal reader, enough to assert the shape without pulling in the api's. */
function rows(csv: string): string[][] {
  return csv
    .replace(/^﻿/, '')
    .split(/\r\n|\n/)
    .filter((l) => l !== '')
    .map((line) => {
      const out: string[] = [];
      let field = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i]!;
        if (quoted) {
          if (c === '"' && line[i + 1] === '"') {
            field += '"';
            i++;
          } else if (c === '"') quoted = false;
          else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') {
          out.push(field);
          field = '';
        } else field += c;
      }
      out.push(field);
      return out;
    });
}

describe('the customer-import template', () => {
  it('has one column per importable field, IN THE IMPORTER ORDER', () => {
    // Order, not membership. The mapping is pre-filled from this same call, so
    // two lists holding the same names in different orders would still pass a set
    // comparison and hand the office a file whose columns are not what the screen
    // says they are.
    const { csv, headings } = build();
    const header = rows(csv)[0]!;
    expect(header).toHaveLength(IMPORT_FIELDS.length);
    expect(header).toEqual(IMPORT_FIELDS.map((f) => headings[f]));
  });

  it('marks the mandatory columns, and only those', () => {
    /*
     * THE EXPECTED SET IS WRITTEN OUT HERE, and the first version of this test did
     * not do that — it compared the generator against `IMPORT_REQUIRED_FIELDS`,
     * which is the list the generator is BUILT FROM. So the two moved together: a
     * plant shrinking that list to `['legalName']` left this test green at 5/5
     * while the parity guard caught it. Comparing a value with itself, which is
     * the same defect that had to be corrected in `screening-identity.dto-parts.spec.ts`
     * one group earlier — found here by a plant rather than by reading.
     *
     * Written out, a change to which columns the office MUST fill becomes a
     * reviewed change to this line, which is what it should be. The chain is then
     * complete and every link independently checkable: this pins the template to
     * the literal, and `legacy-import-shape-parity.spec.ts` pins the web's list to
     * the api's.
     */
    const MANDATORY = ['legalName', 'customerType'];
    const { headings } = build();
    for (const field of IMPORT_FIELDS) {
      const marked = headings[field].includes('إلزامي');
      expect(
        marked,
        `${field} is ${MANDATORY.includes(field) ? '' : 'not '}required ` +
          `but its heading is ${marked ? '' : 'not '}marked`,
      ).toBe(MANDATORY.includes(field));
    }
    // And the generator's own source agrees with that literal — the assertion the
    // plant proved was missing.
    expect([...IMPORT_REQUIRED_FIELDS].sort()).toEqual([...MANDATORY].sort());
  });

  it('starts with a BOM, because every heading is Arabic', () => {
    // Excel on Windows reads a BOM-less UTF-8 CSV as mojibake, so without this the
    // office opens the template and sees nothing it can read. `parseCsv` strips a
    // leading BOM already — this asserts the two halves of that agreement.
    expect(build().csv.startsWith('﻿')).toBe(true);
    expect(rows(build().csv)[0]![0]).toBe(
      build().headings.legalName,
    );
  });

  it('carries ONE example row, and the two values nobody could guess', () => {
    const parsed = rows(build().csv);
    expect(parsed).toHaveLength(2);
    const example = parsed[1]!;
    const at = (field: string) => example[IMPORT_FIELDS.indexOf(field as never)]!;
    // The api uppercases and then accepts these two members and nothing else; an
    // Arabic-speaking clerk has no way to know that, which is the single most
    // valuable thing in the file.
    expect(at('customerType')).toBe('CORPORATE');
    // ISO 3166-1 alpha-2, which is what `Customer_nationality_iso3166` enforces.
    expect(at('nationality')).toBe('JO');
    // And a free-text column says it is an example rather than being blank.
    expect(at('legalName')).toBe('مثال');
  });

  it('quotes a heading that would otherwise break a cell', () => {
    // A label containing a comma is not hypothetical: `impFieldCustomerType` is
    // «نوع العميل (فرد / شركة)» today and one reword away from carrying one.
    const { csv } = buildImportTemplate({
      label: (f) => (f === 'legalName' ? 'a, b "c"' : f),
      requiredWord: 'R',
      exampleWord: 'x',
    });
    expect(csv).toContain('"a, b ""c"" (R)"');
    // And it still reads back as ONE cell.
    expect(rows(csv)[0]![0]).toBe('a, b "c" (R)');
  });
});

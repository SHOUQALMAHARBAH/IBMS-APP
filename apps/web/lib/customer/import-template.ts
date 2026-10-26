import { IMPORT_FIELDS, IMPORT_REQUIRED_FIELDS, type ImportField } from './legacy-import-api';

/**
 * THE TEMPLATE THE OFFICE FILLS IN — generated from the importer's own field list.
 *
 * ## Why this exists
 *
 * The owner's walk: «لما أجيت أضيف ملف ما عندي واحد بصيغة csv، و أصلاً احنا احكينا
 * مش رح يطلع من النظام زي قالب عشان المكتب يعبّيه بمعلومات عملائه كاملين و يرفعهم
 * مرة وحدة… الحكمة من هاي الحركة ما نخلي الموظف يدخل العملاء واحد واحد» — she
 * opened the import screen with no CSV to give it, and the whole point of a bulk
 * import is that nobody enters customers one at a time.
 *
 * ## GENERATED, never written down
 *
 * The columns ARE `IMPORT_FIELDS`, in that order, and the mandatory ones ARE
 * `IMPORT_REQUIRED_FIELDS`. A hand-written template would drift from the parser
 * the first time a field was added — and the parity guard in
 * `packages/db/prisma/legacy-import-shape-parity.spec.ts` now holds those two
 * lists against the api's own, IN ORDER, because this file turns them into a
 * spreadsheet an office fills in before anything can refuse it.
 *
 * ## The same function returns the HEADINGS, and that is the design
 *
 * `/settings/customer-import` maps each field to a heading in the office's own
 * file, and the api matches on `header.indexOf(heading.trim())` — an exact match.
 * So a template whose headers nobody mapped is a template that imports nothing.
 * `buildImportTemplate` returns the csv AND the heading per field, the screen
 * pre-fills the mapping from the second, and the two cannot disagree because
 * there is one source. That is what makes the round trip — download, fill one
 * row, upload — work with no mapping step, which is what `customer-import.spec.ts`
 * asserts end to end.
 *
 * ## A BOM, deliberately
 *
 * Excel on Windows reads a UTF-8 CSV with no BOM as mojibake, and every heading
 * here is Arabic — so without it the office opens the template and sees nothing
 * it can read. `parseCsv` already strips a leading BOM, with a comment saying it
 * survives an Excel "Save as CSV", so emitting one is both necessary and safe.
 * Without that, the first heading would arrive as `﻿…` and match nothing.
 *
 * ## No Arabic is written here
 *
 * The headings are the labels already on that screen. The mandatory marker is
 * `commonRequired` («إلزامي» / "Required"), which has shipped in both languages
 * and been rendered by nothing. The example word is sliced from an existing
 * placeholder. All three are passed in by the caller, so this module holds no
 * copy at all and cannot be the place a word gets invented.
 */

/** Just the two values an office cannot guess. Everything else is free text. */
const FORMAT_EXAMPLE: Partial<Record<ImportField, string>> = {
  // The api uppercases and then accepts these two members and nothing else
  // (`legacy-import.config.ts`: "customerType must be INDIVIDUAL or CORPORATE").
  // An Arabic-speaking clerk has no way to know that, which is the single most
  // valuable thing this file carries.
  customerType: 'CORPORATE',
  // ISO 3166-1 alpha-2, which is what `Customer_nationality_iso3166` enforces.
  nationality: 'JO',
  contactEmail: 'name@example.com',
  contactPhone: '+962790000000',
};

/** RFC 4180: quote when the value could otherwise break a cell, and double any
 *  quote inside it. A generator that can emit a broken CSV will. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface ImportTemplate {
  /** The file's bytes, BOM included. */
  csv: string;
  /** Field -> the exact heading in that file, for pre-filling the mapping. */
  headings: Record<ImportField, string>;
}

export function buildImportTemplate(opts: {
  /** The label already rendered beside that field's mapping input. */
  label: (field: ImportField) => string;
  /** `commonRequired` — appended to a mandatory column's heading. */
  requiredWord: string;
  /** «مثال» / "example" — the free-text columns' placeholder value. */
  exampleWord: string;
}): ImportTemplate {
  const headings = {} as Record<ImportField, string>;
  for (const field of IMPORT_FIELDS) {
    const label = opts.label(field);
    // The marker lives IN the heading rather than beside it on the screen, so the
    // office can see which columns are mandatory with the file open and the screen
    // closed — which is where they will be while filling it in.
    headings[field] = IMPORT_REQUIRED_FIELDS.includes(field)
      ? `${label} (${opts.requiredWord})`
      : label;
  }

  const header = IMPORT_FIELDS.map((f) => csvCell(headings[f])).join(',');
  const example = IMPORT_FIELDS.map((f) =>
    csvCell(FORMAT_EXAMPLE[f] ?? opts.exampleWord),
  ).join(',');

  // CRLF: Excel's own line ending, and `parseCsv` splits on both.
  return { csv: `﻿${header}\r\n${example}\r\n`, headings };
}

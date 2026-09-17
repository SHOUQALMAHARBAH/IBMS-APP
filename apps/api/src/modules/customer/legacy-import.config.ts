import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Part III §7 — the legacy customer bulk import, pure half.
 *
 * Everything here is deterministic and side-effect free: CSV parsing, the
 * per-office column mapping, and the row-level validation. The service does
 * the writing, the screening and the audit.
 */

/** Hard ceiling on the uploaded file. The whole file is parsed in memory —
 * there is no object storage in this system and this importer does not
 * introduce one — so the cap is what keeps a single request from becoming a
 * memory-pressure event on a host that already runs close to the line. */
export const LEGACY_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** And a ceiling on rows, which the byte cap alone does not give: a file of
 * very short rows can be small and still enormous. Both are checked. */
export const LEGACY_IMPORT_MAX_ROWS = 5_000;

/**
 * The fields an office's legacy file can be mapped onto. Deliberately a small
 * set: this importer exists to get a back-book INTO the system in a reviewable
 * state, not to reconstruct a complete KYC file from a spreadsheet. Anything
 * not here is captured properly later, through the intake flow, by a human.
 */
export const LEGACY_IMPORT_FIELDS = [
  'legalName',
  'customerType',
  'registrationNumber',
  'nationality',
  'contactEmail',
  'contactPhone',
  'registeredAddress',
] as const;

export type LegacyImportField = (typeof LEGACY_IMPORT_FIELDS)[number];

/** `legalName` is the only one without which a row is not a customer at all —
 * and it is also the only field the sanctions screen can work from, so a row
 * missing it could not be screened even if it were written. */
export const LEGACY_IMPORT_REQUIRED_FIELDS: LegacyImportField[] = [
  'legalName',
  'customerType',
];

export interface LegacyImportRow {
  /** 1-based, counting the header as line 1, so a rejection can name the line
   * the office will see in their own spreadsheet. */
  lineNumber: number;
  legalName: string;
  customerType: 'INDIVIDUAL' | 'CORPORATE';
  registrationNumber?: string;
  nationality?: string;
  contactEmail?: string;
  contactPhone?: string;
  registeredAddress?: string;
}

export interface LegacyImportRejection {
  lineNumber: number;
  reason: string;
}

export interface ParsedLegacyImport {
  rows: LegacyImportRow[];
  rejections: LegacyImportRejection[];
}

/**
 * Minimal RFC-4180 CSV reader: quoted fields, embedded commas, embedded
 * newlines, and `""` as an escaped quote.
 *
 * Hand-written rather than pulled in as a dependency. The format this has to
 * read is one an office exports from a spreadsheet, the rules above are the
 * whole of it, and a parser is a smaller thing to own than a supply-chain
 * entry on a path that ingests customer records.
 */
export function parseCsv(text: string): string[][] {
  // A BOM survives an Excel "Save as CSV" and would otherwise become part of
  // the first header name, silently breaking the mapping for that one column.
  const input = text.replace(/^\uFEFF/, '');

  // An explicit, LOCAL bound on the loop below.
  //
  // The size of this input is already capped twice — multer's
  // `limits.fileSize` on the controller and a `file.size` check in the service
  // — and the row count is capped in `mapRows()`. But all three are enforced
  // somewhere else, and `mapRows()` in particular only runs AFTER this
  // function has already walked the entire string. Nothing a reader of this
  // function can see stops it, which is also exactly what CodeQL reports
  // (`js/loop-bound-injection`: iteration over a user-controlled length).
  //
  // `String.length` counts UTF-16 code units, and for UTF-8 input that is
  // always <= the byte count: a 2- or 3-byte character is one unit, and a
  // 4-byte one is two. So this can never reject a file that legitimately
  // passed the byte cap — it is the same bound expressed where the loop lives,
  // not a second, stricter one.
  if (input.length > LEGACY_IMPORT_MAX_BYTES) {
    throw new UnprocessableEntityException(
      `The uploaded file is too large to read; the limit is ${LEGACY_IMPORT_MAX_BYTES} bytes. Split it and import in parts.`,
    );
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      // Accept CRLF, LF and a lone CR without emitting a phantom empty row.
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Apply an office's column mapping and validate each row.
 *
 * A row that fails is REJECTED and reported by line number — never silently
 * dropped and never partially written. The caller imports the good rows and
 * hands back the rejections, because an office with 400 rows and 3 bad ones
 * needs the 397 loaded and the 3 named, not an all-or-nothing failure that
 * tells them to go and find the problem themselves.
 */
export function mapRows(
  table: string[][],
  mapping: Record<string, string>,
): ParsedLegacyImport {
  if (table.length === 0) {
    throw new UnprocessableEntityException('The uploaded file is empty.');
  }

  const header = table[0].map((h) => h.trim());
  const body = table.slice(1).filter((r) => r.some((c) => c.trim() !== ''));

  if (body.length === 0) {
    throw new UnprocessableEntityException(
      'The uploaded file has a header but no data rows.',
    );
  }
  if (body.length > LEGACY_IMPORT_MAX_ROWS) {
    throw new UnprocessableEntityException(
      `The uploaded file has ${body.length} data rows; the limit is ${LEGACY_IMPORT_MAX_ROWS}. Split it and import in parts.`,
    );
  }

  // mapping is { field -> that office's column heading }
  const columnIndex = new Map<LegacyImportField, number>();
  for (const field of LEGACY_IMPORT_FIELDS) {
    const heading = mapping[field];
    if (heading === undefined) continue;
    const index = header.indexOf(heading.trim());
    if (index === -1) {
      throw new UnprocessableEntityException(
        `The mapping points "${field}" at a column named "${heading}", which is not in the file. Its columns are: ${header.join(', ')}.`,
      );
    }
    columnIndex.set(field, index);
  }

  for (const required of LEGACY_IMPORT_REQUIRED_FIELDS) {
    if (!columnIndex.has(required)) {
      throw new UnprocessableEntityException(
        `The mapping must name a column for "${required}".`,
      );
    }
  }

  const cell = (r: string[], f: LegacyImportField): string | undefined => {
    const i = columnIndex.get(f);
    if (i === undefined) return undefined;
    const v = (r[i] ?? '').trim();
    return v === '' ? undefined : v;
  };

  const rows: LegacyImportRow[] = [];
  const rejections: LegacyImportRejection[] = [];

  body.forEach((raw, i) => {
    const lineNumber = i + 2; // +1 for the header, +1 for 1-based counting
    const legalName = cell(raw, 'legalName');
    const rawType = cell(raw, 'customerType');

    if (!legalName) {
      rejections.push({ lineNumber, reason: 'legalName is empty' });
      return;
    }
    const customerType = rawType?.toUpperCase();
    if (customerType !== 'INDIVIDUAL' && customerType !== 'CORPORATE') {
      rejections.push({
        lineNumber,
        reason: `customerType must be INDIVIDUAL or CORPORATE, got ${rawType ? `"${rawType}"` : 'an empty value'}`,
      });
      return;
    }

    rows.push({
      lineNumber,
      legalName,
      customerType,
      registrationNumber: cell(raw, 'registrationNumber'),
      nationality: cell(raw, 'nationality'),
      contactEmail: cell(raw, 'contactEmail'),
      contactPhone: cell(raw, 'contactPhone'),
      registeredAddress: cell(raw, 'registeredAddress'),
    });
  });

  return { rows, rejections };
}

/** What the endpoint returns, and (minus the per-row detail) what the single
 * batch audit row records. */
export interface LegacyImportResult {
  fileName: string;
  totalDataRows: number;
  imported: number;
  rejected: number;
  screened: number;
  screeningFlagged: number;
  rejections: LegacyImportRejection[];
  failures: LegacyImportRejection[];
}

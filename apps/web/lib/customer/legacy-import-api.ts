/*
 * Load an office's legacy customer file — `POST /imports/customers`, which had no web caller, so
 * `customer.bulk-import` was a permission its two holders could not exercise.
 *
 * ## The mapping is a mapping, not a fixed format
 *
 * The API does not require a particular column order or heading. The caller says which of ITS
 * column headings carries each of the seven fields the system understands, which is what lets an
 * office import the file it already has rather than rewriting it to match us.
 *
 * ## The upload never touches disk, and that is the API's decision not ours
 *
 * The controller holds the file in memory deliberately: a customer list spooled to a temp file is
 * Confidential personal data sitting outside every control the rest of the system has — no
 * encryption at rest, no retention schedule, no disposal record — and it would outlive the
 * request. Nothing here should ever add a "save the upload first" step.
 */

import { apiPostFormData } from '../auth/api-client';

/** The seven fields the importer understands. Mirrors `LEGACY_IMPORT_FIELDS`. */
export const IMPORT_FIELDS = [
  'legalName',
  'customerType',
  'registrationNumber',
  'nationality',
  'contactEmail',
  'contactPhone',
  'registeredAddress',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/**
 * `legalName` is the only field without which a row is not a customer at all — and the only one
 * the sanctions screen can work from, so a row missing it could not be screened even if it were
 * written. `customerType` decides which KYC file the row gets.
 */
export const IMPORT_REQUIRED_FIELDS: ImportField[] = [
  'legalName',
  'customerType',
];

export interface ImportRejection {
  lineNumber: number;
  reason: string;
}

export interface ImportResult {
  fileName: string;
  totalDataRows: number;
  imported: number;
  rejected: number;
  screened: number;
  /**
   * Rows whose screening produced a potential match.
   *
   * NOT a failure and not a block: the row is imported and the match goes to the sanctions review
   * queue like any other. A screen that presented this as an error would teach an office to treat
   * a real hit as a data problem.
   */
  screeningFlagged: number;
  /** Rows refused before any write — a malformed row. */
  rejections: ImportRejection[];
  /** Rows that passed validation and then failed to write. */
  failures: ImportRejection[];
}

export function importCustomers(
  file: File,
  mapping: Partial<Record<ImportField, string>>,
): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  // The API takes the mapping as a JSON STRING inside the multipart body — its DTO parses and
  // validates it there, refusing an unknown field by name.
  form.append('mapping', JSON.stringify(mapping));
  return apiPostFormData('/imports/customers', form);
}

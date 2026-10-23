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

import { apiGet, apiPostFormData } from '../auth/api-client';

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

/**
 * ONE ISSUE LIST CARRYING A KIND — and this shape is why `/settings/customer-import` CRASHED on
 * every successful import for three weeks.
 *
 * Phase 2 item 1 replaced the api's `rejections` and `failures` with one `issues` list plus
 * `refusedDuplicates` and `batchId`, and this file was never updated. The screen then evaluated
 * `result.rejections.length + result.failures.length` — both `undefined` — and threw during render:
 * the rows imported, and the panel reporting on them died. **TypeScript could not see it**, because
 * an interface declared by hand over an HTTP response is checked against nothing, and the Playwright
 * fixture supplied the old fields itself, so a green suite covered a screen that could not work.
 * That is why `packages/db/prisma/legacy-import-shape-parity.spec.ts` exists: it is the only place
 * that can read BOTH declarations.
 *
 * The KIND is a kind and not a wording, which is the api's own argument: as prose *"a duplicate is
 * reported differently from bad data"* decays into two messages that read alike and a screen that
 * lists them together.
 */
export type ImportIssueKind = 'DUPLICATE' | 'BAD_DATA' | 'IMPORTED_NEEDS_REVIEW';

export interface ImportIssue {
  /** 1-based, counting the header as line 1 — the line the office sees in their own spreadsheet. */
  lineNumber: number;
  kind: ImportIssueKind;
  /** The server's own sentence. English: this api has no message i18n (a recorded gap). */
  detail: string;
  /** For a DUPLICATE: the customer the row collided with, so an officer can open it and decide. */
  collidedWithCustomerId?: string;
}

export interface ImportResult {
  /** What a screen reads the durable report back by. */
  batchId: string;
  fileName: string;
  totalDataRows: number;
  imported: number;
  /** Rows that did NOT land: duplicates plus bad data. Excludes `IMPORTED_NEEDS_REVIEW`. */
  rejected: number;
  /** Of those, how many were duplicates — apart from bad data because one needs an identity
   *  decision and the other a typo fixed. */
  refusedDuplicates: number;
  screened: number;
  /**
   * Rows whose screening produced a potential match.
   *
   * NOT a failure and not a block: the row is imported and the match goes to the sanctions review
   * queue like any other. A screen that presented this as an error would teach an office to treat
   * a real hit as a data problem.
   */
  screeningFlagged: number;
  issues: ImportIssue[];
}

/**
 * THE DURABLE REPORT — `GET /imports/customers/batches` and `.../batches/:id`, owner decision 43.
 *
 * Recorded as a defect on 2026-10-02 and left alone by instruction at the time: *"DEFECT 2: THE
 * DURABLE REPORT HAS NO SCREEN"*, so `batchId`, both routes and the DUPLICATE-versus-BAD_DATA split
 * all worked and nothing reachable by clicking read any of it. An officer who imported 2,000 rows
 * read its refusals ONCE, in a panel that then threw.
 *
 * These are the RAW rows the api returns (it has no derived view for them), and this file declares
 * only the fields the screen reads — `organizationId` is on the wire and is deliberately not here,
 * because declaring fewer fields than the payload carries is harmless while reading one the payload
 * LACKS is the defect above.
 */
export interface ImportBatch {
  id: string;
  fileName: string;
  startedAt: string;
  totalDataRows: number;
  imported: number;
  /** The api calls this `refused`, not `rejected` — the batch row's own column name. */
  refused: number;
  screened: number;
  needsReview: number;
}

export interface ImportBatchWithIssues extends ImportBatch {
  /** Ordered by KIND then line: resolving duplicates is a different job from fixing typos, and
   *  interleaving them by line number makes the list something to re-sort before either can start. */
  issues: ImportIssue[];
}

export function listImportBatches(): Promise<ImportBatch[]> {
  return apiGet('/imports/customers/batches');
}

export function getImportBatch(id: string): Promise<ImportBatchWithIssues> {
  return apiGet(`/imports/customers/batches/${id}`);
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

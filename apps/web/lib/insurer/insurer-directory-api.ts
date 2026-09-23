import { apiGet } from '../auth/api-client';

/**
 * The cross-office insurer directory — a read-only lead list.
 *
 * ## What this type does NOT have, and why that is the point
 *
 * These are competing brokerages on one platform. The company is public knowledge; the panel is
 * not. So there is no `isActive`, no `creditTermsDays`, no `financialStrengthRating`, no named
 * relationship contact, no office id, no count of offices, and no registration date — and the way
 * that is guaranteed is not this type. The API reads a `SECURITY DEFINER` view that has no such
 * column in it, with a test asserting the view's columns against `information_schema`.
 *
 * This interface therefore mirrors an allow-list rather than filtering one. If a field ever appears
 * here that is not in `INSURER_DIRECTORY_COLUMNS`, the mistake happened on the server.
 *
 * ## One entry per COMPANY, not per office
 *
 * Two offices registering the same company under different spellings produce ONE entry: the view
 * groups on the database's canonical name key, the same function that backs the per-office
 * uniqueness of a local registration. Contact gaps are filled from whichever office recorded one,
 * and the lines are the UNION of what every office recorded — none of which says which office
 * contributed what.
 */

/** A line a company writes. `code` is NULL for a line some office added itself — a code is
 *  platform-wide and an office cannot mint one, so its absence is the fact that the line is local.
 *  It carries no hint of WHICH office added it. */
export interface DirectoryLine {
  code: string | null;
  nameEn: string;
  nameAr: string;
}

export interface DirectoryEntry {
  /** The company's identity in the directory — its catalogue id or its canonical name key. Used as
   *  a React key; it is not an `Insurer.id` and cannot be used to fetch one. */
  directoryKey: string;
  name: string | null;
  nameAr: string | null;
  structure: 'CONVENTIONAL' | 'TAKAFUL' | 'TAKAFUL_WINDOW' | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyWebsite: string | null;
  companyCorrespondenceAddress: string | null;
  lines: DirectoryLine[];
}

export interface DirectoryPage {
  items: DirectoryEntry[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Search the directory by company name, by platform line code, or both (AND).
 *
 * `lineCode` answers the question the directory exists for — *who writes this cover?* An
 * unrecognised code is a **422 naming it**, never an empty page, because `[]` is indistinguishable
 * from "nobody writes this" and looks like an answer. The caller must therefore let that error
 * reach the user rather than rendering it as "no results".
 */
export function listInsurerDirectory(
  opts: { search?: string; lineCode?: string; page?: number } = {},
): Promise<DirectoryPage> {
  const params = new URLSearchParams();
  if (opts.search) params.set('search', opts.search);
  if (opts.lineCode) params.set('lineCode', opts.lineCode);
  if (opts.page !== undefined) params.set('page', String(opts.page));
  const query = params.toString();
  return apiGet(`/insurer-directory${query ? `?${query}` : ''}`);
}

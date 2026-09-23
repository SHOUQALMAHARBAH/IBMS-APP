import { apiGet, apiPatch, apiPost } from '../auth/api-client';
import type { InsuranceLine } from './insurance-line-api';

/**
 * The office's own insurer records — its RELATIONSHIP with each company, not the company.
 *
 * ## The one thing to keep straight in this file
 *
 * An insurer row is two kinds of fact stitched together, and they have different audiences:
 *
 *  - **COMPANY-level** — name, structure, switchboard, general mailbox, website, correspondence
 *    address, and the lines it writes. Public knowledge, and exactly the group the cross-office
 *    directory is allowed to show.
 *  - **RELATIONSHIP-level** — credit terms, financial-strength rating, and the named people who
 *    answer this office. Commercially sensitive, and it must never cross an office boundary.
 *
 * The API keeps them apart structurally (the directory reads a `SECURITY DEFINER` view that has no
 * relationship column in it), so nothing here has to filter. But a screen that mixed them in one
 * "details" block would teach the next person that they are the same kind of thing, so the two are
 * kept visibly separate in the types below and on the detail page.
 */

export type InsurerStructure = 'CONVENTIONAL' | 'TAKAFUL' | 'TAKAFUL_WINDOW';

/**
 * The translation key for each structure, as a TOTAL map.
 *
 * A `Record` over the union rather than a `t(\`insStructure${value}\`)` template: the template
 * compiles whatever it is given, so a new structure or a renamed key would fail at runtime as a
 * missing translation. This way adding a member to the union is a compile error until its label
 * exists — which is what caught the labels being absent altogether.
 */
export const STRUCTURE_LABEL_KEY = {
  CONVENTIONAL: 'insStructureConventional',
  TAKAFUL: 'insStructureTakaful',
  TAKAFUL_WINDOW: 'insStructureTakafulWindow',
} as const satisfies Record<InsurerStructure, string>;

export interface Insurer {
  id: string;
  /** Resolved server-side: the catalogue's name for a linked row, the office's own otherwise.
   *  Never null, so no caller needs a fallback. */
  name: string;
  nameAr: string | null;
  /** TRUE when this office registered the company itself, so the name is the office's to
   *  correct. FALSE for a catalogue-linked row, whose name is NOT editable here — the detail
   *  screen reads this to decide whether the name fields are writable at all. */
  isOfficeLocal: boolean;
  insurerMasterId: string | null;
  isActive: boolean;
  linesOffered: InsuranceLine[];
  structure: InsurerStructure | null;

  companyPhone: string | null;
  companyEmail: string | null;
  companyWebsite: string | null;
  companyCorrespondenceAddress: string | null;

  financialStrengthRating: string | null;
  creditTermsDays: number | null;
  rfqContactName: string | null;
  rfqContactEmail: string | null;
  rfqContactPhone: string | null;
  claimsContactName: string | null;
  claimsContactEmail: string | null;
  underwriterContact: string | null;
  createdAt: string;
}

/**
 * What stopping work with an insurer would affect, as at now.
 *
 * FIVE numbers, and the first two are deliberately not summed. `policiesInForce` is cover that is
 * running and needs nothing further from the insurer; `policiesInIssuance` is where the INSURER
 * STILL OWES AN ACTION. One combined figure would hide exactly the half that should give an
 * administrator pause, which is why the API reports them separately and why the screen must too.
 */
export interface InsurerStatusImpact {
  policiesInForce: number;
  policiesInIssuance: number;
  openRenewalCases: number;
  pendingRfqSubmissions: number;
  unsettledInvoices: number;
}

/** A deactivation or reactivation returns the row AND the impact as at the moment of the change —
 *  the same counts written to the audit trail, so the screen and the record cannot drift. */
export interface InsurerStatusChange {
  insurer: Insurer;
  impact: InsurerStatusImpact;
}

export interface InsurerPage {
  items: Insurer[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Registering a company, by EITHER path through one endpoint.
 *
 * `insurerMasterId` links to the global catalogue; `legalName` + `legalNameAr` registers a company
 * no catalogue lists. Exactly one path, enforced server-side — sending both, or neither, is a 422
 * that says which. Typed as a union here so the form cannot express the invalid combination in the
 * first place.
 */
export type RegisterInsurerInput = {
  structure: InsurerStructure;
  companyPhone: string;
  companyEmail: string;
  companyWebsite?: string;
  companyCorrespondenceAddress?: string;
  lineIds?: string[];
  rfqContactName?: string;
  rfqContactEmail?: string;
  rfqContactPhone?: string;
  claimsContactName?: string;
  claimsContactEmail?: string;
  underwriterContact?: string;
  creditTermsDays?: number;
  financialStrengthRating?: string;
} & (
  | { insurerMasterId: string; legalName?: never; legalNameAr?: never }
  | { insurerMasterId?: never; legalName: string; legalNameAr: string }
);

export type UpdateInsurerInput = Partial<{
  legalName: string;
  legalNameAr: string;
  structure: InsurerStructure;
  lineIds: string[];
  companyPhone: string;
  companyEmail: string;
  companyWebsite: string;
  companyCorrespondenceAddress: string;
  rfqContactName: string;
  rfqContactEmail: string;
  rfqContactPhone: string;
  claimsContactName: string;
  claimsContactEmail: string;
  underwriterContact: string;
  creditTermsDays: number;
  financialStrengthRating: string;
}>;

export function listInsurers(
  opts: { search?: string; isActive?: boolean; page?: number } = {},
): Promise<InsurerPage> {
  const params = new URLSearchParams();
  if (opts.search) params.set('search', opts.search);
  // Sent only when set: the API treats an ABSENT filter as "both", and `String(false)` would
  // silently mean "inactive only". The distinction matters because the default view is both.
  if (opts.isActive !== undefined) params.set('isActive', String(opts.isActive));
  if (opts.page !== undefined) params.set('page', String(opts.page));
  const query = params.toString();
  return apiGet(`/insurers${query ? `?${query}` : ''}`);
}

export function getInsurer(id: string): Promise<Insurer> {
  return apiGet(`/insurers/${encodeURIComponent(id)}`);
}

export function registerInsurer(body: RegisterInsurerInput): Promise<Insurer> {
  return apiPost('/insurers', body);
}

export function updateInsurer(
  id: string,
  body: UpdateInsurerInput,
): Promise<Insurer> {
  return apiPatch(`/insurers/${encodeURIComponent(id)}`, body);
}

/** The impact BEFORE deciding — a GET that changes nothing, so the confirmation step can show
 *  the same numbers the act will record. */
export function getInsurerStatusImpact(
  id: string,
): Promise<InsurerStatusImpact> {
  return apiGet(`/insurers/${encodeURIComponent(id)}/status-impact`);
}

/** ALLOW AND RECORD: this never refuses on account of an existing obligation, because refusing
 *  would not settle one. The reason is required — the act is a recorded decision. */
export function deactivateInsurer(
  id: string,
  reason: string,
): Promise<InsurerStatusChange> {
  return apiPost(`/insurers/${encodeURIComponent(id)}/deactivate`, { reason });
}

/** A reason is OPTIONAL here: refusing to let an office undo a deactivation for want of a
 *  sentence would be worse than an unexplained reactivation. */
export function reactivateInsurer(
  id: string,
  reason?: string,
): Promise<InsurerStatusChange> {
  return apiPost(
    `/insurers/${encodeURIComponent(id)}/reactivate`,
    reason ? { reason } : {},
  );
}

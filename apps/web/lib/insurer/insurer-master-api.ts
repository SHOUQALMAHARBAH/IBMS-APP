import { apiGet } from '../auth/api-client';

/**
 * The GLOBAL insurer catalogue, shared by every office.
 *
 * Read-only from the web: nothing in the application writes this table. It exists so two offices
 * dealing with the same real company see the same company — and so registration can offer "this
 * one" instead of asking an office to retype a name that already exists.
 *
 * Note what the register form uses it for: a picker, so the catalogue-linked path sends an ID. The
 * other path exists because a company may be in no catalogue at all, which is the whole reason
 * `Insurer.insurerMasterId` is nullable.
 */
export interface InsurerMaster {
  id: string;
  legalName: string;
  legalNameAr: string | null;
  /** Free text on the master, predating the managed vocabulary. Shown as a hint on the picker,
   *  never matched on — the office's own `linesOffered` is the managed one. */
  linesOffered: string[];
}

/**
 * Every company in the shared catalogue.
 *
 * Gated on `insurer.master.read`, which the roles that register insurers hold. A 403 here should
 * leave the catalogue path unavailable rather than break the form — an office can still register a
 * company locally, which is the path that needs no catalogue at all.
 */
export function listInsurerMasters(): Promise<InsurerMaster[]> {
  return apiGet('/insurer-masters');
}

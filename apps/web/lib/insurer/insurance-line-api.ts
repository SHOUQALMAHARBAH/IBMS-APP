import { apiGet } from '../auth/api-client';

/**
 * The managed insurance-line vocabulary — the standard 32 plus this office's own additions.
 *
 * `code` is NULL for an office addition, and that absence IS the distinction: a code is a
 * platform-wide identifier and an office cannot mint one, because two offices inventing `PET` for
 * different things would make the code meaningless. `isStandard` says the same thing explicitly.
 */
export interface InsuranceLine {
  id: string;
  code: string | null;
  nameEn: string;
  nameAr: string;
  category: 'GENERAL' | 'LIFE';
  isStandard: boolean;
}

/**
 * Every line this office can pick from, standard lines first in market order.
 *
 * Gated on `insurer.read` server-side. A caller without it gets a 403, which every consumer here
 * should treat as "render no picker" rather than as an error worth showing — the permission gap is
 * an administrator's problem, not the user's.
 */
export function listInsuranceLines(): Promise<InsuranceLine[]> {
  return apiGet('/insurance-lines');
}

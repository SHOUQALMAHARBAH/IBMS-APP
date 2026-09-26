import { apiGet, apiPatch } from '../auth/api-client';

export type DutySegregationMode = 'SEGREGATED' | 'COMBINED';

export interface DutySegregationModeView {
  mode: DutySegregationMode;
  /** Null until somebody declares a mode: the office is segregated by default, not by decision. */
  declaredAt: string | null;
  declaredByUserId: string | null;
  declaredByName: string | null;
}

/** Mirrors `MODE_DECLARATION_REASON_MIN_LENGTH`. The server is the authority. */
export const MODE_REASON_MIN_LENGTH = 10;

export function getDutySegregationMode(): Promise<DutySegregationModeView> {
  return apiGet<DutySegregationModeView>('/duty-segregation/mode');
}

export function declareDutySegregationMode(
  mode: DutySegregationMode,
  reason: string,
): Promise<DutySegregationModeView> {
  return apiPatch<DutySegregationModeView>('/duty-segregation/mode', {
    mode,
    reason,
  });
}

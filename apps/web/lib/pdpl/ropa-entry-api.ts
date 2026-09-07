// Records of Processing Activities (backlog Part D §5.1, Process #52).
// ropa.manage (DPO) gates the whole surface.

import { apiGet, apiPatch, apiPost } from '../auth/api-client';

export interface RopaEntry {
  id: string;
  processingActivity: string;
  categoriesOfData: string[];
  purpose: string;
  recipients: string[];
  retentionPeriodMonths: number | null;
  updatedAt: string;
  createdAt: string;
}

export interface RopaExportSummary {
  generatedAt: string;
  entryCount: number;
  entries: RopaEntry[];
}

export function listRopaEntries(): Promise<RopaEntry[]> {
  return apiGet('/ropa-entries');
}

export function createRopaEntry(body: {
  processingActivity: string;
  categoriesOfData: string[];
  purpose: string;
  recipients: string[];
  retentionPeriodMonths?: number;
}): Promise<RopaEntry> {
  return apiPost('/ropa-entries', body);
}

export function updateRopaEntry(
  id: string,
  body: Partial<{
    processingActivity: string;
    categoriesOfData: string[];
    purpose: string;
    recipients: string[];
    retentionPeriodMonths: number;
  }>,
): Promise<RopaEntry> {
  return apiPatch(`/ropa-entries/${id}`, body);
}

export function exportRopaRegister(): Promise<RopaExportSummary> {
  return apiGet('/ropa-entries/export');
}

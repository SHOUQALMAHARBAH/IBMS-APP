// M10 — DPIA Screening (backlog Part D §5.1, Process #52). dpia.review
// (DPO) gates the whole surface, including submission.

import { apiGet, apiPost } from '../auth/api-client';

export interface DpiaScreening {
  id: string;
  subjectDescription: string;
  qSensitiveData: boolean;
  qLargeScaleProcessing: boolean;
  qCrossBorderTransfer: boolean;
  qNewTechnologyMonitoring: boolean;
  qNewDigitalChannel: boolean;
  outcome: 'AUTO_APPROVED' | 'DPO_REVIEW_REQUIRED' | 'ESCALATED_FULL_DPIA';
  dpoReviewDueAt: string | null;
  dpoReviewedAt: string | null;
  dpoSpotCheckedAt: string | null;
  escalatedToFullDpiaAt: string | null;
  createdAt: string;
}

export function listDpiaScreenings(outcome?: string): Promise<DpiaScreening[]> {
  return apiGet(`/dpia-screenings${outcome ? `?outcome=${outcome}` : ''}`);
}

export function createDpiaScreening(body: {
  subjectDescription: string;
  qSensitiveData: boolean;
  qLargeScaleProcessing: boolean;
  qCrossBorderTransfer: boolean;
  qNewTechnologyMonitoring: boolean;
  qNewDigitalChannel: boolean;
}): Promise<DpiaScreening> {
  return apiPost('/dpia-screenings', body);
}

export function recordDpiaReview(id: string): Promise<DpiaScreening> {
  return apiPost(`/dpia-screenings/${id}/review`, {});
}

export function recordDpiaSpotCheck(id: string): Promise<DpiaScreening> {
  return apiPost(`/dpia-screenings/${id}/spot-check`, {});
}

export function escalateDpiaToFullDpia(id: string): Promise<DpiaScreening> {
  return apiPost(`/dpia-screenings/${id}/escalate`, {});
}

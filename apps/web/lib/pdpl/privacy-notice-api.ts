// Notices (backlog Part D §5.1, Process #52). privacy-notice.publish
// (DPO + Compliance) gates create/list/legal-review; current() also
// accepts consent.manage — the touchpoint-facing roles that display it.

import { apiGet, apiPost } from '../auth/api-client';

export const PRIVACY_NOTICE_TOUCHPOINTS = [
  'lead_capture',
  'onboarding_kyc',
  'needs_risk_assessment',
  'rfq_market_placement',
  'claims',
  'group_medical_life_motor_fleet',
  'renewal_cross_sell',
] as const;

export interface PrivacyNotice {
  id: string;
  touchpoint: string;
  versionNumber: number;
  textAr: string;
  textEn: string;
  legallyReviewedAt: string | null;
  publishedAt: string;
}

export function listPrivacyNotices(touchpoint?: string): Promise<PrivacyNotice[]> {
  return apiGet(`/privacy-notices${touchpoint ? `?touchpoint=${touchpoint}` : ''}`);
}

export async function currentPrivacyNotice(
  touchpoint: string,
): Promise<PrivacyNotice | null> {
  const res = await apiGet<{ notice: PrivacyNotice | null }>(
    `/privacy-notices/current?touchpoint=${touchpoint}`,
  );
  return res.notice;
}

export function createPrivacyNotice(body: {
  touchpoint: string;
  textAr: string;
  textEn: string;
}): Promise<PrivacyNotice> {
  return apiPost('/privacy-notices', body);
}

export function recordPrivacyNoticeLegalReview(id: string): Promise<PrivacyNotice> {
  return apiPost(`/privacy-notices/${id}/legal-review`, {});
}

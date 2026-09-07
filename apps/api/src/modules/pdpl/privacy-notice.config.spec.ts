import { describe, expect, it } from 'vitest';
import {
  derivePrivacyNoticeView,
  privacyNoticeAuditSnapshot,
  type PrivacyNoticeRow,
} from './privacy-notice.config';

const row = (over: Partial<PrivacyNoticeRow> = {}): PrivacyNoticeRow => ({
  id: 'pn-1',
  touchpoint: 'onboarding_kyc',
  versionNumber: 1,
  textAr: '...',
  textEn: 'We collect your data to perform KYC checks.',
  legallyReviewedAt: null,
  publishedAt: new Date('2026-09-07T00:00:00.000Z'),
  ...over,
});

describe('derivePrivacyNoticeView', () => {
  it('serializes dates and passes through bilingual text', () => {
    const v = derivePrivacyNoticeView(row());
    expect(v.publishedAt).toBe('2026-09-07T00:00:00.000Z');
    expect(v.legallyReviewedAt).toBeNull();
    expect(v.textEn).toBe('We collect your data to perform KYC checks.');
  });
});

describe('privacyNoticeAuditSnapshot', () => {
  it('excludes the notice text itself, keeping only touchpoint/version', () => {
    const snap = privacyNoticeAuditSnapshot(row());
    expect(snap).toEqual({
      privacyNoticeId: 'pn-1',
      touchpoint: 'onboarding_kyc',
      versionNumber: 1,
    });
  });
});

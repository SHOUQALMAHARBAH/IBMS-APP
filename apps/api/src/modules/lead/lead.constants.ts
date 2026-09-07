export { emptyStringToUndefined } from '../../common/dto.util';

/** Every acquisition source named in the Lead model comment
 * (packages/db/prisma/schema.prisma, Process 1 — Lead Management):
 * "referrals, website, social media, campaigns, tenders, corporate/bank
 * partnerships, strategic partners, ex-customers, renewal opportunities." */
export const LEAD_SOURCES = [
  'referral',
  'website',
  'social_media',
  'campaign',
  'tender',
  'bank_partner',
  'strategic_partner',
  'ex_customer',
  'renewal',
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

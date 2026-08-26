import type { TransformFnParams } from 'class-transformer';

/** class-validator's `@IsOptional()` only skips validation for `undefined`/
 * `null`, not `""` — an empty query-string value (`GET /leads?ownerUserId=`)
 * or an empty form field would otherwise still hit `@IsEmail()`/`@IsUUID()`/
 * `@IsIn()` and 400. Use as `@Transform(emptyStringToUndefined)` above
 * `@IsOptional()` on any optional field that can arrive as `""`. */
export function emptyStringToUndefined({ value }: TransformFnParams): unknown {
  return value === '' ? undefined : value;
}

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

import { IsEnum } from 'class-validator';

/**
 * Part F — Bilingual UI (backlog Part 11), item #1: "instant language switch
 * ... + a persistent per-user language preference." `PATCH /auth/me/language`
 * — every authenticated user manages their own; no permission beyond being
 * signed in (the `GET /auth/me` shape, not an admin-on-another-user action).
 */
export class UpdateLanguagePreferenceDto {
  @IsEnum(['AR', 'EN'])
  languagePreference!: 'AR' | 'EN';
}

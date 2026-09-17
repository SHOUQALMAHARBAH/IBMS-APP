import { IsString, Length } from 'class-validator';

/**
 * Part II §4.3.1 — the one mandatory password change, on first login.
 *
 * Carries the onboarding token rather than running on a session, because the
 * login that led here deliberately issued no session: the spec's wording is
 * "response is MUST_CHANGE_PASSWORD, not a session token".
 */
export class ForceChangePasswordDto {
  @IsString()
  @Length(1, 4096)
  onboardingToken!: string;

  /** Bounds only — the real policy lives in `PasswordService.assertMeetsPolicy`,
   * one source of truth shared with signup and reset, including the 72-byte
   * bcrypt ceiling. Generous in characters because the limit is in BYTES and an
   * Arabic passphrase reaches it far sooner. */
  @IsString()
  @Length(12, 200)
  newPassword!: string;
}

/** Part II §4.7 — self-service change, once onboarding is done. */
export class ChangePasswordDto {
  /** §4.7.2 — required. Without it, anyone with a live session on an unlocked
   * machine could set a new password and lock the real owner out. */
  @IsString()
  @Length(1, 200)
  currentPassword!: string;

  @IsString()
  @Length(12, 200)
  newPassword!: string;
}

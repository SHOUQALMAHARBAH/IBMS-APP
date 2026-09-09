import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Part 3.9 — the two re-marketing triggers the context document names: a
 * materially changed risk needs a fresh Risk Assessment, and worsened insurer
 * terms need full re-marketing. Neither is a status, so neither goes through
 * the workflow engine. At least one must be supplied (422 otherwise).
 */
export class SetRenewalFlagsDto {
  @IsOptional()
  @IsBoolean()
  riskChangedSinceLastRenewal?: boolean;

  @IsOptional()
  @IsBoolean()
  insurerTermsWorsened?: boolean;
}

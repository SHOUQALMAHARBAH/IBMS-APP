import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Process 5/6 — creates the minimal parent Risk Profile a Needs Assessment
 * (Process 5) hangs off. The detailed building/equipment/stock/fleet survey,
 * the per-asset declared values, and the Sum Insured / indemnity-period
 * derivation are Process 6 (Risk Assessment) — not built in this backlog
 * item; see README § Known gaps, Part C #5. */
export class CreateRiskProfileDto {
  @IsUUID()
  customerId!: string;

  /**
   * The site or entity this profile covers — one Risk Profile per location.
   *
   * **REQUIRED, and it was optional until 2026-09-29.** Measured before changing it: 767 `RiskProfile`
   * rows across dev and db-test and ZERO have a null or empty label, so the column was nullable by
   * OMISSION rather than by design and the screens' fallback had never rendered. That fallback printed a
   * truncated uuid at the reader — and the list's `aria-label` fell back to the FULL uuid, so a screen
   * reader announced all 36 characters.
   *
   * Requiring it here is what let the fallback be DELETED rather than replaced with a different
   * unreadable label: nothing on this row is a name a person recognises (`customerId` is a uuid, and the
   * list is already scoped to one customer), so there was no better substitute to choose.
   *
   * Still `@Transform(emptyStringToUndefined)` FIRST, so `'   '` cannot satisfy the length floor — the
   * same ordering the narrow employee search depends on.
   */
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200, {
    message:
      'siteLabel is required — a risk profile is identified to a person by its site, and there is no other readable name on the record',
  })
  siteLabel!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 2000)
  priorClaimsHistorySummary?: string;
}

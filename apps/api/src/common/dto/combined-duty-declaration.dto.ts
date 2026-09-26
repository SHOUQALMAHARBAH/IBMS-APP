import { IsOptional, IsString, Length } from 'class-validator';
import { COMBINED_DUTY_REASON_MIN_LENGTH } from '../../modules/duty-segregation/duty-segregation.service';

/**
 * The optional combined-duty declaration, for every route that records a checker decision.
 *
 * Extended rather than copied into eighteen DTOs: the field name and its floor are a property of what a
 * declaration IS, and eighteen copies is eighteen places for one of them to drift to a different minimum or
 * a different spelling — which a caller would discover as a 422 about a field they thought they had sent.
 *
 * OPTIONAL, and that is the whole shape of it. An ordinary two-person approval sends nothing and behaves
 * exactly as it did before Part 4. The field is REQUIRED only when the actor is also the maker AND the office
 * has declared COMBINED mode, and that condition is decided in `DutySegregationService` — a DTO cannot see
 * the office's mode, and making the field mandatory here would break every normal approval in the product.
 */
export class CombinedDutyDeclarationDto {
  @IsOptional()
  @IsString()
  @Length(COMBINED_DUTY_REASON_MIN_LENGTH, 2000)
  combinedDutyReason?: string;
}

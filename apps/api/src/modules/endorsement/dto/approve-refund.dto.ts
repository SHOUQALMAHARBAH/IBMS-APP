import { IsOptional, IsString, Length } from 'class-validator';
import { COMBINED_DUTY_REASON_MIN_LENGTH } from '../../duty-segregation/duty-segregation.service';

/**
 * `POST /refunds/:id/approve` — the body exists only for the combined-duty declaration.
 *
 * OPTIONAL, and that is the point: an ordinary two-person approval sends nothing and behaves exactly as it
 * did before Part 4. The field is required only when the approver is also the raiser AND the office has
 * declared COMBINED mode, and that condition is decided in `DutySegregationService`, not here — a DTO cannot
 * see the office's mode, and making the field mandatory would break every normal approval.
 */
export class ApproveRefundDto {
  @IsOptional()
  @IsString()
  @Length(COMBINED_DUTY_REASON_MIN_LENGTH, 2000)
  combinedDutyReason?: string;
}

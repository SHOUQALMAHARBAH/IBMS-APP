import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * What the screen asks before it sends a quote request.
 *
 * It names the OPPORTUNITY and the LINE rather than an RFQ id, because the RFQ does not exist
 * yet — the whole point is to ask the question BEFORE the request is sent. The opportunity is
 * what makes the answer this office's: the service resolves the line through the opportunity's
 * own designed programme, and a caller who cannot see that opportunity gets the same 404 every
 * other RFQ route gives them.
 */
export class Article15DOptionsQueryDto {
  @IsUUID()
  opportunityId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  insuranceLine!: string;

  /**
   * How many insurers the shortlist currently holds. ZERO is a real value and is deliberately
   * allowed: an employee who has picked none is below the minimum, and the question belongs on
   * screen then too rather than appearing only after they pick one.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  insurerCount!: number;
}

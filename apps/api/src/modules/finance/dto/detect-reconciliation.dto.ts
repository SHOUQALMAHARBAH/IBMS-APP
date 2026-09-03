import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MONEY_STRING, trimIfString } from '../../../common/dto.util';
import { RECON_DETECT_MAX_LINES } from '../finance.config';

/** One line of an insurer's statement: what the insurer says the premium
 * settlement figure is for a given (policy) invoice. */
export class ReconciliationStatementLineDto {
  @IsUUID()
  invoiceId!: string;

  /** The figure on the insurer's statement, fils-precision. Compared against
   * the broker's own record (`premiumAmount − commissionDeducted`); any
   * non-zero variance ALWAYS raises a `ReconciliationException`
   * (`money-decimal-jod.md` — never silently written off). */
  @Transform(trimIfString)
  @Matches(MONEY_STRING, {
    message:
      'insurerStatementAmount must be a decimal amount with at most 3 places',
  })
  insurerStatementAmount!: string;
}

/**
 * Process 39 — `POST /reconciliation-exceptions/detect`
 * (`reconciliation-exception.investigate` / Finance). Runs the variance check
 * over a batch of insurer-statement lines and raises a
 * `ReconciliationException` for every non-zero variance. Zero-variance lines
 * reconcile silently (no exception).
 */
export class DetectReconciliationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(RECON_DETECT_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => ReconciliationStatementLineDto)
  lines!: ReconciliationStatementLineDto[];
}

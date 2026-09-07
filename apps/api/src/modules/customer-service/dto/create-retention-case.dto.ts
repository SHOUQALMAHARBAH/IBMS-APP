import { IsIn, IsUUID } from 'class-validator';
import { RETENTION_CASE_REASONS } from '../retention-case.config';

/**
 * Process 46 — `POST /retention-cases` (`retention-case.manage` / Sales,
 * Manager). Manually opens a retention case — the escape hatch alongside the
 * automatic sweep (`runSweep`) for a case Sales notices outside a
 * `RenewalCase` signal (e.g. a customer who says outright they are not
 * renewing).
 */
export class CreateRetentionCaseDto {
  @IsUUID()
  customerId!: string;

  @IsIn([...RETENTION_CASE_REASONS], {
    message: `reason must be one of: ${RETENTION_CASE_REASONS.join(', ')}`,
  })
  reason!: string;
}

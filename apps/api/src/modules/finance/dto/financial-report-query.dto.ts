import { IsOptional, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * Process 40 — `GET /financial-report/summary`. `asOf` is the point-in-time
 * reference date for the receivables + payables sections — a plain
 * `YYYY-MM-DD`, today or earlier (a future `asOf` is meaningless; the service
 * 422s it), default today. Commission + profitability are current-state (the
 * commission ledger and `Policy.issuedPremium` are not time-versioned). No
 * line / insurer / branch filters here — those are a Part E dashboard
 * refinement.
 */
export class FinancialReportQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'asOf must be a calendar date in YYYY-MM-DD form',
  })
  asOf?: string;
}

import { IsUUID } from 'class-validator';

/** `GET /risk-profiles` is always scoped to one customer — a Risk Profile
 * only means anything in a customer's context, and the caller's visibility
 * is resolved against that Customer (see RiskProfileService.list). */
export class ListRiskProfilesQueryDto {
  @IsUUID()
  customerId!: string;
}

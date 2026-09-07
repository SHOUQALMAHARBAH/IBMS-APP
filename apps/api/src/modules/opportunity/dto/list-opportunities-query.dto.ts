import { IsUUID } from 'class-validator';

/** `GET /opportunities` is always scoped to one customer — an Opportunity
 * only means anything in a customer's context, and the caller's visibility
 * is resolved against that Customer (see OpportunityService.list). Same
 * shape as ListInsuranceProgramsQueryDto. */
export class ListOpportunitiesQueryDto {
  @IsUUID()
  customerId!: string;
}

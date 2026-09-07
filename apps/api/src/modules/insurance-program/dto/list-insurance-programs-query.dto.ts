import { IsUUID } from 'class-validator';

/** `GET /insurance-programs` is always scoped to one customer — a program
 * only means anything in a customer's context, and the caller's visibility
 * is resolved against that Customer (see InsuranceProgramService.list). Same
 * shape as ListRiskProfilesQueryDto. */
export class ListInsuranceProgramsQueryDto {
  @IsUUID()
  customerId!: string;
}

import { IsDateString, IsOptional } from 'class-validator';

/** Process 72-73 — `POST /bcp-dr-plans/:id/record-test` (`bcp-dr.manage`).
 * `nextTestDueAt` is mandatory — there is no sourced test-cadence figure
 * for BCP/DR plans generally (unlike #71's Vendor annual review), so the
 * caller states it explicitly rather than the system fabricating an
 * interval. `testedAt` defaults to now if omitted. */
export class RecordBcpDrPlanTestDto {
  @IsOptional()
  @IsDateString()
  testedAt?: string;

  @IsDateString()
  nextTestDueAt!: string;
}

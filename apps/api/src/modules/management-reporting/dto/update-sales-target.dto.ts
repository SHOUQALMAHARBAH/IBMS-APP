import { IsInt, Min } from 'class-validator';

/** Process 59 — `PATCH /sales-targets/:id` (`sales-target.manage`). Only the
 * quota number is revisable — the scope (owner/branch) and period are fixed
 * at creation; retargeting a different scope/period is a new row, not an
 * edit of this one (the `ProfessionalIndemnityPolicy` renewal-is-a-new-row
 * shape). */
export class UpdateSalesTargetDto {
  @IsInt()
  @Min(1)
  targetNewProspects!: number;
}

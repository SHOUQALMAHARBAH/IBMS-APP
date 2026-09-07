import { IsBoolean, IsOptional } from 'class-validator';

/** Process 66 — `PATCH /employees/:id/deprovisioning-checklist`
 * (`deprovisioning.execute`). Each flag is a one-way tick: `true` records
 * the corresponding sub-item's timestamp NOW if it isn't already recorded;
 * `false`/omitted is a no-op (there is no "un-revoke" action). */
export class UpdateDeprovisioningChecklistDto {
  @IsOptional()
  @IsBoolean()
  systemAccessRevoked?: boolean;

  @IsOptional()
  @IsBoolean()
  physicalAccessRevoked?: boolean;

  @IsOptional()
  @IsBoolean()
  deviceReturned?: boolean;

  @IsOptional()
  @IsBoolean()
  knowledgeTransferDone?: boolean;
}

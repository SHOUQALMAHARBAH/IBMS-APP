import { IsString, IsUUID, Length } from 'class-validator';

/**
 * Process 51 — `POST /compliance-calendar` (`compliance-calendar.manage` /
 * Compliance). `dueDate` is a plain calendar date (`parseCalendarDate`).
 */
export class CreateComplianceCalendarItemDto {
  @IsString()
  @Length(1, 300)
  obligationName!: string;

  @IsUUID()
  ownerUserId!: string;

  @IsString()
  dueDate!: string;
}

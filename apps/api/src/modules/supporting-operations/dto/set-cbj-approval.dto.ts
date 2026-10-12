import { IsEnum, IsOptional, Matches, ValidateIf } from 'class-validator';
import { CbjApprovalStatus } from '@ibms/db';

/**
 * Module 0 item (g) — `PATCH /employees/:id/cbj-approval` (`employee.update`).
 *
 * ## ABSENT and NULL mean different things, and both are needed
 *
 * `status` absent leaves the approval alone; `status: null` WITHDRAWS it. They cannot be collapsed:
 * a PATCH treating "not sent" as "withdraw" would silently empty the office's staffing count on a
 * request that only meant to correct a date. `@ValidateIf(v => v !== null)` is what lets null
 * through the enum check without widening the enum to include it.
 *
 * ## The date is a STRING in YYYY-MM-DD, validated twice
 *
 * `@Matches` here catches the wrong SHAPE with a message about the shape. It does NOT catch
 * 2026-02-30, which parses cleanly to 2 March — IMPROVEMENTS § 1.63, the defect that stored a date
 * nobody typed — so the service round-trips it through `isCalendarDate` as well. Two messages,
 * because "that is not a date" and "that day does not exist" are different problems.
 */
export class SetCbjApprovalDto {
  /**
   * CURRENT, SUSPENDED, CANCELLED — or null to withdraw the marker entirely. Absent leaves it.
   */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  // The schema's own enum object, never a hand-written copy of its three values: a copy is a
  // second home, and a fourth status added to the schema would pass this DTO while every reader
  // of the marker silently did not handle it.
  @IsEnum(CbjApprovalStatus)
  status?: CbjApprovalStatus | null;

  /**
   * The day the CBJ granted it, or null when it is not on record — which is a real and common
   * state: the 54 rows migrated from free text carry a status and no date, and inventing one would
   * record a fact nobody can source.
   */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'approvalDate must be a calendar date in YYYY-MM-DD form',
  })
  approvalDate?: string | null;
}

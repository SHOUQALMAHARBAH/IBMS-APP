import { IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

/** Part B §16 — assign a screening case to a named reviewer. */
export class AssignScreeningCaseDto {
  @IsUUID()
  assigneeUserId!: string;
}

/**
 * Part B §16 — escalate a case.
 *
 * The reason is mandatory with a real minimum length: an escalation with no
 * stated basis tells the person receiving it nothing about why it arrived, and
 * this is the text a reviewer reads first. The database enforces it too
 * (`ScreeningMatch_escalated_has_reason`).
 */
export class EscalateScreeningCaseDto {
  @IsUUID()
  toUserId!: string;

  @Transform(trimIfString)
  @IsString()
  @Length(10, 2000, {
    message:
      'reason must explain why this case is being escalated (at least 10 characters)',
  })
  reason!: string;
}

/**
 * Part B §16 — a working note.
 *
 * Distinct from the decision's `reviewReason`: that is written once, at
 * closure, and justifies the outcome. These are the working record — what was
 * checked, who was contacted, what a document said — and are append-only.
 */
export class AddScreeningCaseNoteDto {
  @Transform(trimIfString)
  @IsString()
  @Length(1, 4000)
  note!: string;
}

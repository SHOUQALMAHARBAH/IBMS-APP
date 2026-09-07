import { IsString, Length } from 'class-validator';

/**
 * Process 57 — `GET /audit-trail/workflow-history?entityType=&entityId=`
 * (`workflow-history.read`). Both required — the state-change history is
 * always requested for one specific record.
 */
export class WorkflowHistoryQueryDto {
  @IsString()
  @Length(1, 100)
  entityType!: string;

  @IsString()
  @Length(1, 100)
  entityId!: string;
}

import { IsIn } from 'class-validator';
import type { RfqInsurerStatus } from '@ibms/db';

/** The RfqInsurerStatus values a caller may move a submission *to* — SENT is
 * the initial state, never a target. The legal-move map itself
 * (SENT->VIEWED->..., a late responder after NO_RESPONSE, etc.) is enforced
 * by WorkflowTransitionService against WORKFLOW_TRANSITIONS.RFQInsurer — this
 * list only rejects "SENT" and any junk value at the DTO boundary.
 *
 * Keep in sync with `RFQ_INSURER_TARGET_STATUSES` in
 * apps/web/lib/rfq/rfq-api.ts (the web can't import this module). */
export const RFQ_INSURER_TARGET_STATUSES = [
  'VIEWED',
  'QUOTED',
  'DECLINED',
  'NO_RESPONSE',
] as const satisfies readonly RfqInsurerStatus[];

/** Process 12 territory reached from #11 — record an insurer's response
 * status on their RFQ submission (viewed / quoted / declined / no response). */
export class TransitionRfqInsurerDto {
  @IsIn(RFQ_INSURER_TARGET_STATUSES)
  toStatus!: (typeof RFQ_INSURER_TARGET_STATUSES)[number];
}

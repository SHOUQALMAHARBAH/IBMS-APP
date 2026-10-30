import { IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  trimIfString,
} from '../../../common/dto.util';
import { DECLARATION_REASON_MIN_LENGTH } from '../../../common/declaration-reason';

/**
 * OWNER DECISION 56 — `POST /incidents/:id/contain` COLLECTS WHAT IT CLAIMS.
 *
 * Her words, pressing that button: «لما أضغط ع زر الاحتواء بس بغيّر الحالة إلى تم
 * احتوائه». The route took NO BODY AT ALL and wrote a bare `containedAt` timestamp, so
 * the only thing it recorded was that somebody had pressed a button.
 *
 * `PRIV-SRS-02`, sheet `IncidentReport`, types the field it should have been writing as:
 *
 *     containment_actions | Text (log) | REQUIRED | Timestamped containment actions.
 *
 * sourced to `PRIV-SOP-09` step 3 — «عزل الأنظمة أو الحسابات المتأثرة فوراً لمنع اتساع
 * الضرر (الاحتواء)». So the description is MANDATORY and the act APPENDS to a log.
 *
 * ## WHY THERE IS NO PLACEHOLDER TO INVENT
 *
 * `PRIV-FRM-06` § III asks, verbatim:
 *
 *     «وصف أي إجراء احتواء فوري (كعزل نظام أو تعطيل حساب)»
 *
 * The parenthetical IS the example, written by the owner in her own approved form — so
 * the screen's hint is transcribed, not composed, and decision 94 is not engaged.
 *
 * ## THE MINIMUM IS THE SHARED ONE
 *
 * `DECLARATION_REASON_MIN_LENGTH`, the same floor `rootCauseAnalysis` is held to before
 * Closed on this very model, and the same number the combined-duty declaration uses.
 * Never write `10` here: `common/declaration-reason.ts` is its one home.
 */
export class ContainIncidentDto {
  @Transform(trimIfString)
  @IsString()
  @Length(DECLARATION_REASON_MIN_LENGTH, 2000, {
    message:
      `description must be at least ${DECLARATION_REASON_MIN_LENGTH} characters — ` +
      'PRIV-SRS-02 types containment_actions as a REQUIRED timestamped log, and a blank ' +
      'entry would make "contained" mean that somebody pressed a button',
  })
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `description ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  description!: string;
}

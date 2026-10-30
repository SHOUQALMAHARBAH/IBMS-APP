import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';
import { IsCalendarDate } from '../../../common/is-calendar-date.validator';

/**
 * `POST /broker-license/regulatory-actions` (`license.manage`) — the office records a decision the
 * regulator took about its licence.
 *
 * ## THIS REPLACES `POST /broker-license/mark-lapsed`, AND THE DIFFERENCE IS THE POINT
 *
 * That route took NO BODY — its own comment said *"the model has no reason field to hold one"* — and
 * flipped `BrokerLicense.status` to `'lapsed'`. So the office's record of a CBJ suspension was a
 * two-value flag: no basis, no effective date, no decision reference, no letter. The derivation read
 * it as SUSPENDED with a NULL decision reference and its own comment called that null "the finding",
 * because *"a suspension nobody can cite is exactly the state `RegulatoryAction` exists to end"*.
 *
 * So the fields below are not bureaucracy. Each is what makes the row answerable a year later, and
 * three of them are what the DERIVATION reads:
 *   - `kind` and `basis` decide whether art. 14/c's two-year rule can apply at all (only to a
 *     BROKER_REQUEST suspension — whether it reaches an art. 21/b sanction is unsettled and is NOT
 *     inferred);
 *   - `effectiveFrom` is what the two years are counted from;
 *   - `suspendedUntil` is how a suspension ends on its own, which the database refuses on any other
 *     kind.
 *
 * ## THERE IS NO REGULATOR IN THIS SYSTEM
 *
 * The CBJ acts on the office outside this product. This records a letter the office RECEIVED; it is
 * not the regulator acting, and nothing here grants the regulator an account or a screen.
 */
export class RecordRegulatoryActionDto {
  /** A closed three — the database's own enum, so a fourth is a 400 at the boundary. */
  @IsIn(['SUSPENSION', 'CANCELLATION', 'REINSTATEMENT'])
  kind!: 'SUSPENSION' | 'CANCELLATION' | 'REINSTATEMENT';

  /**
   * On what basis. `BROKER_REQUEST` is the office's own application; `SANCTION` is imposed.
   *
   * It decides whether art. 14/c's deemed cancellation can apply, so it is not cosmetic: the
   * derivation converts a long-standing BROKER_REQUEST suspension into a cancellation and
   * deliberately does NOT do so for a SANCTION.
   */
  @IsIn(['BROKER_REQUEST', 'SANCTION'])
  basis!: 'BROKER_REQUEST' | 'SANCTION';

  /** The date the decision takes effect, as printed on the letter. */
  @IsCalendarDate()
  effectiveFrom!: string;

  /**
   * The CBJ's own reference for the decision — NOT NULL in the database, and required here for the
   * reason the derivation's comment gives: a standing change nobody can cite is the state this table
   * exists to end.
   */
  @IsString()
  @Transform(trimIfString)
  @Length(1, 200)
  decisionRef!: string;

  /**
   * The letter itself, filed under `REGULATORY_DECISION`. OPTIONAL: an office told by telephone or
   * portal and still waiting for the paper must be able to record the decision NOW — refusing the
   * row until the document arrives would leave the standing wrong in the meantime, which is the
   * worse failure. Decision 88's own judgement about the two art. 10/a documents, applied here.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  documentId?: string;

  /**
   * When a SUSPENSION ends on its own. The database refuses it on any other kind by CHECK, so a
   * cancellation carrying an end date is unrepresentable rather than merely rejected.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsCalendarDate()
  suspendedUntil?: string;
}

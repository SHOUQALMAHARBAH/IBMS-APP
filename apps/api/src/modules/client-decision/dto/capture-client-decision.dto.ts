import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ClientDecisionType } from '@ibms/db';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';
import { EVIDENCE_TYPES } from '../client-decision.config';

const DECISION_TYPES = Object.values(ClientDecisionType);

/** Process 17 — record the client's single decision on a sent recommendation.
 * The Opportunity must have a `Recommendation` with `sentToClientAt` set, and
 * must not already carry a `ClientDecision` (409). */
export class CaptureClientDecisionDto {
  @IsUUID()
  opportunityId!: string;

  /** One of the six `ClientDecisionType` values — ACCEPT / REJECT /
   * REQUEST_FURTHER_NEGOTIATION / REQUEST_ALTERNATIVE_OPTIONS /
   * REQUEST_PRICE_REDUCTION / REQUEST_COVERAGE_INCREASE. */
  @IsIn(DECISION_TYPES, {
    message: `decision must be one of: ${DECISION_TYPES.join(', ')}`,
  })
  decision!: ClientDecisionType;

  /** How the decision was evidenced (Part 4.1 — a decision of record needs a
   * reference). */
  @IsIn(EVIDENCE_TYPES, {
    message: `evidenceType must be one of: ${EVIDENCE_TYPES.join(', ')}`,
  })
  evidenceType!: (typeof EVIDENCE_TYPES)[number];

  /** A pointer to the evidence — a document id, an e-signature envelope id,
   * or an email message reference. Not the evidence content. */
  @IsString()
  @Transform(trimIfString)
  @MinLength(2)
  @MaxLength(500)
  evidenceRef!: string;

  /** Optional context the officer recorded (e.g. which terms the client wants
   * changed on a REQUEST_* decision). Confidential — kept out of the audit
   * snapshot. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(8000)
  notes?: string;
}

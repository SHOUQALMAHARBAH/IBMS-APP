import { IsString, IsUUID } from 'class-validator';

/**
 * 🔴 OWNER DECISION 139 ruling 4 — ATTACHING THE EVIDENCE AFTERWARDS.
 *
 * «يسجّل الموظف المراسلة في سجل المراسلات ويربطها بالطلب ⟵ يزول الوسم.»
 *
 * ONE FIELD, and that is the whole shape. The employee is not re-choosing the exemption, not
 * editing the reason and not changing who chose it — decision 129's criterion 7 keeps all of
 * that immutable, and the database refuses every one of those edits by trigger. They are
 * pointing at a communication that was already logged.
 *
 * ⛔ AND THE RULES ARE NOT RESTATED HERE. Whether the log is INBOUND, belongs to this
 * opportunity's own customer, and arrived by one of art. 22/s's four approved means is decided by
 * the SAME code the original choice went through (`resolveEvidence`), never by a second copy. A
 * DTO-level check would be a second answer to «what counts as evidence», and the two would drift
 * the first time decision 132's list of means changed.
 */
export class AttachArticle15DEvidenceDto {
  /** A `CommunicationLog` already on file for this office. */
  @IsString()
  @IsUUID()
  evidenceCommunicationLogId!: string;
}

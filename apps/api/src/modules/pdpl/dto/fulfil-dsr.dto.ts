import { IsBoolean, IsOptional } from 'class-validator';

/**
 * M04 — `POST /dsr/:id/fulfil` (`dsr.handle`), `IN_PROGRESS -> FULFILLED`.
 *
 * For a DELETION request, `confirmNoOpenRetentionHold: true` is MANDATORY
 * (checked in the service, not by `class-validator` here, since the
 * requirement is conditional on `type`) — the backlog's "never closeable as
 * fully fulfilled [while a retention flag is open]" rule (M04). There is no
 * automated check against a real retention data source yet (Retention &
 * Disposal / M06 is not built — `RetentionScheduleItem`/`LegalHold` exist in
 * the schema but nothing populates them), so this is a staff attestation,
 * not a system-verified fact — deliberately kept a LIVE, enforced gate
 * rather than a dormant one that would always trivially pass (the #48
 * `third_party_payment_source`-dormancy lesson): the DPO must consciously
 * confirm before a Deletion request can close as fully fulfilled. Ignored
 * for non-DELETION types.
 */
export class FulfilDsrDto {
  @IsOptional()
  @IsBoolean()
  confirmNoOpenRetentionHold?: boolean;
}

import { IsBoolean, IsOptional } from 'class-validator';

/**
 * M04 — `POST /dsr/:id/fulfil` (`dsr.handle`), `IN_PROGRESS -> FULFILLED`.
 *
 * For a DELETION request, the service now runs TWO checks before allowing
 * FULFILLED (Process #52 widening, migration `20260916120000`):
 *
 *   1. A REAL, live check — `LegalHoldRepository.hasActiveHoldForSubject()`
 *      — against M06's `LegalHold` register. If an active hold names this
 *      exact customer/insuredPerson, `fulfil()` 422s outright; this field
 *      cannot override it. (When M04 first shipped, M06 did not exist yet
 *      — `RetentionScheduleItem`/`LegalHold` were in the schema but nothing
 *      populated them — so no such check was possible. M06 has since
 *      shipped a real register; this closes that gap.)
 *   2. `confirmNoOpenRetentionHold: true` is MANDATORY (checked in the
 *      service, not by `class-validator` here, since the requirement is
 *      conditional on `type`) for the remaining case check (1) cannot
 *      cover: a record category whose `RetentionScheduleItem.
 *      retentionPeriodMonths` has not yet elapsed has no per-subject
 *      "hold" row to find — that is still a staff attestation, not a
 *      system-verified fact, deliberately kept a LIVE, enforced gate
 *      rather than a dormant one that would always trivially pass (the #48
 *      `third_party_payment_source`-dormancy lesson): the DPO must
 *      consciously confirm before a Deletion request can close as fully
 *      fulfilled.
 *
 * Both checks are ignored for non-DELETION types.
 */
export class FulfilDsrDto {
  @IsOptional()
  @IsBoolean()
  confirmNoOpenRetentionHold?: boolean;
}

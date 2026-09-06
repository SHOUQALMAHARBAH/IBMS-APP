import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Process 71 — `POST /vendors/:id/terminate` (`vendor.manage`).
 * `confirmDataReturnOrDestruction: true` is MANDATORY (checked in the
 * service, not by `class-validator`, the `FulfilDsrDto` staff-attestation
 * precedent) — there is no automated verification that a vendor actually
 * returned or destroyed the data it held, so this is a deliberate,
 * conscious attestation by the officer terminating the relationship, not a
 * system-verified fact.
 */
export class TerminateVendorDto {
  @IsOptional()
  @IsBoolean()
  confirmDataReturnOrDestruction?: boolean;
}

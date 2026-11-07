import { SetMetadata } from '@nestjs/common';

export const REQUIRE_STEP_UP_KEY = 'requireStepUp';

/**
 * Gate a route behind a *recent* re-authentication (Part 10.1 — refund
 * approval, data export, disposal approval). "Recent" = within
 * `SecurityConfig.stepUpMaxAgeMinutes` of a successful `POST /auth/step-up`.
 *
 * **CORRECTED 2026-11-06 (module 0-c batch 6b). This closed with: *"Not yet wired into any
 * business endpoint — those modules don't exist yet; this is the reusable gate for them to
 * adopt."*** Both halves had stopped being true, and the second one is why the first survived: the
 * modules DO exist, and the gate had been adopted by exactly one route —
 * `rbac.controller.ts`'s MFA security attributes — which is **none of the three cases named above**.
 * So the sentence read as a plan while the machinery sat complete and unused on the three endpoints
 * it was written for.
 *
 * All five now carry it, and the set is measured rather than assumed:
 *
 *   refund approval    `POST /endorsements/refunds/:id/approve`   `refund.approve`
 *   disposal approval  `POST /disposal-batches/:id/dpo-approve`   `retention.dispose.approve`
 *   data export        `POST /planning-export`                    `planning-export.generate`
 *   data export        `GET  /ropa-entries/export`                `ropa.manage`
 *   MFA attributes     `PATCH /roles/:id/security-attributes`     `role.update`  (the original)
 *
 * **"Data export" IS TWO ROUTES AND NOT TWENTY**: the two are the only routes that write
 * `AuditAction.EXPORT`, which is the product's own definition of an export. The 20 routes whose
 * path names a document, certificate or download are per-record business output — an invoice for
 * one client — and are deliberately NOT gated, because a re-authentication prompt in front of
 * printing an invoice is answered reflexively within a week and then means nothing anywhere.
 */
export const RequireStepUp = () => SetMetadata(REQUIRE_STEP_UP_KEY, true);

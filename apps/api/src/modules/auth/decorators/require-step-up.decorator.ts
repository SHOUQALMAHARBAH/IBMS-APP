import { SetMetadata } from '@nestjs/common';

export const REQUIRE_STEP_UP_KEY = 'requireStepUp';

/**
 * Gate a route behind a *recent* re-authentication (Part 10.1 — refund
 * approval, data export, disposal approval). "Recent" = within
 * `SecurityConfig.stepUpMaxAgeMinutes` of a successful `POST /auth/step-up`.
 * Not yet wired into any business endpoint — those modules don't exist yet;
 * this is the reusable gate for them to adopt.
 */
export const RequireStepUp = () => SetMetadata(REQUIRE_STEP_UP_KEY, true);

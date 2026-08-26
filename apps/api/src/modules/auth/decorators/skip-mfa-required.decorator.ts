import { SetMetadata } from '@nestjs/common';

export const SKIP_MFA_REQUIRED_KEY = 'skipMfaRequired';

/**
 * Opts a route out of MfaRequiredGuard. Only for the handful of routes a
 * not-yet-MFA-enrolled (but authenticated) user must still reach: enrolling
 * MFA itself, reading their own profile, and logging out.
 */
export const SkipMfaRequired = () => SetMetadata(SKIP_MFA_REQUIRED_KEY, true);

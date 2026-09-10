import { UseGuards, applyDecorators } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

/**
 * Rate limiting decorators for sensitive endpoints.
 *
 * Each decorator has its OWN named bucket, so each budget runs on its own
 * declared window. Every route sharing a decorator shares that bucket, which
 * is where the "an attacker must not multiply their budget by cycling
 * endpoints" property actually comes from: `signup` and `login` are one
 * bucket, `forgot-password` and `reset-password` are another.
 *
 * These previously shared ONE static store keyed on IP alone. Because
 * `resetTime` was stamped by whichever guard created the bucket first, a
 * single request to `/auth/login` (15-minute window) handed the password-reset
 * guard a 15-minute window in place of its declared 1 HOUR — 3 attempts every
 * 15 minutes, 12/hour, a 4x bypass reachable with one extra request. The
 * counter was shared too, so the reverse also happened: an MFA retry consumed
 * the login budget of a legitimate user.
 */

// 5 requests per 15 minutes, shared by signup + login.
const authGuard = new RateLimitGuard(15 * 60 * 1000, 5, 'auth');
// 3 requests per hour, shared by forgot-password + reset-password.
const passwordGuard = new RateLimitGuard(60 * 60 * 1000, 3, 'password-reset');
// 10 requests per 15 minutes, MFA challenge verification.
const mfaGuard = new RateLimitGuard(15 * 60 * 1000, 10, 'mfa');

export function AuthRateLimit() {
  return applyDecorators(UseGuards(authGuard));
}

export function PasswordRateLimit() {
  return applyDecorators(UseGuards(passwordGuard));
}

export function MfaRateLimit() {
  return applyDecorators(UseGuards(mfaGuard));
}

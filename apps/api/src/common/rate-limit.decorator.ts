import { UseGuards, applyDecorators, Inject } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

/**
 * Rate limiting decorators for sensitive endpoints.
 * All decorators share the SAME RateLimitGuard singleton instance,
 * so rate limits are cumulative across all auth endpoints (login, signup, forgot-password).
 * This prevents bypass attacks where an attacker cycles through different endpoints.
 */

const authGuard = new RateLimitGuard(15 * 60 * 1000, 5); // 5 requests per 15 minutes
const passwordGuard = new RateLimitGuard(1 * 60 * 60 * 1000, 3); // 3 requests per hour
const mfaGuard = new RateLimitGuard(15 * 60 * 1000, 10); // 10 requests per 15 minutes

export function AuthRateLimit() {
  return applyDecorators(UseGuards(authGuard));
}

export function PasswordRateLimit() {
  return applyDecorators(UseGuards(passwordGuard));
}

export function MfaRateLimit() {
  return applyDecorators(UseGuards(mfaGuard));
}

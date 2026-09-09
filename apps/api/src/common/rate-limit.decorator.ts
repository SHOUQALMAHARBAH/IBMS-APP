import { UseGuards, applyDecorators } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

/**
 * Rate limiting decorators for sensitive endpoints.
 * Apply to high-risk endpoints to prevent brute force attacks.
 */

export function RateLimit(windowMs: number, maxRequests: number) {
  return applyDecorators(
    UseGuards(new RateLimitGuard({ windowMs, maxRequests })),
  );
}

export function AuthRateLimit() {
  return RateLimit(15 * 60 * 1000, 5); // 5 requests per 15 minutes
}

export function PasswordRateLimit() {
  return RateLimit(1 * 60 * 60 * 1000, 3); // 3 requests per hour
}

export function MfaRateLimit() {
  return RateLimit(15 * 60 * 1000, 10); // 10 requests per 15 minutes
}

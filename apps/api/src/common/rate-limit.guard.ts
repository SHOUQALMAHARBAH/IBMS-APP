import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

interface ClientStore {
  count: number;
  resetTime: number;
}

/**
 * Singleton in-memory rate limiter for high-risk endpoints (auth, password reset).
 * Tracks requests per IP address within a sliding window.
 * Shared globally to prevent endpoint-bypass attacks (login -> signup -> forgot-password bypass).
 * For production with multiple replicas, use redis-based rate limiting instead.
 *
 * SECURITY NOTE: This is a per-process, per-IP limiter. In a multi-process deployment,
 * use Redis or a distributed rate limiter to track across all servers. The entries are
 * cleaned up on access (lazy cleanup) to prevent unbounded memory growth.
 *
 * ENFORCED IN PRODUCTION ONLY — the same `NODE_ENV` gate `securityHeaders()`'s
 * TLS enforcement, the secure-cookie flag and `ENABLE_DEV_RESET_TOKEN` already
 * use. Two reasons, and the first is not merely convenience:
 *
 *   - In dev/CI every request genuinely originates from 127.0.0.1, so a
 *     per-IP bucket lumps every user and every test together. It does not
 *     approximate production behaviour; it just breaks. All 63 `*.e2e-spec.ts`
 *     files sign up and log in repeatedly against one shared static store, so
 *     an enforced 5-per-15-minutes limit makes the integration suite
 *     unrunnable (verified: `429` on the sixth auth call).
 *   - A limiter is a control on untrusted internet traffic. Local dev and the
 *     CI container have no such traffic.
 *
 * `RATE_LIMIT_ENABLED=true` forces it on anywhere, which is how this file's
 * own unit spec exercises the limiting behaviour, and how a staging
 * environment can opt in without pretending to be production.
 */
function limiterEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.RATE_LIMIT_ENABLED === 'true'
  );
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private static readonly store = new Map<string, ClientStore>();
  private static readonly cleanupIntervalMs = 60 * 60 * 1000; // 1 hour
  private static lastCleanup = Date.now();
  private static readonly cleanupThresholdMs = 24 * 60 * 60 * 1000; // 1 day

  private readonly windowMs: number = 15 * 60 * 1000;
  private readonly maxRequests: number = 5;

  constructor(windowMs?: number, maxRequests?: number) {
    if (windowMs !== undefined) this.windowMs = windowMs;
    if (maxRequests !== undefined) this.maxRequests = maxRequests;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!limiterEnabled()) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = this.getClientIp(request);
    const now = Date.now();

    this.performCleanup(now);

    let clientData = RateLimitGuard.store.get(clientIp);

    if (!clientData || now > clientData.resetTime) {
      clientData = {
        count: 0,
        resetTime: now + this.windowMs,
      };
      RateLimitGuard.store.set(clientIp, clientData);
    }

    clientData.count++;

    if (clientData.count > this.maxRequests) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests, please try again later.',
          retryAfter: Math.ceil((clientData.resetTime - now) / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
        { cause: 'Rate limit exceeded' },
      );
    }

    return true;
  }

  /**
   * `x-forwarded-for` is CLIENT-SUPPLIED and trivially spoofable: an attacker
   * rotating the header gets a fresh bucket on every request, which defeats
   * the limiter entirely. It is therefore honoured ONLY when the deployment
   * declares that a trusted reverse proxy sets it — `TRUST_PROXY_HEADERS=true`
   * — the same "the deployment target decides" gate `securityHeaders()` and
   * the secure-cookie flag already use. With no proxy in front (local dev, and
   * any deployment that has not opted in) the socket address is the only
   * value an attacker cannot choose.
   */
  private getClientIp(request: Request): string {
    if (process.env.TRUST_PROXY_HEADERS === 'true') {
      const forwardedFor = request.headers['x-forwarded-for'];
      if (typeof forwardedFor === 'string') {
        return forwardedFor.split(',')[0].trim();
      }
      if (Array.isArray(forwardedFor)) {
        return forwardedFor[0].split(',')[0].trim();
      }
    }
    return request.ip ?? 'unknown';
  }

  private performCleanup(now: number): void {
    if (now - RateLimitGuard.lastCleanup < RateLimitGuard.cleanupIntervalMs) {
      return;
    }

    RateLimitGuard.lastCleanup = now;
    const expiredIps: string[] = [];

    for (const [ip, data] of RateLimitGuard.store.entries()) {
      if (now > data.resetTime + RateLimitGuard.cleanupThresholdMs) {
        expiredIps.push(ip);
      }
    }

    for (const ip of expiredIps) {
      RateLimitGuard.store.delete(ip);
    }
  }
}

import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { clientIpOf } from './client-ip';

interface ClientStore {
  count: number;
  resetTime: number;
}

/**
 * In-memory rate limiter for high-risk endpoints (auth, MFA, password reset).
 *
 * FIXED window, not sliding: `resetTime` is stamped once when a bucket is
 * created and the whole bucket resets at that instant. (The header used to say
 * "sliding window", which it never was.)
 *
 * SECURITY NOTE: per-process. In a multi-replica deployment use Redis or
 * another shared store — three replicas behind a load balancer means three
 * times the budget.
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

/**
 * Hard ceiling on distinct buckets held in memory. An attacker who can
 * influence the bucket key (see `getClientIp`) would otherwise grow this map
 * without bound — `performCleanup` alone cannot prevent that, because it runs
 * at most hourly and retains entries for a further 24h.
 */
const MAX_TRACKED_BUCKETS = 50_000;

@Injectable()
export class RateLimitGuard implements CanActivate {
  private static readonly store = new Map<string, ClientStore>();
  private static readonly cleanupIntervalMs = 60 * 60 * 1000; // 1 hour
  private static lastCleanup = Date.now();
  private static readonly cleanupThresholdMs = 24 * 60 * 60 * 1000; // 1 day

  private readonly windowMs: number = 15 * 60 * 1000;
  private readonly maxRequests: number = 5;
  private readonly bucketName: string = 'default';

  constructor(windowMs?: number, maxRequests?: number, bucketName?: string) {
    if (windowMs !== undefined) this.windowMs = windowMs;
    if (maxRequests !== undefined) this.maxRequests = maxRequests;
    if (bucketName !== undefined) this.bucketName = bucketName;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!limiterEnabled()) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = this.getClientIp(request);
    const now = Date.now();

    this.performCleanup(now);

    // Keyed by BUCKET as well as IP.
    //
    // The store is `static` and was previously keyed on the IP alone, while
    // three guards with three DIFFERENT windows shared it (15min/5, 1hr/3,
    // 15min/10). `resetTime` was stamped by whichever guard created the bucket
    // first, so one request to `POST /auth/login` created a 15-minute bucket
    // that the password-reset guard then inherited — turning its declared
    // 3-per-HOUR budget into 3-per-15-minutes, i.e. 12/hour. A 4x bypass of a
    // declared security control, reachable with one extra request. The mirror
    // case penalised real users: an MFA retry burned the login budget.
    //
    // Grouping is preserved where it was actually intended — `signup` and
    // `login` share one guard instance and therefore one bucket, as do
    // `forgot-password` and `reset-password`, so cycling between endpoints in
    // a group does not multiply the budget.
    const key = `${this.bucketName}:${clientIp}`;
    let clientData = RateLimitGuard.store.get(key);

    if (!clientData || now > clientData.resetTime) {
      clientData = {
        count: 0,
        resetTime: now + this.windowMs,
      };
      this.evictIfFull(now);
      RateLimitGuard.store.set(key, clientData);
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
   * The client's address. The resolution itself lives in `common/client-ip.ts` since
   * 2026-11-12, because the declared-act record needs the SAME answer and the only correct
   * implementation was private to this file. The reasoning — why `x-forwarded-for` is only
   * honoured behind a declared trusted proxy, and why the hop is counted from the RIGHT —
   * moved with it, unaltered.
   */
  private getClientIp(request: Request): string {
    return clientIpOf(request);
  }

  /**
   * Drops the oldest buckets when the map hits its ceiling. Called only on
   * insert, so it costs nothing on the hot path of an existing bucket.
   */
  private evictIfFull(now: number): void {
    if (RateLimitGuard.store.size < MAX_TRACKED_BUCKETS) return;

    // Expired entries first — they carry no security value.
    for (const [key, data] of RateLimitGuard.store.entries()) {
      if (now > data.resetTime) RateLimitGuard.store.delete(key);
    }
    if (RateLimitGuard.store.size < MAX_TRACKED_BUCKETS) return;

    // Still full: drop the buckets closest to expiring. Map preserves
    // insertion order, so this also drops the oldest first among equals.
    const sorted = [...RateLimitGuard.store.entries()].sort(
      (a, b) => a[1].resetTime - b[1].resetTime,
    );
    const toDrop = Math.ceil(MAX_TRACKED_BUCKETS / 10);
    for (let i = 0; i < toDrop && i < sorted.length; i++) {
      RateLimitGuard.store.delete(sorted[i][0]);
    }
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

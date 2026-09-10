import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

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
   * `x-forwarded-for` is CLIENT-SUPPLIED and trivially spoofable, so it is
   * honoured ONLY when the deployment declares a trusted reverse proxy sets it
   * — `TRUST_PROXY_HEADERS=true`, the same "the deployment target decides"
   * gate `securityHeaders()` and the secure-cookie flag already use.
   *
   * THE HOP MUST BE COUNTED FROM THE RIGHT. Taking `split(',')[0]` — the
   * LEFTMOST value — was the original bug and it left the vulnerability fully
   * open on the exact deployments the flag exists for. Every standard reverse
   * proxy APPENDS the peer it sees to whatever the client already sent (nginx
   * `$proxy_add_x_forwarded_for`, ALB, Cloudflare), so a request arriving with
   * a forged `x-forwarded-for: 1.2.3.4` reaches the app as
   * `1.2.3.4, <real client ip>` and the leftmost read returns the attacker's
   * own value. Rotating it per request then yields a fresh bucket every time:
   * a complete bypass of the brute-force control on login and password reset.
   *
   * The RIGHTMOST entry is the one contributed by the nearest trusted proxy
   * and cannot be forged by the client. `TRUST_PROXY_HOP_COUNT` handles a
   * chain of more than one trusted proxy: with N trusted hops the client's own
   * address is N from the right.
   */
  private getClientIp(request: Request): string {
    if (process.env.TRUST_PROXY_HEADERS === 'true') {
      const header = request.headers['x-forwarded-for'];
      const raw = Array.isArray(header) ? header.join(',') : header;
      if (typeof raw === 'string') {
        const hops = raw
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean);
        const trusted = trustedProxyHopCount();
        const index = hops.length - trusted;
        if (index >= 0 && index < hops.length) return hops[index];
        // Fewer entries than declared hops: the header is not what this
        // deployment says it should be. Fall through to the socket address
        // rather than trust an attacker-controlled position in the list.
      }
    }
    // `request.ip` can be undefined behind some adapters. Everything in that
    // state shares ONE bucket, which is deliberately restrictive rather than
    // permissive: an unidentifiable client gets the smallest possible budget
    // instead of an unlimited one.
    return request.ip ?? 'unknown';
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

/** How many trusted proxies sit between the client and this process. Only
 * consulted when `TRUST_PROXY_HEADERS=true`. Defaults to 1 (the common single
 * reverse proxy / load balancer). A value below 1 is meaningless and is
 * clamped — reading the 0th-from-right entry would mean trusting whatever the
 * client sent last. */
function trustedProxyHopCount(): number {
  const parsed = Number.parseInt(process.env.TRUST_PROXY_HOP_COUNT ?? '1', 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

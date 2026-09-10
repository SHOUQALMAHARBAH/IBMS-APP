/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HttpException, HttpStatus, ExecutionContext } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';
import type { Request } from 'express';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;

  // The guard no-ops outside production (see limiterEnabled() — a per-IP
  // bucket is meaningless when every request comes from 127.0.0.1, and an
  // enforced one makes the e2e suite unrunnable). These tests are about the
  // limiting behaviour itself, so they opt in explicitly.
  beforeEach(() => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    guard = new RateLimitGuard(60000, 3);
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.TRUST_PROXY_HEADERS;
  });

  it('no-ops entirely when the limiter is not enabled for this environment', () => {
    delete process.env.RATE_LIMIT_ENABLED;
    const g = new RateLimitGuard(60000, 1);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ ip: '198.51.100.7', headers: {} }),
      }),
    } as unknown as ExecutionContext;
    // Well past the limit of 1, and still allowed.
    expect(g.canActivate(ctx)).toBe(true);
    expect(g.canActivate(ctx)).toBe(true);
    expect(g.canActivate(ctx)).toBe(true);
  });

  const mockRequest = (ip: string = '127.0.0.1'): Request =>
    ({
      ip,
      headers: {},
    }) as Request;

  const mockExecutionContext = (ip: string = '127.0.0.1'): ExecutionContext => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => mockRequest(ip),
      }),
    };
    return context as ExecutionContext;
  };

  it('should allow requests within rate limit', () => {
    const context = mockExecutionContext('192.168.1.100');
    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should reject requests exceeding rate limit', () => {
    const context = mockExecutionContext('192.168.1.101');
    guard.canActivate(context);
    guard.canActivate(context);
    guard.canActivate(context);

    let threwCorrectly = false;
    try {
      guard.canActivate(context);
    } catch (error) {
      if (error instanceof HttpException) {
        threwCorrectly = true;
      }
    }
    expect(threwCorrectly).toBe(true);
  });

  it('should track different IPs separately', () => {
    const context1 = mockExecutionContext('192.168.1.102');
    const context2 = mockExecutionContext('192.168.1.103');

    // IP 1 maxes out
    guard.canActivate(context1);
    guard.canActivate(context1);
    guard.canActivate(context1);

    // IP 2 should still be allowed
    expect(guard.canActivate(context2)).toBe(true);
  });

  it('IGNORES x-forwarded-for unless the deployment opted into trusting a proxy', () => {
    // Spoofing the header must NOT mint a fresh bucket, or the limiter is
    // bypassable by anyone who can set a header.
    delete process.env.TRUST_PROXY_HEADERS;
    const ctx = (forwarded: string): ExecutionContext =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            ip: '203.0.113.9',
            headers: { 'x-forwarded-for': forwarded },
          }),
        }),
      }) as unknown as ExecutionContext;

    const g = new RateLimitGuard(60000, 2);
    expect(g.canActivate(ctx('10.1.1.1'))).toBe(true);
    expect(g.canActivate(ctx('10.2.2.2'))).toBe(true);
    // Third request from the same real socket, third spoofed header — still
    // the same bucket, so it is refused.
    expect(() => g.canActivate(ctx('10.3.3.3'))).toThrow(HttpException);
  });

  it('takes the RIGHTMOST x-forwarded-for hop, so a spoofed prefix cannot mint a fresh bucket', () => {
    // THE bypass this guard exists to prevent. Every standard reverse proxy
    // APPENDS the peer it sees, so a request forged with
    // `x-forwarded-for: 1.2.3.4` arrives as `1.2.3.4, <real client>`. Reading
    // the LEFTMOST value (the original implementation) returns the attacker's
    // own string — rotate it per request and the limiter never fires.
    process.env.TRUST_PROXY_HEADERS = 'true';
    const attacker = '198.51.100.200'; // the real peer the proxy appends

    const spoof = (forged: string): ExecutionContext => {
      const req = mockRequest('10.9.9.9') as any;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      req.headers['x-forwarded-for'] = `${forged}, ${attacker}`;
      return {
        switchToHttp: () => ({ getRequest: () => req }),
      } as ExecutionContext;
    };

    // Four requests, each with a DIFFERENT forged prefix. Limit is 3.
    guard.canActivate(spoof('1.1.1.1'));
    guard.canActivate(spoof('2.2.2.2'));
    guard.canActivate(spoof('3.3.3.3'));

    let threwCorrectly = false;
    try {
      guard.canActivate(spoof('4.4.4.4'));
    } catch (error) {
      if (error instanceof HttpException) threwCorrectly = true;
    }
    // All four resolved to the same real peer, so the fourth is refused.
    expect(threwCorrectly).toBe(true);
  });

  it('honours TRUST_PROXY_HOP_COUNT for a chain of trusted proxies', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';
    process.env.TRUST_PROXY_HOP_COUNT = '2';
    const client = '203.0.113.50';

    const ctx = (forged: string): ExecutionContext => {
      const req = mockRequest('10.9.9.9') as any;
      // Two trusted hops: [forged...], realClient, innerProxy
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      req.headers['x-forwarded-for'] = `${forged}, ${client}, 10.0.0.1`;
      return {
        switchToHttp: () => ({ getRequest: () => req }),
      } as ExecutionContext;
    };

    guard.canActivate(ctx('1.1.1.1'));
    guard.canActivate(ctx('2.2.2.2'));
    guard.canActivate(ctx('3.3.3.3'));

    let threwCorrectly = false;
    try {
      guard.canActivate(ctx('4.4.4.4'));
    } catch (error) {
      if (error instanceof HttpException) threwCorrectly = true;
    }
    expect(threwCorrectly).toBe(true);
    delete process.env.TRUST_PROXY_HOP_COUNT;
  });

  it('keeps each named bucket on its OWN window', () => {
    // The 4x bypass: three guards shared one store keyed on IP alone, so
    // `resetTime` was stamped by whichever ran first. One request to the
    // 15-minute auth limiter handed the 1-hour password-reset limiter a
    // 15-minute window — 3 attempts every 15 minutes instead of every hour.
    const shortWindow = new RateLimitGuard(1000, 3, 'short');
    const longWindow = new RateLimitGuard(3_600_000, 2, 'long');
    const context = mockExecutionContext('192.168.77.1');

    shortWindow.canActivate(context);
    longWindow.canActivate(context);
    longWindow.canActivate(context);

    // The long bucket is at its own limit of 2 and must refuse, regardless of
    // the short bucket's separate, shorter window.
    let threwCorrectly = false;
    try {
      longWindow.canActivate(context);
    } catch (error) {
      if (error instanceof HttpException) threwCorrectly = true;
    }
    expect(threwCorrectly).toBe(true);

    // ...and the short bucket still has its own budget left.
    expect(shortWindow.canActivate(context)).toBe(true);
  });

  it('should throw HttpException with correct status code', () => {
    const context = mockExecutionContext('192.168.1.104');
    guard.canActivate(context);
    guard.canActivate(context);
    guard.canActivate(context);

    let statusCode = -1;
    try {
      guard.canActivate(context);
    } catch (error) {
      if (error instanceof HttpException) {
        statusCode = error.getStatus();
      }
    }
    expect(statusCode).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('should include retry-after in error response', () => {
    const context = mockExecutionContext('192.168.1.105');
    guard.canActivate(context);
    guard.canActivate(context);
    guard.canActivate(context);

    let hasRetryAfter = false;
    try {
      guard.canActivate(context);
    } catch (error) {
      if (error instanceof HttpException) {
        const response = error.getResponse() as any;
        hasRetryAfter = response && 'retryAfter' in response;
      }
    }
    expect(hasRetryAfter).toBe(true);
  });

  it('shares one store across guard instances with the SAME bucket name', () => {
    // Two routes carrying the same decorator share a budget — that is where
    // "cycling endpoints must not multiply the budget" actually comes from
    // (signup + login are one bucket; forgot-password + reset-password
    // another). Guards with DIFFERENT bucket names do not share, which is the
    // separate test above.
    const guard2 = new RateLimitGuard(60000, 3);
    const context = mockExecutionContext('192.168.1.106');

    guard.canActivate(context);
    guard.canActivate(context);
    guard.canActivate(context);

    let threwCorrectly = false;
    try {
      guard2.canActivate(context);
    } catch (error) {
      if (error instanceof HttpException) {
        threwCorrectly = true;
      }
    }
    expect(threwCorrectly).toBe(true);
  });
});

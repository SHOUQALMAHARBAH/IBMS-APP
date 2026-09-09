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

  it('should extract first IP from x-forwarded-for header', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';
    const req1 = mockRequest() as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    req1.headers['x-forwarded-for'] = '10.0.0.1, 10.0.0.2';

    const req2 = mockRequest() as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    req2.headers['x-forwarded-for'] = '10.0.0.1, 10.0.0.3';

    const context1 = {
      switchToHttp: () => ({ getRequest: () => req1 }),
    } as ExecutionContext;

    const context2 = {
      switchToHttp: () => ({ getRequest: () => req2 }),
    } as ExecutionContext;

    guard.canActivate(context1);
    guard.canActivate(context1);
    guard.canActivate(context1);

    // Same first IP in forwarded-for should hit rate limit
    let threwCorrectly = false;
    try {
      guard.canActivate(context2);
    } catch (error) {
      if (error instanceof HttpException) {
        threwCorrectly = true;
      }
    }
    expect(threwCorrectly).toBe(true);
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

  it('should use singleton store shared across all guard instances', () => {
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

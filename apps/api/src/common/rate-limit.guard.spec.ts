import { describe, it, expect, beforeEach } from 'vitest';
import { HttpException, HttpStatus, ExecutionContext } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';
import type { Request } from 'express';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;

  beforeEach(() => {
    guard = new RateLimitGuard(60000, 3);
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

  it('should extract first IP from x-forwarded-for header', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const req1 = mockRequest() as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    req1.headers['x-forwarded-for'] = '10.0.0.1, 10.0.0.2';

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus, ExecutionContext } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';
import type { Request } from 'express';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;

  beforeEach(() => {
    guard = new RateLimitGuard({ windowMs: 60000, maxRequests: 3 });
  });

  const mockRequest = (ip: string = '127.0.0.1'): Request => ({
    ip,
    headers: {},
  } as Request);

  const mockExecutionContext = (ip: string = '127.0.0.1'): ExecutionContext => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => mockRequest(ip),
      }),
    };
    return context as ExecutionContext;
  };

  it('should allow requests within rate limit', () => {
    const context = mockExecutionContext();
    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should reject requests exceeding rate limit', () => {
    const context = mockExecutionContext();
    guard.canActivate(context);
    guard.canActivate(context);
    guard.canActivate(context);

    expect(() => guard.canActivate(context)).toThrow(HttpException);
  });

  it('should track different IPs separately', () => {
    const context1 = mockExecutionContext('192.168.1.1');
    const context2 = mockExecutionContext('192.168.1.2');

    // IP 1 maxes out
    guard.canActivate(context1);
    guard.canActivate(context1);
    guard.canActivate(context1);

    // IP 2 should still be allowed
    expect(guard.canActivate(context2)).toBe(true);
  });

  it('should extract first IP from x-forwarded-for header', () => {
    const req1 = mockRequest() as any;
    req1.headers['x-forwarded-for'] = '10.0.0.1, 10.0.0.2';

    const req2 = mockRequest() as any;
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
    expect(() => guard.canActivate(context2)).toThrow(HttpException);
  });

  it('should throw HttpException with correct status code', () => {
    const context = mockExecutionContext();
    guard.canActivate(context);
    guard.canActivate(context);
    guard.canActivate(context);

    try {
      guard.canActivate(context);
      fail('Should have thrown HttpException');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('should include retry-after in error response', () => {
    const context = mockExecutionContext();
    guard.canActivate(context);
    guard.canActivate(context);
    guard.canActivate(context);

    try {
      guard.canActivate(context);
    } catch (error) {
      const response = error.getResponse() as any;
      expect(response).toHaveProperty('retryAfter');
      expect(typeof response.retryAfter).toBe('number');
      expect(response.retryAfter).toBeGreaterThan(0);
    }
  });
});

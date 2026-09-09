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
 */
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

  private getClientIp(request: Request): string {
    const forwardedFor = request.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string') {
      return forwardedFor.split(',')[0].trim();
    }
    if (Array.isArray(forwardedFor)) {
      return forwardedFor[0].split(',')[0].trim();
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

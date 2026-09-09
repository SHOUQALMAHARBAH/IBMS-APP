import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface ClientStore {
  count: number;
  resetTime: number;
}

/**
 * Simple in-memory rate limiter for high-risk endpoints (auth, password reset).
 * Tracks requests per IP address within a sliding window.
 * For production with multiple replicas, consider redis-based rate limiting.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private store = new Map<string, ClientStore>();
  private readonly windowMs: number = 15 * 60 * 1000; // 15 minutes
  private readonly maxRequests: number = 5;

  constructor(config?: RateLimitConfig) {
    if (config) {
      this.windowMs = config.windowMs;
      this.maxRequests = config.maxRequests;
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = this.getClientIp(request);
    const now = Date.now();

    let clientData = this.store.get(clientIp);

    if (!clientData || now > clientData.resetTime) {
      clientData = {
        count: 0,
        resetTime: now + this.windowMs,
      };
      this.store.set(clientIp, clientData);
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
}

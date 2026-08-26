import type { NextFunction, Request, Response } from 'express';

/**
 * Part 10.2 — mandatory TLS on all client-server traffic. This app never
 * terminates TLS itself (a reverse proxy/load balancer does, ahead of
 * whichever deployment platform is eventually chosen — see README §
 * Deployment); this middleware is the app-side half of that requirement:
 * it (1) tells browsers to never downgrade to plain HTTP (HSTS) and (2)
 * refuses to process a request that reached it over plain HTTP, so a
 * misconfigured proxy in front of it fails loudly instead of silently
 * serving Confidential/Highly Confidential data over an unencrypted hop.
 *
 * No-ops outside production (NODE_ENV=production) — local dev and CI have
 * no TLS termination in front of them, same gate used for the secure-cookie
 * flag (auth/cookies.util.ts) and ENABLE_DEV_RESET_TOKEN.
 *
 * `/health` and `/health/db` are exempt from the plain-HTTP rejection (still
 * get the security headers): container/orchestrator health probes
 * (docker-compose's `healthcheck:`, a future k8s liveness/readiness probe)
 * hit the app directly over the internal network, not through the
 * TLS-terminating reverse proxy — enforcing TLS on that internal hop too
 * would require the orchestrator's probe itself to speak TLS, which is not
 * how `wget`-style healthchecks work. Client-facing routes get no such
 * exemption.
 */
const TLS_EXEMPT_PATHS = new Set(['/health', '/health/db']);

export function securityHeaders() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (process.env.NODE_ENV !== 'production') {
      next();
      return;
    }
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (TLS_EXEMPT_PATHS.has(req.path)) {
      next();
      return;
    }
    const forwardedProto = req.headers['x-forwarded-proto'];
    const proto = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : (forwardedProto ?? (req.secure ? 'https' : 'http'));
    if (proto !== 'https') {
      res.status(403).json({
        statusCode: 403,
        message: 'TLS is mandatory — request did not arrive over HTTPS',
      });
      return;
    }
    next();
  };
}

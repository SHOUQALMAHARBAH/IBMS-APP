import type { CookieOptions, Response } from 'express';

export const REFRESH_TOKEN_COOKIE = 'ibms_refresh_token';

// Path-scoped to /auth so the cookie is never sent on ordinary API calls —
// only the handful of routes that actually need it (refresh, logout).
const baseOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  path: '/auth',
};

export function setRefreshTokenCookie(
  res: Response,
  token: string,
  expiresAt: Date,
): void {
  // CodeQL (js/clear-text-storage-of-sensitive-data, alert #1) flags this as
  // clear-text storage of a sensitive value. Reviewed and dismissed as a
  // false positive for this specific pattern: `token` is the raw half of
  // TokenService.issueOpaqueSecret() — the server only ever persists its
  // SHA-256 hash (crypto.util.ts hashToken()), never the raw value, so a
  // database leak can't yield a usable token. The raw value's one intended
  // home is exactly here: an httpOnly (unreadable by page JS, so immune to
  // XSS exfiltration) + secure-in-production (TLS-only) + sameSite=strict +
  // /auth-path-scoped cookie. That's the standard, recommended storage
  // mechanism for an opaque bearer refresh token, not an accidental
  // plaintext leak — encrypting the cookie value itself would just mean the
  // client holds a decrypt-to-the-same-usable-secret blob, protecting only
  // against an attacker with local disk/cookie-jar access, a threat model
  // this cookie's other flags already assume out of scope.
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    ...baseOptions,
    expires: expiresAt,
  });
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, baseOptions);
}

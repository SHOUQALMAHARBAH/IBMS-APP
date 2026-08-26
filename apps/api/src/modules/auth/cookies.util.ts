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
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    ...baseOptions,
    expires: expiresAt,
  });
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, baseOptions);
}

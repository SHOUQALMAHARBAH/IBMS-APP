import { apiGet, apiPatch, apiPost, apiPut, setAccessToken } from './api-client';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  mfaEnabled: boolean;
  mfaPolicySatisfied: boolean;
}

export interface IssuedSessionResponse {
  accessToken: string;
  user: AuthUser;
}

export interface MfaChallengeResponse {
  mfaRequired: true;
  mfaChallengeToken: string;
}

/**
 * Part II §4.3.1 — the account still owes its mandatory first password change.
 *
 * Deliberately NOT a session: the admin who provisioned the account knows the
 * temporary password, so nothing may happen on it until that is rotated. The
 * onboarding token is the only thing this outcome carries, and
 * `POST /auth/password/force-change` is the only thing it opens.
 *
 * This member was missing until now, and the omission was not cosmetic: every
 * account created through `POST /admin/users` gets `mustChangePassword: true`
 * (the schema default, and what `UserRepository.provision` writes), so the
 * login page saw an outcome it had no branch for, pushed to `/` with no token,
 * and was bounced straight back to `/login` with no message. Provisioned
 * employees — which is every real employee, since signup grants no roles —
 * could not complete a first login at all.
 */
export interface MustChangePasswordResponse {
  outcome: 'MUST_CHANGE_PASSWORD';
  onboardingToken: string;
}

export type LoginResponse =
  | IssuedSessionResponse
  | MfaChallengeResponse
  | MustChangePasswordResponse;

export interface MeResponse {
  id: string;
  email: string;
  fullName: string;
  languagePreference: 'AR' | 'EN';
  roles: string[];
  /** Part IV §10.4 — the caller's RESOLVED permission codes, sorted, straight
   * from the same grid the API enforces with. Every conditional render in the
   * app reads this (via `hasPermission`); nothing branches on `roles`, which
   * would be a second, drifting copy of the role-to-permission mapping. */
  permissions: string[];
  mfaEnabled: boolean;
  mfaPolicySatisfied: boolean;
  accessValidUntil: string | null;
  /** The Department this user sits in, or null — signup grants none, only
   *  admin provisioning does. Both spellings, because `nameAr` is nullable
   *  and the caller is the one that knows which language it is rendering. */
  department: { name: string; nameAr: string | null } | null;
  idleTimeoutMinutes: number;
  hardLogoutAfterIdleMinutes: number;
  stepUpFresh: boolean;
  /**
   * Part 4 — whether this office has declared that one person may perform both halves of a maker/checker
   * pair. Optional on the type rather than required, because ~80 spec files build a `MeResponse` mock and a
   * required field would make every one of them fail to compile for a value none of them are about. Every
   * reader defaults to SEGREGATED, which is what a caller that does not know must assume.
   */
  dutySegregationMode?: 'SEGREGATED' | 'COMBINED';
}

export interface MfaEnrollResponse {
  credentialId: string;
  otpAuthUri: string;
  qrCodeDataUrl: string;
}

function isIssuedSession(res: LoginResponse): res is IssuedSessionResponse {
  return 'accessToken' in res;
}

export function isMustChangePassword(
  res: LoginResponse,
): res is MustChangePasswordResponse {
  return 'outcome' in res && res.outcome === 'MUST_CHANGE_PASSWORD';
}

export async function signup(input: { fullName: string; email: string; password: string }): Promise<void> {
  await apiPost<{ id: string; email: string }>('/auth/signup', input);
}

export async function login(input: { email: string; password: string }): Promise<LoginResponse> {
  const res = await apiPost<LoginResponse>('/auth/login', input, { skipAuthRetry: true });
  if (isIssuedSession(res)) setAccessToken(res.accessToken);
  return res;
}

export async function verifyMfaChallenge(input: { mfaChallengeToken: string; code: string }): Promise<AuthUser> {
  const res = await apiPost<IssuedSessionResponse>('/auth/mfa/totp/challenge/verify', input, {
    skipAuthRetry: true,
  });
  setAccessToken(res.accessToken);
  return res.user;
}

export async function logout(): Promise<void> {
  try {
    await apiPost('/auth/logout');
  } finally {
    setAccessToken(null);
  }
}

/**
 * Part II §4.3.1 — consumes the onboarding token from a MUST_CHANGE_PASSWORD
 * login and issues the real session, so the caller lands in the app exactly as
 * a normal login would leave them.
 *
 * `skipAuthRetry` because there is no session to refresh yet: a 401 here means
 * the token is wrong, not that an access token expired.
 */
export async function forceChangePassword(input: {
  onboardingToken: string;
  newPassword: string;
}): Promise<AuthUser> {
  const res = await apiPost<IssuedSessionResponse>('/auth/password/force-change', input, {
    skipAuthRetry: true,
  });
  setAccessToken(res.accessToken);
  return res.user;
}

/**
 * Part II §4.7 — self-service change on a live session. The API revokes every
 * OTHER session and every trusted device, and returns how many sessions went,
 * which is worth telling the user: it is how they would notice someone else
 * had been signed in as them.
 */
export function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ otherSessionsRevoked: number }> {
  return apiPost('/auth/password/change', input);
}

/** Part II §4.4 — a device this account has chosen to trust, so it skips the
 *  second factor until the trust lapses. The fingerprint and first-seen IP
 *  never leave the server: a stable device identifier in a response the
 *  browser can read is a movement log, which is the same reason the audit
 *  trail refuses to store one. */
export interface TrustedDevice {
  id: string;
  label: string | null;
  trustedAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

export function listTrustedDevices(): Promise<TrustedDevice[]> {
  return apiGet('/auth/trusted-devices');
}

/** Revoking forces the MFA prompt again on that device. A user can only
 *  revoke their own — the API answers 404, not 403, for anyone else's. */
export function revokeTrustedDevice(id: string): Promise<void> {
  return apiPost(`/auth/trusted-devices/${encodeURIComponent(id)}/revoke`, {});
}

export function forgotPassword(email: string): Promise<{ message: string; devResetToken?: string }> {
  return apiPost('/auth/forgot-password', { email }, { skipAuthRetry: true });
}

export function resetPassword(input: { token: string; newPassword: string }): Promise<void> {
  return apiPost('/auth/reset-password', input, { skipAuthRetry: true });
}

export function me(): Promise<MeResponse> {
  return apiGet('/auth/me');
}

export function updateLanguagePreference(
  languagePreference: 'AR' | 'EN',
): Promise<MeResponse> {
  return apiPatch('/auth/me/language', { languagePreference });
}

export function heartbeat(): Promise<{ ok: true }> {
  return apiPost('/auth/session/heartbeat');
}

export function stepUp(input: { password: string; code?: string }): Promise<void> {
  return apiPost('/auth/step-up', input);
}

export function enrollTotp(): Promise<MfaEnrollResponse> {
  return apiPost('/auth/mfa/totp/enroll');
}

export function verifyTotpEnrollment(input: { credentialId: string; code: string }): Promise<void> {
  return apiPost('/auth/mfa/totp/enroll/verify', input);
}

export function disableTotp(input: { password: string; code: string }): Promise<void> {
  return apiPost('/auth/mfa/totp/disable', input);
}

export interface SecurityConfig {
  idleTimeoutMinutes: number;
  hardLogoutAfterIdleMinutes: number;
  accessTokenTtlMinutes: number;
  refreshTokenTtlDays: number;
  stepUpMaxAgeMinutes: number;
  maxFailedLoginAttempts: number;
  lockoutMinutes: number;
}

export function getSecurityConfig(): Promise<SecurityConfig> {
  return apiGet('/auth/security-config');
}

export function updateSecurityConfig(patch: Partial<SecurityConfig>): Promise<SecurityConfig> {
  return apiPut('/auth/security-config', patch);
}

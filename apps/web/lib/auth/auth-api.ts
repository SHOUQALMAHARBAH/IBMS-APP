import { apiGet, apiPost, apiPut, setAccessToken } from './api-client';

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

export type LoginResponse = IssuedSessionResponse | MfaChallengeResponse;

export interface MeResponse {
  id: string;
  email: string;
  fullName: string;
  languagePreference: 'AR' | 'EN';
  roles: string[];
  mfaEnabled: boolean;
  mfaPolicySatisfied: boolean;
  accessValidUntil: string | null;
  idleTimeoutMinutes: number;
  hardLogoutAfterIdleMinutes: number;
  stepUpFresh: boolean;
}

export interface MfaEnrollResponse {
  credentialId: string;
  otpAuthUri: string;
  qrCodeDataUrl: string;
}

function isIssuedSession(res: LoginResponse): res is IssuedSessionResponse {
  return 'accessToken' in res;
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

export function forgotPassword(email: string): Promise<{ message: string; devResetToken?: string }> {
  return apiPost('/auth/forgot-password', { email }, { skipAuthRetry: true });
}

export function resetPassword(input: { token: string; newPassword: string }): Promise<void> {
  return apiPost('/auth/reset-password', input, { skipAuthRetry: true });
}

export function me(): Promise<MeResponse> {
  return apiGet('/auth/me');
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

/*
 * The office's own corporate mailbox — the six `/admin/email-integration` routes, none of which had
 * a web caller. `email.integration.read` and `email.integration.manage` were both granted and
 * neither could be exercised.
 *
 * ## No route here ever returns the credential, and nothing here should ask for one
 *
 * The API is explicit: the refresh token is never returned, encrypted or otherwise. `status` gives
 * the address, the provider and the health, and that is all an administrator needs. A field on this
 * client for a token would be a field somebody fills in.
 *
 * ## `state` is a security control the SCREEN has to implement
 *
 * `authorize-url` returns a `state` alongside the URL, and the service says why in its own words:
 * "an authorization code accepted without checking it can be replayed from another site (CSRF
 * against the connect flow)". The API cannot check it — it never sees the redirect — so the caller
 * stores it and compares it on the way back. That comparison is this feature's only real security
 * obligation on the client side.
 */

import { apiGet, apiPost } from '../auth/api-client';

export type EmailProviderKind = 'MICROSOFT365' | 'GOOGLE_WORKSPACE';

export type EmailSendOutcome =
  | 'SENT'
  | 'NOT_CONFIGURED'
  | 'CREDENTIAL_REJECTED'
  | 'SEND_FAILED';

/** `GET /admin/email-integration`. Every field null when no mailbox is connected. */
export interface EmailIntegrationStatus {
  connected: boolean;
  provider: EmailProviderKind | null;
  connectedEmail: string | null;
  status: string | null;
  connectedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  /** The provider's own complaint, already sanitised server-side — never a token. */
  lastError: string | null;
}

/** `POST /admin/email-integration/verify` — checks the stored credential, sends nothing. */
export interface EmailProviderHealth {
  kind: EmailProviderKind | 'not_configured';
  /** Whether this office can actually send right now. */
  operational: boolean;
  fromAddress: string | null;
  detail: string;
}

/** `POST /admin/email-integration/test` — sends a real message, to the office's own mailbox. */
export interface EmailSendResult {
  outcome: EmailSendOutcome;
  fromAddress?: string;
  providerMessageId?: string;
  detail?: string;
}

export function getEmailIntegration(): Promise<EmailIntegrationStatus> {
  return apiGet('/admin/email-integration');
}

export function emailAuthorizeUrl(
  provider: EmailProviderKind,
): Promise<{ url: string; state: string }> {
  return apiGet(
    `/admin/email-integration/authorize-url?provider=${encodeURIComponent(provider)}`,
  );
}

export function connectEmailIntegration(input: {
  provider: EmailProviderKind;
  authorizationCode: string;
  connectedEmail: string;
  providerTenantId?: string;
}): Promise<EmailIntegrationStatus> {
  return apiPost('/admin/email-integration/connect', input);
}

export function verifyEmailIntegration(): Promise<EmailProviderHealth> {
  return apiPost('/admin/email-integration/verify', {});
}

export function sendEmailIntegrationTest(): Promise<EmailSendResult> {
  return apiPost('/admin/email-integration/test', {});
}

export function revokeEmailIntegration(): Promise<EmailIntegrationStatus> {
  return apiPost('/admin/email-integration/revoke', {});
}

/**
 * Pull `code` and `state` out of the address the provider redirected to.
 *
 * The administrator pastes the WHOLE redirect address rather than two fields, and that is a
 * correctness choice as much as a kindness: `state` must be compared, and a two-field form is one
 * where somebody pastes the code and leaves the state blank — at which point the screen either
 * refuses a legitimate connection or, worse, skips the check.
 *
 * Returns nulls rather than throwing, so the screen can say which part is missing.
 */
export function parseOAuthRedirect(pasted: string): {
  code: string | null;
  state: string | null;
} {
  const trimmed = pasted.trim();
  if (trimmed === '') return { code: null, state: null };
  try {
    // A full URL when they pasted one; the query alone when they pasted only that.
    const query = trimmed.includes('?')
      ? trimmed.slice(trimmed.indexOf('?') + 1)
      : trimmed;
    const params = new URLSearchParams(query);
    return {
      code: params.get('code'),
      state: params.get('state'),
    };
  } catch {
    return { code: null, state: null };
  }
}

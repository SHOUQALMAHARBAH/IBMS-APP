/**
 * Part I §6 — the OAuth application credentials, read once from the
 * environment.
 *
 * These are the PLATFORM's registered application with Microsoft and Google,
 * not an office's mailbox. The per-office half — which mailbox, and the refresh
 * token that proves consent — lives on `OrganizationEmailIntegration`, one row
 * per Organization, with the token encrypted.
 *
 * A client secret is never logged, never returned by an API, and never written
 * to the database.
 */
export interface EmailOAuthAppConfig {
  clientId: string;
  clientSecret: string;
  /** Where the provider sends the authorization code back to. Must match the
   * value registered with the provider exactly, or consent fails with a
   * redirect_uri_mismatch that is easy to misread as a credential problem. */
  redirectUri: string;
}

export interface EmailConfig {
  microsoft365: EmailOAuthAppConfig | null;
  googleWorkspace: EmailOAuthAppConfig | null;
  /** Absolute base URL of this deployment, used to build the deep links that
   * go in a message body instead of the sensitive payload itself. */
  appBaseUrl: string;
  timeoutMs: number;
  maxRetries: number;
}

/** Microsoft Graph needs mail-send permission and offline access for a refresh
 * token; `openid`/`email` identify which mailbox consented. */
export const MICROSOFT_SCOPES = [
  'offline_access',
  'openid',
  'email',
  'https://graph.microsoft.com/Mail.Send',
];

/** Gmail's send-only scope. Deliberately NOT a full-mailbox scope — this
 * integration sends, it never reads the office's mail. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'openid',
  'email',
];

function appConfig(
  clientId: string | undefined,
  clientSecret: string | undefined,
  redirectUri: string | undefined,
): EmailOAuthAppConfig | null {
  // All three or nothing: a half-configured OAuth app fails at consent time
  // with an opaque provider error rather than here, where the cause is legible.
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function loadEmailConfig(
  env: NodeJS.ProcessEnv = process.env,
): EmailConfig {
  return {
    microsoft365: appConfig(
      env.EMAIL_MS_CLIENT_ID,
      env.EMAIL_MS_CLIENT_SECRET,
      env.EMAIL_MS_REDIRECT_URI,
    ),
    googleWorkspace: appConfig(
      env.EMAIL_GOOGLE_CLIENT_ID,
      env.EMAIL_GOOGLE_CLIENT_SECRET,
      env.EMAIL_GOOGLE_REDIRECT_URI,
    ),
    appBaseUrl: env.APP_BASE_URL ?? 'http://localhost:3000',
    timeoutMs: positiveInt(env.EMAIL_TIMEOUT_MS, 15_000),
    maxRetries: positiveInt(env.EMAIL_MAX_RETRIES, 2),
  };
}

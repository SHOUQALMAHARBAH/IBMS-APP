import { Logger } from '@nestjs/common';
import type { EmailConfig, EmailOAuthAppConfig } from './email-provider.config';

/**
 * A refreshed access token and the moment it stops being usable.
 *
 * Cached in memory per provider instance: an access token is good for roughly
 * an hour, and exchanging the refresh token on every single message would both
 * slow every send and rate-limit the office's mailbox for no benefit.
 */
interface CachedAccessToken {
  token: string;
  expiresAtMs: number;
}

export class CredentialRejectedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'CredentialRejectedError';
  }
}

/**
 * Shared HTTP behaviour for the two real mailbox providers: timeout, bounded
 * retry with jittered backoff, and OAuth refresh-token exchange with caching.
 *
 * Mirrors `BaseScreeningProvider`'s reliability shape deliberately — same
 * house rules, same retry policy — but is a separate class because the two
 * share no domain types and coupling them would make each harder to change.
 *
 * ## What is never logged here
 *
 * Not the refresh token, not the access token, not a response body. A provider
 * error is reported by STATUS and a short reason. Response bodies from a mail
 * API routinely echo the recipient list and the subject, and the subject of a
 * notification about a specific customer is itself information about that
 * customer.
 */
export abstract class BaseEmailProvider {
  protected readonly logger: Logger;
  private accessToken: CachedAccessToken | null = null;

  /** Refresh slightly early: a token that expires mid-flight surfaces as an
   * unexplained 401 on an otherwise valid send. */
  private static readonly EXPIRY_SKEW_MS = 60_000;

  protected constructor(
    protected readonly config: EmailConfig,
    protected readonly app: EmailOAuthAppConfig,
    protected readonly refreshToken: string,
    name: string,
  ) {
    this.logger = new Logger(name);
  }

  /** The provider's token endpoint. */
  protected abstract tokenUrl(): string;

  /** Extra form fields the provider's token endpoint requires. */
  protected abstract tokenRequestExtras(): Record<string, string>;

  /**
   * A usable access token, refreshed if the cached one is gone or near expiry.
   *
   * A 4xx from the token endpoint means the stored refresh token is no longer
   * good — the office withdrew consent, the mailbox was deleted, or an
   * administrator revoked it at the provider. That is a distinct outcome from
   * "the send failed", because it needs a human to reconnect the mailbox rather
   * than a retry.
   */
  protected async getAccessToken(correlationId: string): Promise<string> {
    const now = Date.now();
    if (
      this.accessToken &&
      this.accessToken.expiresAtMs - BaseEmailProvider.EXPIRY_SKEW_MS > now
    ) {
      return this.accessToken.token;
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      client_id: this.app.clientId,
      client_secret: this.app.clientSecret,
      ...this.tokenRequestExtras(),
    });

    const response = await this.fetchWithRetry(
      this.tokenUrl(),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
      correlationId,
    );

    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!payload.access_token) {
      throw new CredentialRejectedError(
        'the provider returned no access token for this refresh token',
      );
    }
    this.accessToken = {
      token: payload.access_token,
      expiresAtMs: Date.now() + (payload.expires_in ?? 3600) * 1000,
    };
    return this.accessToken.token;
  }

  /**
   * One HTTP call with a timeout and bounded retry.
   *
   * Retries a timeout, a transport error, a 5xx or a 429. A 4xx is a request or
   * credential problem that will fail identically every time, so it is raised
   * at once — and a 401/403 is raised as `CredentialRejectedError`, because
   * "reconnect the mailbox" and "try again later" are different instructions.
   */
  protected async fetchWithRetry(
    url: string,
    init: RequestInit,
    correlationId: string,
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
          headers: {
            ...(init.headers ?? {}),
            'X-Correlation-Id': correlationId,
          },
        });
        if (response.ok) return response;

        if (response.status === 401 || response.status === 403) {
          throw new CredentialRejectedError(
            `the provider rejected the stored credential (HTTP ${response.status})`,
          );
        }
        if (response.status < 500 && response.status !== 429) {
          throw new Error(`HTTP ${response.status}`);
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (err) {
        if (err instanceof CredentialRejectedError) throw err;
        lastError =
          (err as Error).name === 'AbortError'
            ? new Error(`timed out after ${this.config.timeoutMs}ms`)
            : (err as Error);
        if (/^HTTP [4]\d\d$/.test(lastError.message)) break;
      } finally {
        clearTimeout(timer);
      }

      if (attempt < this.config.maxRetries) {
        // Jittered backoff — workers retrying in lockstep are a self-inflicted
        // denial of service against the office's own mailbox.
        const backoff = 2 ** attempt * 250 + Math.floor(Math.random() * 250);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }

    throw lastError ?? new Error('email request failed');
  }

  /** RFC 5322 message for providers that want a raw MIME blob rather than a
   * structured body. Plain text and UTF-8 — the platform's primary language is
   * Arabic, so a 7-bit assumption would mangle most real subjects. */
  protected buildMimeMessage(
    from: string,
    to: string[],
    subject: string,
    bodyText: string,
  ): string {
    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
    return [
      `From: ${from}`,
      `To: ${to.join(', ')}`,
      `Subject: ${encodedSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(bodyText, 'utf8').toString('base64'),
    ].join('\r\n');
  }
}

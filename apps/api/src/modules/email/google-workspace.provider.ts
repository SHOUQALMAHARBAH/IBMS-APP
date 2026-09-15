import type { EmailProviderKind } from '@ibms/db';
import {
  BaseEmailProvider,
  CredentialRejectedError,
} from './base-email-provider';
import type { EmailConfig, EmailOAuthAppConfig } from './email-provider.config';
import type {
  EmailProvider,
  EmailProviderHealth,
  EmailSendResult,
  OutboundMessage,
} from './email-provider.types';

/**
 * Google Workspace mailbox adapter (Gmail API).
 *
 * ## Read this before assuming it has been proven
 *
 * Same standing as the Microsoft adapter: written against Google's published
 * Gmail API documentation, **never run against a real Google Workspace
 * domain**, because no office has connected a mailbox yet and a live OAuth
 * consent cannot be faked. HTTP behaviour, token caching, error classification
 * and MIME construction are unit-tested against a stubbed `fetch`; whether
 * Google accepts these exact payloads in practice is not.
 *
 * ## Scope
 *
 * `gmail.send` only — this integration sends, it never reads the office's mail.
 * A broader scope would be easier to obtain consent for once and harder to
 * justify to the office whose mailbox it is.
 */
export class GoogleWorkspaceEmailProvider
  extends BaseEmailProvider
  implements EmailProvider
{
  readonly kind: EmailProviderKind = 'GOOGLE_WORKSPACE';

  constructor(
    config: EmailConfig,
    app: EmailOAuthAppConfig,
    refreshToken: string,
    readonly fromAddress: string,
  ) {
    super(config, app, refreshToken, 'GoogleWorkspaceEmailProvider');
  }

  protected tokenUrl(): string {
    return 'https://oauth2.googleapis.com/token';
  }

  protected tokenRequestExtras(): Record<string, string> {
    // Google's refresh-token grant takes no extra fields.
    return {};
  }

  async send(
    message: OutboundMessage,
    correlationId: string,
  ): Promise<EmailSendResult> {
    try {
      const accessToken = await this.getAccessToken(correlationId);
      const mime = this.buildMimeMessage(
        this.fromAddress,
        message.to,
        message.subject,
        message.bodyText,
      );
      // Gmail wants base64url, not plain base64: '+' and '/' are rejected.
      const raw = Buffer.from(mime, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const response = await this.fetchWithRetry(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw }),
        },
        correlationId,
      );

      const payload = (await response.json()) as { id?: string };
      return {
        outcome: 'SENT',
        fromAddress: this.fromAddress,
        providerMessageId: payload.id,
      };
    } catch (error) {
      return this.classify(error);
    }
  }

  async verify(correlationId: string): Promise<EmailProviderHealth> {
    try {
      const accessToken = await this.getAccessToken(correlationId);
      // The mailbox profile: proves the credential works without sending.
      await this.fetchWithRetry(
        'https://gmail.googleapis.com/gmail/v1/users/me/profile',
        { headers: { Authorization: `Bearer ${accessToken}` } },
        correlationId,
      );
      return {
        kind: this.kind,
        operational: true,
        fromAddress: this.fromAddress,
        detail:
          'Google Workspace mailbox reachable and the credential is valid.',
      };
    } catch (error) {
      return {
        kind: this.kind,
        operational: false,
        fromAddress: this.fromAddress,
        detail: (error as Error).message,
      };
    }
  }

  private classify(error: unknown): EmailSendResult {
    if (error instanceof CredentialRejectedError) {
      return {
        outcome: 'CREDENTIAL_REJECTED',
        fromAddress: this.fromAddress,
        detail: error.message,
      };
    }
    return {
      outcome: 'SEND_FAILED',
      fromAddress: this.fromAddress,
      detail: (error as Error).message,
    };
  }
}

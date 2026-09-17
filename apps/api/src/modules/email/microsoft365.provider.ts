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
 * Microsoft 365 mailbox adapter (Microsoft Graph).
 *
 * ## Read this before assuming it has been proven
 *
 * The request and response shapes below follow Microsoft's published Graph
 * documentation, but **this adapter has never run against a real Microsoft 365
 * tenant** — no office has connected a mailbox on this project yet, and a live
 * OAuth consent cannot be faked. Its HTTP behaviour, token caching, error
 * classification and body construction are covered by unit tests against a
 * stubbed `fetch`; what is NOT covered is whether Microsoft accepts these exact
 * payloads in practice.
 *
 * Verifying that is the first task of whoever connects the first real mailbox,
 * and it is a small task by construction: the two places a real integration
 * would need adjusting are `sendMail`'s body shape and `tokenRequestExtras`.
 *
 * ## Why /users/{mailbox} and not /me
 *
 * `/me` resolves to whichever identity the token belongs to, which for a
 * refresh token obtained by an administrator is not necessarily the shared
 * mailbox the office wants to send from. Addressing the mailbox explicitly
 * means the From address is the one recorded on the integration row and shown
 * in the UI, rather than whatever the token happens to resolve to.
 */
export class Microsoft365EmailProvider
  extends BaseEmailProvider
  implements EmailProvider
{
  readonly kind: EmailProviderKind = 'MICROSOFT365';

  constructor(
    config: EmailConfig,
    app: EmailOAuthAppConfig,
    refreshToken: string,
    readonly fromAddress: string,
    private readonly providerTenantId: string,
  ) {
    super(config, app, refreshToken, 'Microsoft365EmailProvider');
  }

  protected tokenUrl(): string {
    return `https://login.microsoftonline.com/${encodeURIComponent(this.providerTenantId)}/oauth2/v2.0/token`;
  }

  protected tokenRequestExtras(): Record<string, string> {
    return { scope: 'https://graph.microsoft.com/.default' };
  }

  async send(
    message: OutboundMessage,
    correlationId: string,
  ): Promise<EmailSendResult> {
    try {
      const accessToken = await this.getAccessToken(correlationId);
      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.fromAddress)}/sendMail`;

      await this.fetchWithRetry(
        url,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              subject: message.subject,
              body: { contentType: 'Text', content: message.bodyText },
              toRecipients: message.to.map((address) => ({
                emailAddress: { address },
              })),
            },
            // The office's own Sent Items is where their staff will look for
            // proof a client was notified.
            saveToSentItems: true,
          }),
        },
        correlationId,
      );

      // Graph's sendMail returns 202 with an empty body — there is no message
      // id to report, and inventing one would be worse than admitting that.
      return { outcome: 'SENT', fromAddress: this.fromAddress };
    } catch (error) {
      return this.classify(error);
    }
  }

  async verify(correlationId: string): Promise<EmailProviderHealth> {
    try {
      const accessToken = await this.getAccessToken(correlationId);
      // A read of the mailbox's own profile: proves the credential works and
      // that the mailbox exists, without sending anything to anyone.
      await this.fetchWithRetry(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.fromAddress)}?$select=mail`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        correlationId,
      );
      return {
        kind: this.kind,
        operational: true,
        fromAddress: this.fromAddress,
        detail: 'Microsoft 365 mailbox reachable and the credential is valid.',
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

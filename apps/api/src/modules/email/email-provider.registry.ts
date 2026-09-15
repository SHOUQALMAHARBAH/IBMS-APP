import { Injectable, Logger } from '@nestjs/common';
import type { OrganizationEmailIntegration } from '@ibms/db';
import { EncryptionService } from '../security/encryption.service';
import { OrganizationEmailIntegrationRepository } from '../../repositories/organization-email-integration.repository';
import { loadEmailConfig, type EmailConfig } from './email-provider.config';
import { Microsoft365EmailProvider } from './microsoft365.provider';
import { GoogleWorkspaceEmailProvider } from './google-workspace.provider';
import { NotConfiguredEmailProvider } from './not-configured.provider';
import type { EmailProvider } from './email-provider.types';

/**
 * Part I §6 — resolves the mailbox provider for the Organization in context.
 *
 * ## It never falls back
 *
 * Every path that cannot produce a working, office-owned mailbox returns
 * `NotConfiguredEmailProvider`: no connected row, a REVOKED or ERROR row, a
 * provider whose OAuth application is not configured on this deployment, or a
 * refresh token that will not decrypt. None of them silently degrade to a
 * shared platform sender. Sending from an address the recipient does not
 * recognise is the specific failure §6 exists to prevent, and doing it quietly
 * while reporting success would be worse than not sending at all.
 *
 * ## A provider instance is per-call, not cached
 *
 * It holds a decrypted refresh token and a cached access token. Caching the
 * instance across requests would mean caching one office's credential in a
 * process that serves every office — the kind of shared mutable state that
 * produced two separate cross-tenant bugs in Phase 2. The access-token cache
 * therefore lives only as long as the send that created it; the cost is one
 * token exchange per send, which is the correct trade for this.
 */
@Injectable()
export class EmailProviderRegistry {
  private readonly logger = new Logger(EmailProviderRegistry.name);
  private readonly config: EmailConfig;

  constructor(
    private readonly integrations: OrganizationEmailIntegrationRepository,
    private readonly encryption: EncryptionService,
  ) {
    this.config = loadEmailConfig();
  }

  /** The deployment's own base URL, for building deep links. */
  get appBaseUrl(): string {
    return this.config.appBaseUrl;
  }

  /**
   * Resolves this office's provider along with the integration row, so the
   * caller can record the send outcome against it.
   */
  async resolve(actorUserId: string): Promise<{
    provider: EmailProvider;
    integration: OrganizationEmailIntegration | null;
  }> {
    const integration = await this.integrations.find();
    if (!integration) {
      return { provider: new NotConfiguredEmailProvider(), integration: null };
    }
    if (integration.status !== 'ACTIVE') {
      this.logger.warn(
        `Email integration for this office is ${integration.status}; nothing will be sent until it is reconnected.`,
      );
      return { provider: new NotConfiguredEmailProvider(), integration };
    }

    const app =
      integration.provider === 'MICROSOFT365'
        ? this.config.microsoft365
        : this.config.googleWorkspace;
    if (!app) {
      // The office consented, but this deployment has no OAuth application
      // registered for that provider — a configuration gap on our side, not
      // theirs. Loud, because it is invisible from the office's screen.
      this.logger.error(
        `Office has a ${integration.provider} mailbox connected, but no OAuth application is configured for that provider on this deployment. Set the EMAIL_${integration.provider === 'MICROSOFT365' ? 'MS' : 'GOOGLE'}_* environment variables.`,
      );
      return { provider: new NotConfiguredEmailProvider(), integration };
    }

    let refreshToken: string;
    try {
      refreshToken = await this.encryption.decrypt(
        'oauth',
        integration.oauthRefreshTokenEnc,
        {
          userId: actorUserId,
          entityType: 'OrganizationEmailIntegration',
          entityId: integration.id,
          field: 'oauthRefreshTokenEnc',
        },
      );
    } catch (error) {
      // A token encrypted under a key the registry no longer knows. Reporting
      // NOT_CONFIGURED is right — the mailbox genuinely cannot be used — but it
      // needs to be loud, because reconnecting is the only fix.
      this.logger.error(
        `Could not decrypt the stored mailbox credential for this office: ${(error as Error).message}. The mailbox must be reconnected.`,
      );
      return { provider: new NotConfiguredEmailProvider(), integration };
    }

    if (integration.provider === 'MICROSOFT365') {
      if (!integration.providerTenantId) {
        this.logger.error(
          'Microsoft 365 integration has no directory (tenant) id recorded; it must be reconnected.',
        );
        return { provider: new NotConfiguredEmailProvider(), integration };
      }
      return {
        provider: new Microsoft365EmailProvider(
          this.config,
          app,
          refreshToken,
          integration.connectedEmail,
          integration.providerTenantId,
        ),
        integration,
      };
    }

    return {
      provider: new GoogleWorkspaceEmailProvider(
        this.config,
        app,
        refreshToken,
        integration.connectedEmail,
      ),
      integration,
    };
  }
}

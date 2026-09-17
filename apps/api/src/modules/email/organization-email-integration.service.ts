import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EmailProviderKind, LanguagePreference } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../security/encryption.service';
import { OrganizationEmailIntegrationRepository } from '../../repositories/organization-email-integration.repository';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { UserRepository } from '../../repositories/user.repository';
import { OrgContextService } from '../../common/org-context/org-context.service';
import { EmailProviderRegistry } from './email-provider.registry';
import { OutboundEmailService } from './outbound-email.service';
import {
  GOOGLE_SCOPES,
  MICROSOFT_SCOPES,
  loadEmailConfig,
  type EmailConfig,
  type EmailOAuthAppConfig,
} from './email-provider.config';
import type { EmailProviderHealth } from './email-provider.types';

/** What an administrator is allowed to see about their office's mailbox.
 * Deliberately never includes the token, encrypted or otherwise. */
export interface EmailIntegrationView {
  connected: boolean;
  provider: EmailProviderKind | null;
  connectedEmail: string | null;
  status: string | null;
  connectedAt: Date | null;
  lastSucceededAt: Date | null;
  lastFailedAt: Date | null;
  lastError: string | null;
}

interface TokenExchangeResult {
  refreshToken: string;
  connectedEmail: string;
  providerTenantId: string | null;
}

/**
 * Part I §6 — connecting, inspecting and disconnecting an office's mailbox.
 *
 * The OAuth authorization-code flow lives here rather than in a provider
 * adapter because it happens once per office, not once per message, and
 * because it is the only place a refresh token exists in plaintext — for the
 * few lines between receiving it and encrypting it.
 */
@Injectable()
export class OrganizationEmailIntegrationService {
  private readonly logger = new Logger(
    OrganizationEmailIntegrationService.name,
  );
  private readonly config: EmailConfig;

  constructor(
    private readonly integrations: OrganizationEmailIntegrationRepository,
    private readonly organizations: OrganizationRepository,
    private readonly orgContext: OrgContextService,
    private readonly users: UserRepository,
    private readonly encryption: EncryptionService,
    private readonly registry: EmailProviderRegistry,
    private readonly outbound: OutboundEmailService,
    private readonly audit: AuditService,
  ) {
    this.config = loadEmailConfig();
  }

  private appFor(provider: EmailProviderKind): EmailOAuthAppConfig {
    const app =
      provider === 'MICROSOFT365'
        ? this.config.microsoft365
        : this.config.googleWorkspace;
    if (!app) {
      // A deployment-side gap, so it is stated as one. The administrator cannot
      // fix this from the UI and should not be told to try.
      throw new UnprocessableEntityException(
        `No OAuth application is configured on this deployment for ${provider}. ` +
          `Set the EMAIL_${provider === 'MICROSOFT365' ? 'MS' : 'GOOGLE'}_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI environment variables.`,
      );
    }
    return app;
  }

  /**
   * Where to send the administrator to grant consent.
   *
   * `state` is returned to the caller to store and compare on the way back —
   * an authorization code accepted without checking it can be replayed from
   * another site (CSRF against the connect flow).
   */
  authorizeUrl(provider: EmailProviderKind): { url: string; state: string } {
    const app = this.appFor(provider);
    const state = randomUUID();

    if (provider === 'MICROSOFT365') {
      const params = new URLSearchParams({
        client_id: app.clientId,
        response_type: 'code',
        redirect_uri: app.redirectUri,
        response_mode: 'query',
        scope: MICROSOFT_SCOPES.join(' '),
        state,
      });
      return {
        url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`,
        state,
      };
    }

    const params = new URLSearchParams({
      client_id: app.clientId,
      response_type: 'code',
      redirect_uri: app.redirectUri,
      scope: GOOGLE_SCOPES.join(' '),
      // Google only returns a refresh token when both are set, and silently
      // omits it otherwise — which surfaces much later as a mailbox that works
      // for an hour and then stops.
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      state,
    };
  }

  /**
   * Exchanges the authorization code for a refresh token and stores it
   * encrypted.
   *
   * The plaintext refresh token exists only inside this method. It is never
   * logged, never returned, and never written unencrypted.
   */
  async connect(
    input: {
      provider: EmailProviderKind;
      authorizationCode: string;
      connectedEmail: string;
      providerTenantId?: string;
    },
    actorUserId: string,
  ): Promise<EmailIntegrationView> {
    const app = this.appFor(input.provider);
    const exchanged = await this.exchangeCode(input, app);

    const encrypted = await this.encryption.encrypt(
      'oauth',
      exchanged.refreshToken,
      {
        userId: actorUserId,
        entityType: 'OrganizationEmailIntegration',
        entityId: 'pending',
        field: 'oauthRefreshTokenEnc',
      },
    );

    const row = await this.integrations.connect({
      provider: input.provider,
      connectedEmail: exchanged.connectedEmail,
      oauthRefreshTokenEnc: encrypted,
      providerTenantId: exchanged.providerTenantId,
      connectedByUserId: actorUserId,
    });

    await this.audit.record({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'OrganizationEmailIntegration',
      entityId: row.id,
      afterValue: {
        provider: row.provider,
        connectedEmail: row.connectedEmail,
        // No token, encrypted or otherwise.
      },
    });

    return this.toView(row);
  }

  private async exchangeCode(
    input: {
      provider: EmailProviderKind;
      authorizationCode: string;
      connectedEmail: string;
      providerTenantId?: string;
    },
    app: EmailOAuthAppConfig,
  ): Promise<TokenExchangeResult> {
    const tenant = input.providerTenantId ?? 'common';
    const url =
      input.provider === 'MICROSOFT365'
        ? `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`
        : 'https://oauth2.googleapis.com/token';

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.authorizationCode,
      redirect_uri: app.redirectUri,
      client_id: app.clientId,
      client_secret: app.clientSecret,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      // The provider's error body can echo the code and the client secret, so
      // only the status is surfaced.
      throw new UnprocessableEntityException(
        `The provider rejected the authorization code (HTTP ${response.status}). ` +
          'Consent may have expired — start the connection again.',
      );
    }

    const payload = (await response.json()) as {
      refresh_token?: string;
      id_token?: string;
    };
    if (!payload.refresh_token) {
      throw new UnprocessableEntityException(
        'The provider returned no refresh token. For Google this usually means consent was ' +
          'previously granted without offline access — revoke the app at the provider and reconnect.',
      );
    }

    return {
      refreshToken: payload.refresh_token,
      // The administrator names the mailbox; the id token, when present, is
      // only used to sanity-check it below.
      connectedEmail: this.resolveMailbox(
        input.connectedEmail,
        payload.id_token,
      ),
      providerTenantId:
        input.provider === 'MICROSOFT365'
          ? (input.providerTenantId ?? 'common')
          : null,
    };
  }

  /**
   * Prefers the address the consenting account actually is, when the provider
   * tells us, over the one typed into the form — a typo here would otherwise
   * produce a mailbox that fails only at the first real send.
   */
  private resolveMailbox(typed: string, idToken: string | undefined): string {
    if (!idToken) return typed;
    try {
      const [, payloadB64] = idToken.split('.');
      if (!payloadB64) return typed;
      const claims = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      ) as { email?: string };
      if (claims.email && claims.email.toLowerCase() !== typed.toLowerCase()) {
        this.logger.warn(
          'The mailbox entered differs from the account that granted consent; using the consenting account.',
        );
        return claims.email;
      }
      return claims.email ?? typed;
    } catch {
      // A malformed id token is not a reason to fail the connection — the
      // typed address is still workable and the first send will prove it.
      return typed;
    }
  }

  async status(): Promise<EmailIntegrationView> {
    const row = await this.integrations.find();
    if (!row) {
      return {
        connected: false,
        provider: null,
        connectedEmail: null,
        status: null,
        connectedAt: null,
        lastSucceededAt: null,
        lastFailedAt: null,
        lastError: null,
      };
    }
    return this.toView(row);
  }

  /** Proves the stored credential still works, without mailing a third party. */
  async verify(actorUserId: string): Promise<EmailProviderHealth> {
    const { provider } = await this.registry.resolve(actorUserId);
    return provider.verify(randomUUID());
  }

  /**
   * Sends a real test message to the office's own connected mailbox.
   *
   * To itself, deliberately: it proves end-to-end delivery without mailing
   * anybody who did not ask to be part of a configuration test.
   */
  async sendTest(actorUserId: string) {
    const row = await this.integrations.find();
    if (!row) {
      throw new NotFoundException('This office has not connected a mailbox.');
    }
    // `OrganizationRepository` deliberately holds no org context — it drives
    // the per-Organization scheduler loops, which run before any exists — so
    // the current office is resolved from the request context here.
    const organizationId = this.orgContext.currentOrNull();
    const organization = organizationId
      ? await this.organizations.findById(organizationId)
      : null;
    // The administrator running the test reads the result, so it is rendered
    // in THEIR language — Arabic unless they have chosen otherwise, which is
    // also the schema default.
    const actor = await this.users.findById(actorUserId);
    const language: LanguagePreference = actor?.languagePreference ?? 'AR';
    return this.outbound.send({
      to: row.connectedEmail,
      language,
      actorUserId,
      template: {
        kind: 'mailbox_test',
        params: {
          organizationName: organization?.legalName ?? 'your office',
          connectedEmail: row.connectedEmail,
        },
      },
    });
  }

  async revoke(actorUserId: string): Promise<EmailIntegrationView> {
    const row = await this.integrations.find();
    if (!row) {
      throw new NotFoundException('This office has not connected a mailbox.');
    }
    const rows = await this.integrations.revoke(row.id);
    if (rows === 0) {
      // Part V item 6 — zero rows changed is a failure, never "already done".
      throw new UnprocessableEntityException(
        'The mailbox could not be disconnected; nothing was changed.',
      );
    }
    await this.audit.record({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'OrganizationEmailIntegration',
      entityId: row.id,
      afterValue: { status: 'REVOKED' },
    });
    return this.status();
  }

  private toView(row: {
    provider: EmailProviderKind;
    connectedEmail: string;
    status: string;
    connectedAt: Date;
    lastSucceededAt: Date | null;
    lastFailedAt: Date | null;
    lastError: string | null;
  }): EmailIntegrationView {
    return {
      connected: row.status === 'ACTIVE',
      provider: row.provider,
      connectedEmail: row.connectedEmail,
      status: row.status,
      connectedAt: row.connectedAt,
      lastSucceededAt: row.lastSucceededAt,
      lastFailedAt: row.lastFailedAt,
      lastError: row.lastError,
    };
  }
}

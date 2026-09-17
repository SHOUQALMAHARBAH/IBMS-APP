import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationEmailIntegration } from '@ibms/db';
import { EmailProviderRegistry } from './email-provider.registry';
import { Microsoft365EmailProvider } from './microsoft365.provider';
import { GoogleWorkspaceEmailProvider } from './google-workspace.provider';
import { NotConfiguredEmailProvider } from './not-configured.provider';
import type { OrganizationEmailIntegrationRepository } from '../../repositories/organization-email-integration.repository';
import type { EncryptionService } from '../security/encryption.service';

/**
 * The registry's one job that matters: **it never falls back.**
 *
 * Every path that cannot produce a working, office-owned mailbox must hand back
 * the null provider. A fallback to some shared platform sender would make a
 * misconfiguration invisible AND send from an address the recipient has never
 * heard of — the precise failure §6 exists to prevent.
 */

const ROW: OrganizationEmailIntegration = {
  id: 'int-1',
  organizationId: 'org-1',
  provider: 'MICROSOFT365',
  connectedEmail: 'info@alsalam-insurance.jo',
  oauthRefreshTokenEnc: 'key-1:iv:tag:cipher',
  providerTenantId: 'tenant-1',
  connectedByUserId: 'user-1',
  connectedAt: new Date(),
  lastSucceededAt: null,
  lastFailedAt: null,
  lastError: null,
  status: 'ACTIVE',
  updatedAt: new Date(),
};

function build(
  integration: OrganizationEmailIntegration | null,
  options: { decrypt?: () => Promise<string> } = {},
) {
  const integrations = {
    find: vi.fn().mockResolvedValue(integration),
  } as unknown as OrganizationEmailIntegrationRepository;
  const encryption = {
    decrypt: options.decrypt ?? vi.fn().mockResolvedValue('the-refresh-token'),
  } as unknown as EncryptionService;
  return new EmailProviderRegistry(integrations, encryption);
}

const ENV = { ...process.env };

beforeEach(() => {
  process.env.EMAIL_MS_CLIENT_ID = 'ms-client';
  process.env.EMAIL_MS_CLIENT_SECRET = 'ms-secret';
  process.env.EMAIL_MS_REDIRECT_URI = 'https://ibms.example/cb';
  process.env.EMAIL_GOOGLE_CLIENT_ID = 'g-client';
  process.env.EMAIL_GOOGLE_CLIENT_SECRET = 'g-secret';
  process.env.EMAIL_GOOGLE_REDIRECT_URI = 'https://ibms.example/cb';
});

afterEach(() => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
});

describe('EmailProviderRegistry', () => {
  it('builds the Microsoft adapter for a connected Microsoft mailbox', async () => {
    const { provider } = await build(ROW).resolve('user-1');
    expect(provider).toBeInstanceOf(Microsoft365EmailProvider);
    expect(provider.fromAddress).toBe('info@alsalam-insurance.jo');
  });

  it('builds the Google adapter for a connected Google mailbox', async () => {
    const { provider } = await build({
      ...ROW,
      provider: 'GOOGLE_WORKSPACE',
      providerTenantId: null,
    }).resolve('user-1');
    expect(provider).toBeInstanceOf(GoogleWorkspaceEmailProvider);
  });

  it('returns the null provider when no mailbox is connected', async () => {
    const { provider, integration } = await build(null).resolve('user-1');
    expect(provider).toBeInstanceOf(NotConfiguredEmailProvider);
    expect(integration).toBeNull();
  });

  it('returns the null provider for a REVOKED mailbox, keeping the row', async () => {
    // The row is still returned so the caller can record the outcome against
    // it — an administrator needs to see WHY nothing is being sent.
    const { provider, integration } = await build({
      ...ROW,
      status: 'REVOKED',
    }).resolve('user-1');
    expect(provider).toBeInstanceOf(NotConfiguredEmailProvider);
    expect(integration?.id).toBe('int-1');
  });

  it('returns the null provider for an ERROR mailbox', async () => {
    const { provider } = await build({ ...ROW, status: 'ERROR' }).resolve(
      'user-1',
    );
    expect(provider).toBeInstanceOf(NotConfiguredEmailProvider);
  });

  it('does NOT fall back to the other provider when this one is unconfigured', async () => {
    // The office consented to Microsoft; this deployment has no Microsoft OAuth
    // app. Sending via the configured Google app would send from the wrong
    // place entirely.
    delete process.env.EMAIL_MS_CLIENT_ID;
    const { provider } = await build(ROW).resolve('user-1');
    expect(provider).toBeInstanceOf(NotConfiguredEmailProvider);
  });

  it('returns the null provider when the stored credential will not decrypt', async () => {
    // A token encrypted under a key this process no longer holds. The mailbox
    // genuinely cannot be used, so the honest answer is NOT_CONFIGURED — not a
    // crash, and certainly not a silent send from somewhere else.
    const { provider } = await build(ROW, {
      decrypt: () => Promise.reject(new Error('unknown key id')),
    }).resolve('user-1');
    expect(provider).toBeInstanceOf(NotConfiguredEmailProvider);
  });

  it('returns the null provider for a Microsoft row with no directory id', async () => {
    const { provider } = await build({
      ...ROW,
      providerTenantId: null,
    }).resolve('user-1');
    expect(provider).toBeInstanceOf(NotConfiguredEmailProvider);
  });

  it('decrypts under the oauth purpose, attributed to the acting user', async () => {
    const decrypt = vi.fn().mockResolvedValue('the-refresh-token');
    await build(ROW, { decrypt }).resolve('user-9');

    expect(decrypt).toHaveBeenCalledWith(
      'oauth',
      ROW.oauthRefreshTokenEnc,
      expect.objectContaining({
        userId: 'user-9',
        entityType: 'OrganizationEmailIntegration',
        field: 'oauthRefreshTokenEnc',
      }),
    );
  });
});

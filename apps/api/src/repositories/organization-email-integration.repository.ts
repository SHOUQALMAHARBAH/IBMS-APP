import { Injectable } from '@nestjs/common';
import type {
  EmailIntegrationStatus,
  EmailProviderKind,
  OrganizationEmailIntegration,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface UpsertIntegrationInput {
  provider: EmailProviderKind;
  connectedEmail: string;
  oauthRefreshTokenEnc: string;
  providerTenantId: string | null;
  connectedByUserId: string;
}

/**
 * Part I §6 — one mailbox per Organization.
 *
 * Every read and write here goes through the tenant-scoped client, so an office
 * can only ever reach its own row; the table also carries an RLS policy
 * (migration 20260930100000) so the database enforces the same thing
 * independently. That double cover is not ceremony — this row holds the
 * credential to send mail as a real company.
 */
@Injectable()
export class OrganizationEmailIntegrationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The current office's integration, or null.
   *
   * `findFirst`, not `findUnique`: the extension injects `organizationId` into
   * the filter, so this resolves to at most one row by the unique constraint
   * anyway, and it reads naturally as "this office's mailbox" rather than
   * requiring the caller to know the tenant key.
   */
  find(): Promise<OrganizationEmailIntegration | null> {
    return this.prisma.client.organizationEmailIntegration.findFirst();
  }

  /**
   * Connects or reconnects the office's mailbox.
   *
   * Reconnecting deliberately REPLACES the credential and resets the failure
   * state: the reason an administrator reconnects is almost always that the old
   * consent stopped working, and leaving `lastError` behind would leave the
   * screen reporting a fault that has just been fixed.
   */
  async connect(
    input: UpsertIntegrationInput,
  ): Promise<OrganizationEmailIntegration> {
    const existing = await this.find();
    if (existing) {
      return this.prisma.client.organizationEmailIntegration.update({
        where: { id: existing.id },
        data: {
          ...input,
          status: 'ACTIVE',
          connectedAt: new Date(),
          lastError: null,
          lastFailedAt: null,
        },
      });
    }
    return this.prisma.client.organizationEmailIntegration.create({
      data: { ...input, status: 'ACTIVE' },
    });
  }

  /**
   * Records the outcome of a send against the integration.
   *
   * Returns the number of rows changed rather than void (Part V item 6): a
   * status write that silently affected nothing is the failure mode that let a
   * deactivated account stay active in Phase 2 step 8, and this one governs
   * whether an administrator is ever told their mailbox stopped working.
   */
  async recordOutcome(
    id: string,
    outcome:
      | { ok: true }
      | { ok: false; status: EmailIntegrationStatus; error: string },
  ): Promise<number> {
    const { count } =
      await this.prisma.client.organizationEmailIntegration.updateMany({
        where: { id },
        data: outcome.ok
          ? { lastSucceededAt: new Date(), lastError: null }
          : {
              lastFailedAt: new Date(),
              lastError: outcome.error.slice(0, 500),
              status: outcome.status,
            },
      });
    return count;
  }

  async revoke(id: string): Promise<number> {
    const { count } =
      await this.prisma.client.organizationEmailIntegration.updateMany({
        where: { id },
        data: { status: 'REVOKED' },
      });
    return count;
  }
}

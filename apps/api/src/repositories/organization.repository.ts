import { Injectable } from '@nestjs/common';
import type { Organization } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Multi-tenancy Phase 2 — reads over the tenant registry itself.
 *
 * `Organization` is deliberately NOT tenant-scoped (it IS the tenant), so
 * `tenantScopeExtension` never filters these queries and they need no org
 * context. That is what makes this repository usable as the driver of the
 * per-Organization scheduler loops, which run before any context exists.
 */
@Injectable()
export class OrganizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every Organization a background sweep should run for.
   *
   * SUSPENDED and DEACTIVATED are excluded on purpose: a suspended office is
   * blocked from logging in (spec §2), so continuing to open follow-up alerts,
   * recompute its scores and re-screen its customers on its behalf would be
   * doing work for an office that cannot see the result.
   */
  findActive(): Promise<Organization[]> {
    return this.prisma.client.organization.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
  }

  findById(id: string): Promise<Organization | null> {
    return this.prisma.client.organization.findUnique({ where: { id } });
  }

  /**
   * The Organization, when the platform has exactly one — the deliberate
   * bridge for anonymous signup, which has no user and no subdomain to resolve
   * an org from until Phase 4 (§4.10).
   *
   * Throws rather than guessing once a second Organization exists. That is the
   * intended failure: it stops a second office being onboarded through a
   * signup path that cannot tell which office the account belongs to, and
   * forces Phase 4's subdomain resolution to land first.
   */
  async soleOrganizationIdOrThrow(): Promise<string> {
    const organizations = await this.prisma.client.organization.findMany({
      take: 2,
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (organizations.length === 0) {
      throw new Error(
        'No Organization exists — run `npm run db:seed` before anyone can sign up.',
      );
    }
    if (organizations.length > 1) {
      throw new Error(
        'More than one Organization exists, so anonymous signup can no longer tell which office an account belongs to. ' +
          'Phase 4 (§4.10) resolves the Organization from the request subdomain before the sign-in form is shown; ' +
          'until that lands, provision users through POST /admin/users, which names the Organization explicitly.',
      );
    }
    return organizations[0].id;
  }
}

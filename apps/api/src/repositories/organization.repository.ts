import { Injectable } from '@nestjs/common';
import type { DutySegregationMode, Organization } from '@ibms/db';
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
   *
   * ## The message used to name a route that cannot do what it claimed
   *
   * It said "provision users through POST /admin/users, which names the Organization
   * explicitly". Both halves were false, and the sentence is REMOVED rather than reworded:
   *
   *  - **It does not name the Organization.** `ProvisionUserDto` has no `organizationId` field;
   *    `tenantScopeExtension` supplies it from the CALLER's context. So the route can only ever
   *    create a user in the office the caller already belongs to.
   *  - **It therefore cannot onboard a second office.** Calling it requires an authenticated user
   *    inside the target office, and creating the first one is the thing being asked for. The
   *    advice was circular.
   *
   * Measured rather than assumed: `Organization` has exactly TWO writers in the whole repository,
   * `packages/db/prisma/seed.ts` and `apps/api/scripts/seed-demo.script.ts`, neither reachable
   * over HTTP.
   *
   * This is the § 1.23 shape — an instruction pointing at something that was never built — and it
   * is worse here than in a comment, because this text reaches an operator at the moment signup
   * has already failed. Being told to use a route that cannot help costs them the time it takes
   * to discover that for themselves.
   *
   * ## What is still wrong here, deliberately left
   *
   * This throws a bare `Error`, so the HTTP answer is a 500 with a generic body and this text
   * reaches only the server log (§ 1.11). That is a separate commit by prior decision: the status
   * code is part of the auth contract and several specs assert on it. Today it caused its THIRD
   * expensive diagnostic — two concurrent e2e runs each leaked an Organization into the other's
   * view and unrelated files reported `expected 201, got 500` with nothing saying why.
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
          'A second office cannot currently be onboarded through the application at all: nothing in it creates an ' +
          'Organization, and no request can create the first user inside one. Phase 4 (§4.10) is where that lands — ' +
          'the Organization resolved from the request subdomain before the sign-in form is shown. ' +
          'Today the only two writers of Organization are `packages/db/prisma/seed.ts` and ' +
          '`apps/api/scripts/seed-demo.script.ts`, both developer tools run against a local database.',
      );
    }
    return organizations[0].id;
  }
  /**
   * Part 4 — declare this office's duty-segregation mode, stamping who declared it and when.
   *
   * The three columns move together. A mode with no declaration date would read as "segregated because that is
   * the default" even after somebody chose it, which is exactly the distinction the report has to show.
   */
  declareDutySegregationMode(
    id: string,
    mode: DutySegregationMode,
    declaredByUserId: string,
  ): Promise<Organization> {
    return this.prisma.client.organization.update({
      where: { id },
      data: {
        dutySegregationMode: mode,
        dutySegregationModeDeclaredAt: new Date(),
        dutySegregationModeDeclaredByUserId: declaredByUserId,
      },
    });
  }
}

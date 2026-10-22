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
    /*
     * BROKERAGE OFFICES ONLY, since Module 0 item (j)'s gap closure.
     *
     * Signup files a new account under an OFFICE. The PROVIDER organization is not one — nobody
     * signs up into the platform operator; its single user is created by the seed — so counting it
     * here would make the platform's one office ambiguous the moment a provider existed, and every
     * signup would refuse with a message about a second office that does not exist.
     *
     * Found by the e2e harness rather than by reasoning: `assertOneOrganization` refused the whole
     * api e2e suite the moment the provider was seeded, naming the leftover row. The invariant was
     * never "one Organization" — it was "one office signup can resolve", and the two were the same
     * thing until today.
     *
     * An INSURANCE_COMPANY row would have had the same effect and is excluded for the same reason.
     */
    const organizations = await this.prisma.client.organization.findMany({
      take: 2,
      where: { type: 'BROKERAGE_OFFICE' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (organizations.length === 0) {
      throw new Error(
        'No brokerage office exists — run `npm run db:seed` before anyone can sign up. (A PROVIDER organization is not an office: nobody signs up into the platform operator.)',
      );
    }
    if (organizations.length > 1) {
      /*
       * CORRECTED, MODULE 0-ب: THIS MESSAGE HAD BECOME FALSE, AND ITS OWN TEST STILL PASSED.
       *
       * It said "a second office cannot currently be onboarded through the application at all:
       * nothing in it creates an Organization", and named `seed.ts` and `seed-demo.script.ts` as
       * "the only two writers". Items (d) and (e) made all of that untrue — there are FOUR writers
       * now (measured) and TWO of them are reachable over HTTP. The test pinning this text asserted
       * the two filenames and the phrase "cannot currently be onboarded", so it stayed green while
       * the sentence it exists to protect became wrong: a reader hitting this refusal was told the
       * application cannot do the thing it had just been built to do.
       *
       * What is STILL true is the narrow half, and it is the half this refusal is actually about:
       * an ANONYMOUS request cannot resolve WHICH office it belongs to. So the message now
       * separates the two — what onboards an office (the provider routes, which exist) from what
       * signup cannot do (resolve a tenant, which is Phase 4).
       */
      throw new Error(
        'More than one brokerage office exists, so anonymous signup can no longer tell which office an account belongs to. ' +
          'Signup is NOT how an office is onboarded: the platform provider registers one at ' +
          '`POST /provider/brokerage-offices`, and an insurance company at ' +
          '`POST /provider/insurance-companies`, both of which name the organization explicitly. ' +
          'What is still missing is a way for an ANONYMOUS request to resolve which office it belongs to — ' +
          'the Organization resolved from the request subdomain before the sign-in form is shown, which is ' +
          'Phase 4 (§4.10). The four writers of Organization today are `packages/db/prisma/seed.ts` and ' +
          '`apps/api/scripts/seed-demo.script.ts`, both developer tools, plus those two provider ' +
          'registration services, which are reachable over HTTP.',
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

  /**
   * MODULE 0-ب — record who this office has assigned as its data protection officer, and the
   * acknowledgement when that is the same person as the office manager.
   *
   * ## THE FOUR DECLARATION COLUMNS MOVE TOGETHER OR NOT AT ALL
   *
   * `declaration` is what `resolveCombinedDeclaration` returned: an object when one was owed and
   * well-formed, `null` when none was owed. So this method cannot write a partial declaration and
   * cannot omit one that was required — the database's all-four-or-none CHECK is the backstop, and
   * the return type is what makes the mistake unexpressible one layer up.
   *
   * ## IT NEVER CLEARS AN ACKNOWLEDGEMENT
   *
   * When the office moves the DPO to a second person the combination ends, and the stored
   * acknowledgement becomes inert on its own — `combinedDeclarationRequired` returns false because
   * the designations no longer name one person. Clearing it would destroy the record of a decision
   * somebody took on a date, which is the one thing it exists to hold.
   *
   * The consequence is recorded rather than discovered: an office that un-combines and later
   * re-combines WITH THE SAME PERSON is not asked again. That is deliberate and matches the no-floor
   * precedent, where a period at or above the one already acknowledged does not re-ask — the person
   * acknowledged is the same person, so the exposure is the one they read about.
   */
  recordDpoDesignation(
    id: string,
    dataProtectionOfficerName: string | null,
    declaration: { noticeShown: string; person: string } | null,
    acknowledgedByUserId: string,
  ): Promise<Organization> {
    return this.prisma.client.organization.update({
      where: { id },
      data: {
        dataProtectionOfficerName,
        ...(declaration
          ? {
              dpoManagerCombinedNoticeShown: declaration.noticeShown,
              dpoManagerCombinedAcknowledgedPerson: declaration.person,
              dpoManagerCombinedAcknowledgedAt: new Date(),
              dpoManagerCombinedAcknowledgedByUserId: acknowledgedByUserId,
            }
          : {}),
      },
    });
  }
}

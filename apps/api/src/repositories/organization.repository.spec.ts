import { describe, expect, it, vi } from 'vitest';
import { OrganizationRepository } from './organization.repository';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * What `soleOrganizationIdOrThrow` TELLS the operator when it refuses.
 *
 * The refusal text is not decoration: it reaches somebody at the moment signup has already
 * failed, and it is the only explanation they get, because the bare `Error` surfaces as a generic
 * 500 and this text lands in the server log (§ 1.11, a separate commit by prior decision).
 *
 * It used to say "provision users through POST /admin/users, which names the Organization
 * explicitly". Both halves were false — `ProvisionUserDto` has no `organizationId`, so the route
 * can only create a user in the CALLER's office, which makes the advice circular for somebody
 * trying to create the first user in a new one. This file pins the corrected message so the
 * false claim cannot return, and so a future edit has to think about what it is promising.
 *
 * AND IT HAPPENED A SECOND TIME, WHICH IS WHY THE ASSERTIONS CHANGED SHAPE. The replacement text
 * said "a second office cannot currently be onboarded through the application at all" and named two
 * developer tools as the only writers of Organization. Module 0-ب items (d) and (e) made both
 * false, and this file DID NOT NOTICE: it asserted that a phrase was PRESENT, so it stayed green
 * while the phrase became a wrong claim. A `toContain` pins wording; it cannot pin a fact. Every
 * claim here is now paired with a `not.toContain` of the thing it replaced, which is the only form
 * that fails when somebody puts the old sentence back.
 */
function repositoryWith(
  organizations: { id: string }[],
): OrganizationRepository {
  return built(organizations).repository;
}

/** The repository AND the `findMany` double, so a test can read the query it was handed. */
function built(organizations: { id: string }[]): {
  repository: OrganizationRepository;
  findMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn().mockResolvedValue(organizations);
  const prisma = {
    client: { organization: { findMany } },
  } as unknown as PrismaService;
  return { repository: new OrganizationRepository(prisma), findMany };
}

describe('soleOrganizationIdOrThrow', () => {
  it('returns the id when there is exactly one office', async () => {
    await expect(
      repositoryWith([{ id: 'org-1' }]).soleOrganizationIdOrThrow(),
    ).resolves.toBe('org-1');
  });

  it('names the seed when there is no office at all', async () => {
    // A different failure with a different remedy, and the remedy is real: `db:seed` does create
    // the Organization. Kept distinct from the two-office case so the two are not conflated.
    await expect(
      repositoryWith([]).soleOrganizationIdOrThrow(),
    ).rejects.toThrow(/npm run db:seed/);
  });

  describe('with more than one office', () => {
    async function message(): Promise<string> {
      try {
        await repositoryWith([
          { id: 'org-1' },
          { id: 'org-2' },
        ]).soleOrganizationIdOrThrow();
      } catch (err) {
        return (err as Error).message;
      }
      throw new Error('expected a refusal with two Organizations');
    }

    it('does NOT point at POST /admin/users, which cannot name an office', async () => {
      // The assertion this file exists for. `ProvisionUserDto` has no `organizationId` field, so
      // that route creates a user in the caller's own office and can never create the first user
      // in a different one. Naming it here sent an operator to a route that cannot help.
      expect(await message()).not.toContain('/admin/users');
    });

    it('NAMES THE ROUTE THAT DOES ONBOARD AN OFFICE — and no longer claims none exists', async () => {
      /*
       * RE-POINTED, MODULE 0-ب, AND THE RE-POINTING IS THE FINDING.
       *
       * This used to assert `toContain('cannot currently be onboarded')`. That phrase was true when
       * written and items (d) and (e) made it false, and because the assertion only checked that the
       * phrase was PRESENT, the test went on passing while the sentence became a wrong claim about
       * the system's own capability. A test that pins a phrase pins the phrase, not the fact.
       *
       * So it now asserts the thing that must stay true — that the message names the route which
       * actually onboards an office — and asserts the OLD claim is ABSENT, which is the only form
       * that can fail if somebody restores it.
       */
      const text = await message();
      expect(text).toContain('/provider/brokerage-offices');
      expect(text).toContain('/provider/insurance-companies');
      expect(
        text,
        'the refusal has gone back to claiming an office cannot be onboarded through the application. Two provider routes create an Organization over HTTP — measured.',
      ).not.toContain('cannot currently be onboarded');
      // The narrow half that is STILL true, kept: signup cannot resolve a tenant, and Phase 4 is
      // where that lands — so the statement is a status rather than a dead end.
      expect(text).toContain('Phase 4');
    });

    it('names ALL FOUR writers of Organization, and says which are reachable over HTTP', async () => {
      /*
       * Measured rather than asserted from memory, which is what the previous version of this test
       * got wrong: `organization.create` appears at FOUR non-spec call sites — the seed (twice, one
       * file), the demo script, and the two provider registration services — and the last two ARE
       * reachable over HTTP. The old comment here stated the opposite as a measurement.
       */
      const text = await message();
      expect(text).toContain('packages/db/prisma/seed.ts');
      expect(text).toContain('apps/api/scripts/seed-demo.script.ts');
      expect(text).toContain('four writers');
      expect(text).toContain('reachable over HTTP');
    });
  });

  it('ASKS ONLY FOR BROKERAGE OFFICES — the provider is not a signup candidate', async () => {
    /*
     * MODULE 0 ITEM (j)'s GAP CLOSURE, and this assertion exists because the other tests here CANNOT
     * see it: they stub `findMany`, so the `where` clause makes no difference to what they get back
     * and a plant removing it would leave all four green.
     *
     * The consequence of losing it is not subtle. With a PROVIDER organization seeded, an unfiltered
     * query returns two rows and EVERY SIGNUP refuses — with a message about a second office that
     * does not exist. That is how the api e2e suite failed the moment the provider was first seeded.
     */
    const { repository, findMany } = built([{ id: 'org-1' }]);
    await repository.soleOrganizationIdOrThrow();
    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0] as { where?: { type?: string } };
    expect(
      args.where?.type,
      'signup resolves the sole organization WITHOUT filtering to BROKERAGE_OFFICE. A PROVIDER (or INSURANCE_COMPANY) row then makes the platform look like it has two offices, and every signup refuses.',
    ).toBe('BROKERAGE_OFFICE');
  });
});

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

    it('says plainly that a second office cannot be onboarded through the application', async () => {
      const text = await message();
      expect(text).toContain('cannot currently be onboarded');
      // And it names WHERE that lands, so the statement is a status rather than a dead end.
      expect(text).toContain('Phase 4');
    });

    it('names the only two writers of Organization, so the operator knows what does exist', async () => {
      // Measured, not asserted from memory: these are the only two `organization.create` call
      // sites outside tests in the whole repository, and neither is reachable over HTTP. A
      // message that said "nothing can do this" without saying what CAN would leave somebody
      // searching for an endpoint that is not there.
      const text = await message();
      expect(text).toContain('packages/db/prisma/seed.ts');
      expect(text).toContain('apps/api/scripts/seed-demo.script.ts');
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

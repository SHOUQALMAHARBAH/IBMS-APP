import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from './utils/test-app';
import { createProviderUser, bearerHeader } from './utils/provider-user';
import { rawPrisma } from './tenant-prisma';

/**
 * MODULE 0-ب ITEM (b) — THE PROVIDER ADMINISTERS ITSELF, AND NO OFFICE.
 *
 * Item (j) left the provider organization holding one code, so it could not add a second operator
 * or change a role — the same shape `office-administrator.e2e-spec.ts` calls a defect in its own
 * failure message. Item (b) gives it `user.manage` and the four role verbs.
 *
 * ## WHAT THIS FILE IS ACTUALLY FOR
 *
 * The permissive half — "the provider can administer itself" — is cheap and would pass on a
 * system with no tenancy at all. The half worth proving is the REFUSAL: that holding `role.update`
 * and `user.manage` gives the provider no reach into an office.
 *
 * And that refusal is not written anywhere. It is a property of `tenantScopeExtension` plus RLS:
 * `Role`, `RolePermission`, `User` and `UserRoleAssignment` all carry `organizationId`, so every
 * query the provider makes is filtered before it reaches the database. Nothing in a service says
 * "a provider may not touch an office's role" — which is exactly why it has to be proven by ASKING
 * for one, by id, over real HTTP, and being told it does not exist.
 *
 * A 404 and not a 403, deliberately and consistently with the rest of this product: a 403 would
 * confirm that the id names something real in another organization.
 */

let app: INestApplication<App>;
let operator: { accessToken: string; userId: string; organizationId: string };
/** A role belonging to the DEFAULT BROKERAGE OFFICE — the thing the provider must not reach. */
let officeRoleId: string;
let officeUserId: string;
const createdRoleIds: string[] = [];

beforeAll(async () => {
  app = await createTestApp();
  operator = await createProviderUser(app, 'provider-selfadmin');

  const office = await rawPrisma.organization.findFirstOrThrow({
    where: { type: 'BROKERAGE_OFFICE' },
  });
  const role = await rawPrisma.role.findFirstOrThrow({
    where: { organizationId: office.id },
  });
  officeRoleId = role.id;
  const user = await rawPrisma.user.findFirstOrThrow({
    where: { organizationId: office.id },
  });
  officeUserId = user.id;
}, 300_000);

afterAll(async () => {
  // db-test is cumulative: a role this file created and left behind would be counted by every
  // later spec that asserts something about the SET of roles — which is how four guards broke in
  // the last module.
  if (createdRoleIds.length > 0) {
    await rawPrisma.rolePermission.deleteMany({
      where: { roleId: { in: createdRoleIds } },
    });
    await rawPrisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
  }
  await app?.close();
}, 300_000);

describe('the provider administers its OWN organization', () => {
  it('lists its own roles, and the list is its own only', async () => {
    const body = (
      await request(app.getHttpServer())
        .get('/rbac/roles')
        .set(...bearerHeader(operator.accessToken))
        .expect(200)
    ).body as { id: string; name: string }[];

    // It sees PLATFORM_OPERATOR...
    expect(body.some((r) => r.name === 'PLATFORM_OPERATOR')).toBe(true);
    // ...and NOT the office's role, which it holds `role.read` for in its own organization only.
    expect(
      body.some((r) => r.id === officeRoleId),
      "the provider can see a brokerage office's role",
    ).toBe(false);
  }, 300_000);

  it('CREATES a role inside itself — the capability item (j) left it without', async () => {
    const name = `Provider Desk ${Date.now()}`;
    const created = (
      await request(app.getHttpServer())
        .post('/rbac/roles')
        .set(...bearerHeader(operator.accessToken))
        // `permissionCodes` is REQUIRED by `CreateRoleDto` — an empty array is the "a role that
        // grants nothing yet" case, and omitting the field is a 400. Read off the refusal rather
        // than guessed.
        .send({
          name,
          nameEn: name,
          nameAr: `مكتب ${name}`,
          permissionCodes: [],
        })
        .expect(201)
    ).body as { id: string };
    createdRoleIds.push(created.id);

    // Written into the PROVIDER organization and nowhere else — asserted on the stored row rather
    // than on the response, because the response would say the same thing either way.
    const stored = await rawPrisma.role.findUniqueOrThrow({
      where: { id: created.id },
      select: { organizationId: true },
    });
    expect(stored.organizationId).toBe(operator.organizationId);
  }, 300_000);
});

describe('and reaches NO office, though it holds the codes that would', () => {
  it("cannot read a brokerage office's role BY ID — 404, not 403", async () => {
    /*
     * The central assertion of item (b). The provider holds `role.read`; what stops it here is
     * tenancy, not permission. A 403 would confirm the id names a real role in another
     * organization, which is the disclosure this product's 404-not-403 convention exists to avoid.
     */
    await request(app.getHttpServer())
      .get(`/rbac/roles/${officeRoleId}`)
      .set(...bearerHeader(operator.accessToken))
      .expect(404);
  }, 300_000);

  it("cannot RETIRE a brokerage office's role, holding role.deactivate", async () => {
    await request(app.getHttpServer())
      .patch(`/rbac/roles/${officeRoleId}/status`)
      .set(...bearerHeader(operator.accessToken))
      .send({ status: 'INACTIVE' })
      .expect(404);

    // And the office's role is untouched — a 404 that had nevertheless written would be the worst
    // of both, so the state is read back rather than inferred from the status code.
    const after = await rawPrisma.role.findUniqueOrThrow({
      where: { id: officeRoleId },
      select: { status: true },
    });
    expect(after.status).toBe('ACTIVE');
  }, 300_000);

  it("cannot see a brokerage office's users, holding user.manage", async () => {
    const body =
      // `{ users, total }` — the shape `UserAdminService.list` actually returns. Neither an array
      // nor `{ items }`, both of which I guessed first; the TypeError that produced is the reason
      // this comment names the real one.
      (
        await request(app.getHttpServer())
          .get('/admin/users')
          .set(...bearerHeader(operator.accessToken))
          .expect(200)
      ).body as { users: { id: string }[]; total: number };

    const rows = body.users;
    expect(
      rows.some((u) => u.id === officeUserId),
      "the provider can see a brokerage office's user",
    ).toBe(false);
    // Non-vacuity: an empty list would satisfy the absence while proving nothing. The provider has
    // at least this operator.
    expect(rows.some((u) => u.id === operator.userId)).toBe(true);
  }, 300_000);
});

/* =============================================================================================
 * THE AUTHORISED MAILBOX WIDENING (batch 5, decision 25).
 *
 * ## WHY IT WAS AUTHORISED, MEASURED
 *
 * The invitation that is the only door into a brand-new organization leaves from the PROVIDER's own
 * connected mailbox, because the invited organization has none and cannot connect one until
 * somebody is inside it. And the provider held NEITHER email code — `PROVIDER_CODES` was eleven and
 * both email codes are office-role grants — so it could not connect a mailbox at all. The channel
 * was real in tests, where an integration row can be seeded, and unreachable in life.
 *
 * ## THE ACCEPTANCE CRITERION IS THE SETS, NOT "THE PROVIDER CAN SEE THE SCREEN"
 *
 * Asserted BY NAME and EXACTLY, in both directions, because a widening is specified by the set it
 * produces. Two existing codes reach one more role; the catalogue total is unchanged.
 *
 * ## WHY `isSystem` IS THE FILTER, AND IT IS NOT A CONVENIENCE
 *
 * These are the SEEDED sets. An office — or the provider — defining its own role at
 * `/settings/roles` and granting it a code is the Role screen working as designed, and such a role
 * is DATA on one database rather than an outcome of the seed. Measured while writing this: dev
 * carries a hand-created `GO_GLOBAL` role in the provider organization, `isSystem = false`, ACTIVE,
 * **0 holders and 74 codes**, which already held both email codes before this change — so an
 * unfiltered read of dev answers 6 and 4 while db-test answers 5 and 3. Filtering on `isSystem`
 * asks the question the decision is about. The custom role is reported, not absorbed.
 * ============================================================================================= */

const SEEDED_EMAIL_READ_ROLES = [
  'BRANCH_DEPARTMENT_MANAGER',
  'EXECUTIVE_MANAGEMENT',
  'OFFICE_ADMINISTRATOR',
  'PLATFORM_OPERATOR',
  'SYSTEM_SECURITY_ADMINISTRATOR',
];

const SEEDED_EMAIL_MANAGE_ROLES = [
  'OFFICE_ADMINISTRATOR',
  'PLATFORM_OPERATOR',
  'SYSTEM_SECURITY_ADMINISTRATOR',
];

async function seededRolesHolding(code: string): Promise<string[]> {
  const grants = await rawPrisma.rolePermission.findMany({
    where: { permission: { code }, role: { isSystem: true } },
    select: { role: { select: { name: true } } },
  });
  return [...new Set(grants.map((g) => g.role.name))].sort();
}

describe('the authorised mailbox widening — the sets, by name', () => {
  it('email.integration.read reaches exactly FIVE seeded roles', async () => {
    const roles = await seededRolesHolding('email.integration.read');
    // Printed so the evidence is the set rather than a green tick.
    console.log(
      `email.integration.read  -> ${roles.length} seeded role(s): ${roles.join(', ')}`,
    );
    expect(roles).toEqual(SEEDED_EMAIL_READ_ROLES);
  });

  it('email.integration.manage reaches exactly THREE seeded roles', async () => {
    const roles = await seededRolesHolding('email.integration.manage');
    console.log(
      `email.integration.manage -> ${roles.length} seeded role(s): ${roles.join(', ')}`,
    );
    expect(roles).toEqual(SEEDED_EMAIL_MANAGE_ROLES);
  });

  it('THE WIDENING mints nothing — and the catalogue total moves only when a batch deliberately mints', async () => {
    /*
     * THE CLAIM THIS TEST IS ACTUALLY ABOUT IS UNCHANGED: the authorised mailbox widening granted
     * two EXISTING codes to one more role and added nothing to the catalogue. That is still asserted
     * — by the two role-set assertions above, which name both codes and every holder.
     *
     * WHAT MOVED IS THE TOTAL, AND IT MOVED BY DECISION. Batch 5 group 7b minted exactly one code,
     * `retention.extend`, granted to the template default the owner measured (COMPLIANCE_OFFICER
     * and DATA_PROTECTION_OFFICER — the pair that already holds both retention-period codes). The
     * catalogue went 227 -> 228 for the first time in eleven commits, and 7c minted one more
     * (`retention.archive.retrieve`), so it reads 229. The SIXTH place a new permission touches,
     * which is now recorded in `CLAUDE.md` — it was found by CI rather than by the five
     * regenerations, because none of those asks which specs assert the TOTAL.
     *
     * SO THE PIN IS RE-POINTED RATHER THAN RELAXED. It still fails on an unexplained move, which is
     * the whole reason it exists; what it no longer does is fail on a recorded one. A floor
     * (`toBeGreaterThanOrEqual`) would have been the easy edit and the wrong one: it would stop
     * catching the thing the brief said to stop on.
     *
     * MODULE 0-ب, DECISION 36 — 229 -> 230. ONE code minted,
     * `conflict-of-interest.register.read`, and it reaches BRANCH_DEPARTMENT_MANAGER alone: the
     * owner's words were "the OFFICE MANAGER as the shipped TEMPLATE DEFAULT", and MEASURED against
     * the seeded grid there is no role of that name, so the manager role in this product is what
     * ships and the office may grant it elsewhere (decision 80 — the template is not a lock).
     *
     * THE OFFICE-ADMINISTRATOR COUNTS BELOW DID NOT MOVE, because the code does not reach that role
     * — the same situation the two entries above describe, and checked rather than assumed.
     *
     * AND NO CODE WAS MINTED FOR DECLARING a conflict. The discloser is the SUBJECT, which is the
     * reasoning that leaves `AccessRecertificationItem`'s maker permission empty; a code an office
     * could withhold would leave the person who HAS the conflict unable to say so. So decision 36
     * moves this total by exactly one and not by two.
     *
     * AND CI IS HOW THIS WAS FOUND, not a local run: the catalogue total is pinned in an api E2E,
     * and I had run one e2e FILE plus the full unit suite. `CLAUDE.md`'s five regenerations for a
     * new permission are all done — the office-administrator counts did not move, because this code
     * goes to Compliance and the DPO — but "which specs assert the catalogue TOTAL" is a different
     * question from "which specs assert the office administrator's count", and it is the one that
     * mattered.
     */
    const total = await rawPrisma.permission.count();
    console.log(`permission catalogue total: ${total}`);
    expect(total).toBe(230);
  });

  it("adds no role — PLATFORM_OPERATOR is still the provider organization's only seeded role", async () => {
    const provider = await rawPrisma.organization.findFirstOrThrow({
      where: { type: 'PROVIDER' },
      select: { id: true },
    });
    const roles = await rawPrisma.role.findMany({
      where: { organizationId: provider.id, isSystem: true },
      select: { name: true },
    });
    expect(roles.map((r) => r.name).sort()).toEqual(['PLATFORM_OPERATOR']);
  });

  it("(iv) the provider still cannot read or write ANY other organization's mailbox row", async () => {
    /*
     * BOTH DIRECTIONS, and the office's row has to EXIST or the "cannot read it" half passes
     * because there was nothing there. `OrganizationEmailIntegration` is organization-scoped and
     * carries an RLS policy on top of the tenancy extension; holding the two codes changes who may
     * ASK, never whose row the answer comes from.
     */
    const office = await rawPrisma.organization.findFirstOrThrow({
      where: { type: 'BROKERAGE_OFFICE' },
      select: { id: true },
    });
    const planted = await rawPrisma.organizationEmailIntegration.create({
      data: {
        organizationId: office.id,
        provider: 'GOOGLE_WORKSPACE',
        connectedEmail: `office-mailbox-${Date.now()}@example.test`,
        oauthRefreshTokenEnc: 'v1:not-a-real-credential',
        status: 'ACTIVE',
      },
      select: { id: true, connectedEmail: true },
    });
    try {
      // THE PROVIDER ASKS, holding both codes. It must be told it has no mailbox — not told about
      // the office's.
      const status = await request(app.getHttpServer())
        .get('/admin/email-integration')
        .set(...bearerHeader(operator.accessToken))
        .expect(200);
      const body = JSON.stringify(status.body);
      expect(body).not.toContain(planted.connectedEmail);
      expect(body).not.toContain(planted.id);

      // And the WRITE direction: `POST revoke` is the only mutation reachable without an OAuth
      // round trip, and it must not reach the office's row. The refusal is the route's own — from
      // the provider's tenancy that row does not exist — and what matters is the row afterwards.
      const revoked = await request(app.getHttpServer())
        .post('/admin/email-integration/revoke')
        .set(...bearerHeader(operator.accessToken));
      expect([404, 409, 422]).toContain(revoked.status);
      expect(JSON.stringify(revoked.body)).not.toContain(
        planted.connectedEmail,
      );

      // The office's row is untouched: still there, still ACTIVE.
      const after =
        await rawPrisma.organizationEmailIntegration.findUniqueOrThrow({
          where: { id: planted.id },
          select: { status: true },
        });
      expect(after.status).toBe('ACTIVE');
    } finally {
      await rawPrisma.organizationEmailIntegration.deleteMany({
        where: { id: planted.id },
      });
    }
  });
});

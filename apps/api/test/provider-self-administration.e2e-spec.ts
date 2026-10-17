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

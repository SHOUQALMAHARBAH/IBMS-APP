import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { createTestApp } from './utils/test-app';
import { rawPrisma } from './tenant-prisma';

/**
 * Departments and branches — THE FOUR-ACTION PILOT.
 *
 * The owner's scheme: every entity carries view / create / edit / delete as four separate codes, so
 * that a role can be given view without edit. These two are the first clean instance, and what this
 * spec pins is precisely that separability — not that the endpoints answer 2xx.
 *
 * It also pins the measured reason they could not wait: `ProvisionUserDto` REQUIRES `departmentId`
 * and `branchId`, nothing could create either, so the users screen submitted two empty strings and
 * got a 400 that reached the owner as "the create button is broken".
 */
const PASSWORD = 'OrgUnitsE2E#2026aa';
const tag = `ou${Date.now()}`;
let app: INestApplication<App> | null = null;
const bearer = (t: string) =>
  ({ Authorization: `Bearer ${t}` }) as Record<string, string>;

/**
 * Every role this file creates, so `afterAll` can remove exactly those.
 *
 * db-test is CUMULATIVE. This file leaked two roles per run for six runs before
 * `db:fixture:permissions:check` caught it: 24 roles where the seed defines 12, which makes the
 * role-permission fixture generator read TEST roles as though they were part of the seeded grid. The
 * sibling `permission-only-gates.e2e-spec.ts` carries this exact warning in a comment, which is not
 * the same as carrying the teardown.
 */
const createdRoleIds: string[] = [];

async function makeUserWith(codes: string[], label: string): Promise<string> {
  const email = `${label}.${tag}@org-units.test`;
  const org = await rawPrisma.organization.findFirstOrThrow({
    orderBy: { id: 'asc' },
  });
  const perms = await rawPrisma.permission.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  // A fixture naming a code that does not exist would silently grant nothing and make every
  // assertion below pass for the wrong reason.
  expect(perms.map((p) => p.code).sort()).toEqual([...codes].sort());

  const role = await rawPrisma.role.create({
    data: {
      organizationId: org.id,
      name: `${label.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${tag}`,
      nameEn: label,
      nameAr: label,
      requiresMfaAlways: false,
      requiresHardwareToken: false,
      permissions: {
        create: perms.map((p) => ({
          organizationId: org.id,
          permissionId: p.id,
        })),
      },
    },
  });

  createdRoleIds.push(role.id);

  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: label, email, password: PASSWORD })
    .expect(201);
  const user = await rawPrisma.user.findFirstOrThrow({ where: { email } });
  await rawPrisma.userRoleAssignment.deleteMany({ where: { userId: user.id } });
  await rawPrisma.userRoleAssignment.create({
    data: { organizationId: org.id, userId: user.id, roleId: role.id },
  });

  const login = await request(app!.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const first = (login.body as { accessToken?: string }).accessToken!;
  const enroll = await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(first))
    .send({})
    .expect(201);
  const enrolled = enroll.body as { credentialId: string; otpAuthUri: string };
  const secret = /[?&]secret=([^&]+)/.exec(enrolled.otpAuthUri)![1];
  await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(first))
    .send({
      credentialId: enrolled.credentialId,
      code: authenticator.generate(secret),
    })
    .expect(200);
  const again = await request(app!.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const challenge = await request(app!.getHttpServer())
    .post('/auth/mfa/totp/challenge/verify')
    .send({
      mfaChallengeToken: (again.body as { mfaChallengeToken: string })
        .mfaChallengeToken,
      code: authenticator.generate(secret),
    })
    .expect(200);
  return (challenge.body as { accessToken: string }).accessToken;
}

let fullToken = '';
let viewOnlyToken = '';

beforeAll(async () => {
  app = await createTestApp();
  fullToken = await makeUserWith(
    [
      'department.read',
      'department.create',
      'department.update',
      'department.deactivate',
      'branch.read',
      'branch.create',
      'branch.update',
      'branch.deactivate',
    ],
    'oufull',
  );
  // THE POINT OF THE SCHEME: view without edit. Two codes, not eight.
  viewOnlyToken = await makeUserWith(
    ['department.read', 'branch.read'],
    'ouview',
  );
}, 600_000);

afterAll(async () => {
  await app?.close();
  // Named ids, never a name pattern: a LIKE on 'OU%' would happily delete a real office's role.
  if (createdRoleIds.length > 0) {
    await rawPrisma.userRoleAssignment.deleteMany({
      where: { roleId: { in: createdRoleIds } },
    });
    await rawPrisma.rolePermission.deleteMany({
      where: { roleId: { in: createdRoleIds } },
    });
    await rawPrisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
  }

  /*
   * THE UNITS, which this file has been leaking since it was written — a PRE-EXISTING leak,
   * measured 2026-10-28: db-test held **31 departments and 47 branches** against a seed that
   * creates one of each per office, every surplus row a leftover of a previous run of this file.
   * Its sibling comment above records the ROLE leak that `db:fixture:permissions:check` caught and
   * says nothing about the units.
   *
   * SELECTED BY THE RUN TAG, DELETED BY ID. The tag is `ou${Date.now()}`, so it cannot match
   * another office's unit the way the `LIKE 'OU%'` prefix above warns about — and resolving to ids
   * first means a test that threw between its create and a push-list still gets cleaned, which a
   * hand-kept array of ids cannot promise.
   *
   * AND IT REFUSES RATHER THAN CASCADING. If anything points at one of these units the delete is
   * skipped and the reason is printed: a teardown that removed somebody else's `User` or `Employee`
   * to tidy up would be worse than the leak it is clearing.
   */
  // Written out per model rather than indexed by a `kind` variable: Prisma's delegates are
  // separately typed, so `rawPrisma[kind].findMany` is not callable under the union — `tsc` said
  // so, which is the compiler asking for the honest two branches rather than a cast.
  const deptIds = (
    await rawPrisma.department.findMany({
      where: { name: { contains: tag } },
      select: { id: true },
    })
  ).map((d) => d.id);
  if (deptIds.length > 0) {
    const pointing =
      (await rawPrisma.user.count({
        where: { departmentId: { in: deptIds } },
      })) +
      (await rawPrisma.employee.count({
        where: { departmentId: { in: deptIds } },
      }));
    if (pointing === 0) {
      await rawPrisma.department.deleteMany({ where: { id: { in: deptIds } } });
    }
  }

  const branchIds = (
    await rawPrisma.branch.findMany({
      where: { name: { contains: tag } },
      select: { id: true },
    })
  ).map((b) => b.id);
  if (branchIds.length > 0) {
    const pointing =
      (await rawPrisma.user.count({ where: { branchId: { in: branchIds } } })) +
      (await rawPrisma.employee.count({
        where: { branchId: { in: branchIds } },
      }));
    if (pointing === 0) {
      await rawPrisma.branch.deleteMany({ where: { id: { in: branchIds } } });
    }
  }
});

describe('departments and branches — the four-action pilot', () => {
  it('creates, lists, renames and retires a department, proven by reading the rows back', async () => {
    const created = await request(app!.getHttpServer())
      .post('/admin/departments')
      .set(bearer(fullToken))
      .send({ name: `Claims ${tag}`, nameAr: 'المطالبات' })
      .expect(201);
    const id = (created.body as { id: string }).id;

    const listed = await request(app!.getHttpServer())
      .get('/admin/departments')
      .set(bearer(fullToken))
      .expect(200);
    expect((listed.body as { id: string }[]).map((d) => d.id)).toContain(id);

    await request(app!.getHttpServer())
      .patch(`/admin/departments/${id}`)
      .set(bearer(fullToken))
      .send({ name: `Claims and Recoveries ${tag}` })
      .expect(200);
    const renamed = await rawPrisma.department.findUniqueOrThrow({
      where: { id },
    });
    expect(renamed.name).toBe(`Claims and Recoveries ${tag}`);
    // The Arabic half survives a name-only rename. A PATCH that cleared it would silently lose the
    // label the Arabic UI renders, and the response body would look correct either way.
    expect(renamed.nameAr).toBe('المطالبات');

    await request(app!.getHttpServer())
      .post(`/admin/departments/${id}/deactivate`)
      .set(bearer(fullToken))
      .expect(201);
    const retired = await rawPrisma.department.findUniqueOrThrow({
      where: { id },
    });
    expect(retired.deactivatedAt).not.toBeNull();

    // Gone from the picker, still in the table: delete means deactivate, and the rows that point at
    // it keep pointing at something readable.
    const after = await request(app!.getHttpServer())
      .get('/admin/departments')
      .set(bearer(fullToken))
      .expect(200);
    expect((after.body as { id: string }[]).map((d) => d.id)).not.toContain(id);
    expect(await rawPrisma.department.count({ where: { id } })).toBe(1);
  }, 300_000);

  it('gives VIEW without EDIT, which is the whole reason there are four codes', async () => {
    const created = await request(app!.getHttpServer())
      .post('/admin/branches')
      .set(bearer(fullToken))
      // `nameAr` is REQUIRED on create since 2026-10-28 (owner decision). The Arabic here is
      // the word already used by the first department create in this file plus the run tag — a
      // fixture name is not product copy and no new Arabic is typed for one; what this body has to
      // prove is only that the field is PRESENT.
      .send({ name: `Irbid ${tag}`, nameAr: `المطالبات ${tag}` })
      .expect(201);
    const id = (created.body as { id: string }).id;

    // Reads.
    await request(app!.getHttpServer())
      .get('/admin/branches')
      .set(bearer(viewOnlyToken))
      .expect(200);
    // Cannot create, rename, or retire. A single `branch.manage` umbrella could not express this,
    // which is exactly why the four umbrellas elsewhere in the catalogue are being split.
    await request(app!.getHttpServer())
      .post('/admin/branches')
      .set(bearer(viewOnlyToken))
      // A COMPLETE body, deliberately: with `nameAr` omitted this would answer 400 from the
      // DTO and the test would pass without the permission gate ever being reached — a refusal
      // test that proves the wrong refusal.
      .send({ name: `Refused ${tag}`, nameAr: `المطالبات ${tag}` })
      .expect(403);
    await request(app!.getHttpServer())
      .patch(`/admin/branches/${id}`)
      .set(bearer(viewOnlyToken))
      .send({ name: `Refused ${tag}` })
      .expect(403);
    await request(app!.getHttpServer())
      .post(`/admin/branches/${id}/deactivate`)
      .set(bearer(viewOnlyToken))
      .expect(403);
  }, 300_000);

  it('refuses an empty rename rather than reporting success and changing nothing', async () => {
    const created = await request(app!.getHttpServer())
      .post('/admin/departments')
      .set(bearer(fullToken))
      .send({ name: `Empty ${tag}`, nameAr: `المطالبات ${tag}` })
      .expect(201);
    const res = await request(app!.getHttpServer())
      .patch(`/admin/departments/${(created.body as { id: string }).id}`)
      .set(bearer(fullToken))
      .send({})
      .expect(422);
    expect((res.body as { message: string }).message).toContain('empty rename');
  }, 300_000);

  it('refuses a second LIVE unit with the same name, and frees the name once retired', async () => {
    const name = `Unique ${tag}`;
    const nameAr = `المطالبات ${tag}`;
    const first = await request(app!.getHttpServer())
      .post('/admin/departments')
      .set(bearer(fullToken))
      .send({ name, nameAr })
      .expect(201);
    // The partial UNIQUE index is the enforcement, and `db:divergence` cannot see partial indexes —
    // its measured blind spot — so the invariant is asserted here as well as in the migration's own
    // DO block.
    await request(app!.getHttpServer())
      .post('/admin/departments')
      .set(bearer(fullToken))
      .send({ name, nameAr })
      .expect(409);

    await request(app!.getHttpServer())
      .post(
        `/admin/departments/${(first.body as { id: string }).id}/deactivate`,
      )
      .set(bearer(fullToken))
      .expect(201);
    // Retiring "Claims" and later opening a new "Claims" is legitimate. Two LIVE ones are the
    // ambiguity a person cannot resolve from a dropdown.
    await request(app!.getHttpServer())
      .post('/admin/departments')
      .set(bearer(fullToken))
      .send({ name, nameAr })
      .expect(201);
  }, 300_000);

  /*
   * `nameAr` IS REQUIRED ON CREATE — owner decision, 2026-10-28.
   *
   * It was optional, and the consequence was a unit with no Arabic name on an Arabic-first
   * platform: it rendered as its Latin name to a reader who does not read it, and the office that
   * had not settled its wording was exactly the office that would never come back to it.
   *
   * Asserted ONE FIELD AT A TIME. A single request missing both names would pass while only `name`
   * was still enforced — the shape `customer.e2e-spec.ts` refuses six identifiers one at a time for.
   */
  it('refuses a create with no Arabic name, and one with no Latin name, separately', async () => {
    for (const [body, missing] of [
      [{ name: `No Arabic ${tag}` }, 'nameAr'],
      [{ nameAr: `المطالبات ${tag}` }, 'name'],
    ] as const) {
      const res = await request(app!.getHttpServer())
        .post('/admin/departments')
        .set(bearer(fullToken))
        .send(body)
        .expect(400);
      expect(JSON.stringify(res.body)).toContain(missing);
    }
  }, 300_000);

  /*
   * BRINGING A RETIRED UNIT BACK — the route that did not exist, and the read that made it
   * unreachable.
   *
   * Eight administration routes and no reactivate, while both list reads filtered
   * `deactivatedAt: null` — so a retired unit vanished from the only screen that could show it and
   * the only way back was a hand-written UPDATE. `Role` has had `POST /roles/:id/reactivate` since
   * Phase 3 and `rbac.controller.ts` states the reason: hiding retired roles "would leave an office
   * unable to reactivate one". Measured when this shipped, db-test held TWO retired departments in
   * exactly that state.
   *
   * FOUR PROPERTIES IN ONE WALK, because they are one capability and a test per line would let the
   * route exist while the read that reaches it does not:
   *   (a) reactivating a LIVE unit is REFUSED rather than reported as a no-op;
   *   (b) a retired unit is ABSENT from the default read and PRESENT under `?includeRetired=true`,
   *       carrying `retiredAt` so a screen can tell it apart — without this the route is dead;
   *   (c) reactivating puts it back in the DEFAULT read with `retiredAt: null`;
   *   (d) reactivating onto a name a live unit has since taken is a 409, not a 500 — the partial
   *       unique index is the enforcement and `asNameCollision` is what makes it readable.
   *
   * The ORDER is load-bearing: (d) has to come last, because taking the freed name before (c) would
   * make the successful revival unreachable and the test would silently cover three of four.
   */
  it('brings a retired department back, and refuses the two ways that must not work', async () => {
    const name = `Revived ${tag}`;
    const nameAr = `المطالبات ${tag}`;
    const created = await request(app!.getHttpServer())
      .post('/admin/departments')
      .set(bearer(fullToken))
      .send({ name, nameAr })
      .expect(201);
    const id = (created.body as { id: string }).id;
    expect((created.body as { retiredAt: string | null }).retiredAt).toBeNull();

    // (a) While it is still live. A no-op 200 here would make an administrator believe they had
    // changed something.
    const tooSoon = await request(app!.getHttpServer())
      .post(`/admin/departments/${id}/reactivate`)
      .set(bearer(fullToken))
      .expect(422);
    expect((tooSoon.body as { message: string }).message).toContain(
      'nothing to bring back',
    );

    await request(app!.getHttpServer())
      .post(`/admin/departments/${id}/deactivate`)
      .set(bearer(fullToken))
      .expect(201);

    // (b) Absent by default, present when asked for, and distinguishable.
    const live = await request(app!.getHttpServer())
      .get('/admin/departments')
      .set(bearer(fullToken))
      .expect(200);
    expect((live.body as { id: string }[]).map((d) => d.id)).not.toContain(id);

    const withRetired = await request(app!.getHttpServer())
      .get('/admin/departments?includeRetired=true')
      .set(bearer(fullToken))
      .expect(200);
    const row = (
      withRetired.body as { id: string; retiredAt: string | null }[]
    ).find((d) => d.id === id);
    expect(
      row,
      'the retired unit must be reachable, or nothing can revive it',
    ).toBeDefined();
    expect(row!.retiredAt).not.toBeNull();

    // (c) Back in service, and back in the DEFAULT read — the half a screen actually consumes.
    const revived = await request(app!.getHttpServer())
      .post(`/admin/departments/${id}/reactivate`)
      .set(bearer(fullToken))
      .expect(201);
    expect((revived.body as { retiredAt: string | null }).retiredAt).toBeNull();
    const liveAgain = await request(app!.getHttpServer())
      .get('/admin/departments')
      .set(bearer(fullToken))
      .expect(200);
    expect((liveAgain.body as { id: string }[]).map((d) => d.id)).toContain(id);

    // (d) Retire it, let another unit take the name, and the revival must now collide.
    await request(app!.getHttpServer())
      .post(`/admin/departments/${id}/deactivate`)
      .set(bearer(fullToken))
      .expect(201);
    await request(app!.getHttpServer())
      .post('/admin/departments')
      .set(bearer(fullToken))
      .send({ name, nameAr })
      .expect(201);
    const collision = await request(app!.getHttpServer())
      .post(`/admin/departments/${id}/reactivate`)
      .set(bearer(fullToken))
      .expect(409);
    expect((collision.body as { message: string }).message).toContain(name);
  }, 300_000);
});

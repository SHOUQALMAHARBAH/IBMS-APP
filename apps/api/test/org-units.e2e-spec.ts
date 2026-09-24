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
      .send({ name: `Irbid ${tag}` })
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
      .send({ name: `Refused ${tag}` })
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
      .send({ name: `Empty ${tag}` })
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
    const first = await request(app!.getHttpServer())
      .post('/admin/departments')
      .set(bearer(fullToken))
      .send({ name })
      .expect(201);
    // The partial UNIQUE index is the enforcement, and `db:divergence` cannot see partial indexes —
    // its measured blind spot — so the invariant is asserted here as well as in the migration's own
    // DO block.
    await request(app!.getHttpServer())
      .post('/admin/departments')
      .set(bearer(fullToken))
      .send({ name })
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
      .send({ name })
      .expect(201);
  }, 300_000);
});

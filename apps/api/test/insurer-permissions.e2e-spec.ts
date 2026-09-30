import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';
import { makeInsurer, makeLocalInsurer } from './insurer-fixture';

/**
 * Insurer management, commit 4 — the two new codes, and the gate that moved.
 *
 * ## `GET /rfqs/selectable-insurers` had no test at all
 *
 * Nothing in the e2e suite covered it — there is no `rfq.e2e-spec.ts` — so this
 * file is that endpoint's first coverage. Worth stating because it is the same
 * shape as the two defects the RBAC work found: `/settings/users` survived a
 * half-migrated API because nothing exercised it, and `Insurer.isActive` has been
 * inert since the column was created because nothing read it.
 *
 * ## Why the gate moved off `rfq.create`
 *
 * The endpoint reads the office's OWN insurer rows. `rfq.create` is held by the
 * Placement Officer alone, so a Manager or Compliance Officer who may read an
 * insurer could not ask which insurers exist — a shortcut from when the RFQ
 * create screen was the list's only consumer. `insurer.read` is the permission
 * that governs those rows, so it is the gate.
 *
 * That is a WIDENING for five roles and a narrowing for nobody: Placement holds
 * both codes, and the endpoint returns names and a financial-strength note, not
 * credit terms.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const tag = Math.random().toString(36).slice(2, 8);

/**
 * FIXED prefix, swept at BOTH ends.
 *
 * One test builds a custom role to prove the picker's gate is `insurer.read` and
 * not "either of the two codes". Cleaning that up at the end of the test body is
 * not enough: an assertion failure skips it, which is exactly what happened while
 * planting the old gate — the role leaked and broke the web-grid regeneration,
 * which counts the office's roles. Same fix as the Phase 3 hollow-role fixture.
 */
const FIXTURE_ROLE_PREFIX = 'RFQ Creator Only';

/** Insurers this file creates. They exist only to be listed by the picker, so they
 *  have no policies or quotations and can be removed outright — unlike the invoice
 *  spec's, which sit under a deliberately-retained policy chain. */
const FIXTURE_INSURER_PREFIX = 'Perms ';

async function removeFixtureInsurers(): Promise<void> {
  const insurers = await prisma.insurer.findMany({
    where: { legalName: { startsWith: FIXTURE_INSURER_PREFIX } },
    select: { id: true },
  });
  if (insurers.length === 0) return;
  const ids = insurers.map((i) => i.id);
  await prisma.insurerProduct.deleteMany({ where: { insurerId: { in: ids } } });
  await prisma.insurer.deleteMany({ where: { id: { in: ids } } });
}

async function removeFixtureRoles(): Promise<void> {
  const roles = await prisma.role.findMany({
    where: { name: { startsWith: FIXTURE_ROLE_PREFIX } },
    select: { id: true },
  });
  if (roles.length === 0) return;
  const roleIds = roles.map((r) => r.id);
  await prisma.userRoleAssignment.deleteMany({
    where: { roleId: { in: roleIds } },
  });
  await prisma.rolePermission.deleteMany({
    where: { roleId: { in: roleIds } },
  });
  await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
}

interface SelectableInsurer {
  id: string;
  name: string;
  nameAr: string | null;
  financialStrengthRating: string | null;
}

let app: INestApplication<App> | null = null;

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function makeUser(
  label: string,
  ...roleNames: string[]
): Promise<{ accessToken: string; userId: string }> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Insurer Perms ${label}`, email, password: PASSWORD })
    .expect(201);
  const login = await request(app!.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = login.body as { accessToken: string; user: { id: string } };

  const enroll = await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(body.accessToken))
    .expect(201);
  const enrollBody = enroll.body as {
    credentialId: string;
    otpAuthUri: string;
  };
  const secret = /[?&]secret=([^&]+)/.exec(enrollBody.otpAuthUri)![1];
  await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(body.accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secret),
    })
    .expect(200);

  for (const name of roleNames) {
    const role = await ensureRole(name);
    const active = await prisma.userRoleAssignment.findFirst({
      where: { userId: body.user.id, roleId: role.id, revokedAt: null },
    });
    if (!active) {
      await prisma.userRoleAssignment.create({
        data: { userId: body.user.id, roleId: role.id },
      });
    }
  }
  return { accessToken: body.accessToken, userId: body.user.id };
}

beforeAll(async () => {
  app = await createTestApp();
  // Whatever a failed or killed run left behind, before anything asserts on it.
  await removeFixtureRoles();
  await removeFixtureInsurers();
}, 240_000);

afterAll(async () => {
  await removeFixtureRoles();
  await removeFixtureInsurers();
  await app?.close();
  app = null;
});

describe('insurer.read gates the shortlist picker', () => {
  it('lets every role that PICKS an insurer list them — not just the one that creates RFQs', async () => {
    // The five roles that gained access, plus Placement which already had it
    // through `rfq.create`. Each must get a 200 and a real list, because the point
    // of the move is that they can now ask the question at all.
    const linked = await makeInsurer(`${FIXTURE_INSURER_PREFIX}Linked ${tag}`);
    const local = await makeLocalInsurer(
      `${FIXTURE_INSURER_PREFIX}Local ${tag}`,
    );

    for (const roleName of [
      'SALES_RELATIONSHIP_OFFICER',
      'PLACEMENT_TECHNICAL_OFFICER',
      'BRANCH_DEPARTMENT_MANAGER',
      'EXECUTIVE_MANAGEMENT',
      'COMPLIANCE_OFFICER',
      'EXTERNAL_AUDITOR',
    ]) {
      const actor = await makeUser(
        `ins-read-${roleName.slice(0, 8)}-${tag}`,
        roleName,
      );
      const res = await request(app!.getHttpServer())
        .get('/rfqs/selectable-insurers')
        .set(bearer(actor.accessToken))
        .expect(200);
      const names = (res.body as SelectableInsurer[]).map((i) => i.name);
      expect(
        names,
        `${roleName} holds insurer.read and must be able to list insurers`,
      ).toContain(linked.name);
      // And an office-local insurer is in the same list, named from its own row —
      // the identity coalesce, proven through HTTP rather than only in a unit test.
      expect(names).toContain(local.name);
    }
  }, 300_000);

  it('refuses a role that holds neither insurer.read nor rfq.create', async () => {
    // The Claims Officer picks no insurers. Before this the gate was `rfq.create`
    // and it refused them too, so this is the half of the change that did NOT move.
    const claims = await makeUser(`ins-read-claims-${tag}`, 'CLAIMS_OFFICER');
    await request(app!.getHttpServer())
      .get('/rfqs/selectable-insurers')
      .set(bearer(claims.accessToken))
      .expect(403);
  }, 300_000);

  it('refuses a custom role holding rfq.create but NOT insurer.read', async () => {
    // The gate really is `insurer.read` and not "either of the two". A role an
    // office could build with the old permission gets nothing — which is what
    // makes this a moved gate rather than an added alternative.
    const roleName = `${FIXTURE_ROLE_PREFIX} ${tag}`;
    const role = await ensureRole(roleName);
    const rfqCreate = await prisma.permission.findUniqueOrThrow({
      where: { code: 'rfq.create' },
    });
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: role.id, permissionId: rfqCreate.id },
      },
      update: {},
      create: { roleId: role.id, permissionId: rfqCreate.id },
    });
    const actor = await makeUser(`ins-read-rfqonly-${tag}`, roleName);

    await request(app!.getHttpServer())
      .get('/rfqs/selectable-insurers')
      .set(bearer(actor.accessToken))
      .expect(403);

    // `afterAll` sweeps by prefix as well — this is the tidy path, not the only
    // one, because the assertion above would skip it on failure.
    await removeFixtureRoles();
  }, 300_000);
});

describe('the insurer relationship codes sit on the office administrator', () => {
  /** `insurer.relationship.manage` became these five in four-action Phase 1. */
  const RELATIONSHIP_CODES = [
    'insurer.create',
    'insurer.update',
    'insurer.deactivate',
    'insurance-line.create',
    'insurance-line.update',
  ] as const;

  it('are held by OFFICE_ADMINISTRATOR and by no other seeded role', async () => {
    // The capability deferred from Phase 3 so it would land after the administrator migration rather than
    // invalidate its empty-diff property. Asserted against the DATABASE rather than the seed source,
    // because the seed is what the grid says and this is what the office actually has.
    //
    // Every successor is checked, not one of them: the point of splitting the umbrella is that the five
    // can now be granted apart, so a test naming only one would stop noticing if the other four drifted.
    for (const code of RELATIONSHIP_CODES) {
      const holders = await prisma.role.findMany({
        where: { permissions: { some: { permission: { code } } } },
        select: { name: true },
        orderBy: { name: 'asc' },
      });
      expect(
        holders.map((r) => r.name),
        code,
      ).toEqual(['OFFICE_ADMINISTRATOR']);
    }
  }, 120_000);

  it('reaches the office administrator as a PAIR — the write is useless without the read', async () => {
    // Both codes, deliberately, and this was corrected during review rather than
    // discovered later.
    //
    // The management screen's own design is "insurer.read renders it, and each write code turns its own
    // control on". An administrator holding only the writes would get controls on a screen that renders
    // nothing — you cannot manage records you cannot list. The exact precedent is the Phase 3 pair:
    // `OFFICE_ADMINISTRATOR` holds `role.read` alongside the role write codes, and the Role screen is
    // built on that same split.
    //
    // Asserted through `/auth/me` rather than against the grid, because what matters
    // is what a session actually resolves.
    const role = await prisma.role.findFirstOrThrow({
      where: { name: 'OFFICE_ADMINISTRATOR' },
      select: { id: true },
    });
    const admin = await makeUser(`ins-oa-${tag}`);
    await prisma.userRoleAssignment.create({
      data: { userId: admin.userId, roleId: role.id },
    });

    const me = await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer(admin.accessToken))
      .expect(200);
    const permissions = (me.body as { permissions: string[] }).permissions;
    for (const code of RELATIONSHIP_CODES) {
      expect(permissions, code).toContain(code);
    }
    expect(permissions).toContain('insurer.read');

    // And it can therefore use the read — proven on the one office-insurer read
    // that exists today, rather than only on the grid.
    await request(app!.getHttpServer())
      .get('/rfqs/selectable-insurers')
      .set(bearer(admin.accessToken))
      .expect(200);

    // The pair does NOT extend to the global catalogue's write side. Registering an
    // office insurer must not become a way to change what every other office sees.
    expect(permissions).not.toContain('insurer.form.map');
    expect(permissions).not.toContain('insurer.master.manage');
  }, 300_000);

  it('does not grant the global catalogue — `insurer.master.manage` does not exist, and form mapping is separate', async () => {
    // Registering an office insurer must not become a way to write the shared
    // catalogue. `insurer.master.manage` is not in the grid at all, and
    // `insurer.form.map` — whose effect crosses offices — is held by Placement and
    // the legacy administrator, never by the office administrator.
    const codes = await prisma.permission.findMany({
      where: { code: { in: ['insurer.master.manage', 'insurer.form.map'] } },
      select: { code: true },
    });
    expect(
      codes.map((c) => c.code),
      'insurer.master.manage must not exist; insurer.form.map must',
    ).toEqual(['insurer.form.map']);

    const formMapHolders = await prisma.role.findMany({
      where: {
        permissions: { some: { permission: { code: 'insurer.form.map' } } },
      },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    expect(formMapHolders.map((r) => r.name)).not.toContain(
      'OFFICE_ADMINISTRATOR',
    );
  }, 120_000);
});

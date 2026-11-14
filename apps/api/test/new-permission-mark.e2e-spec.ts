import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * OWNER DECISION 131 § 6 — CRITERIA 3 AND 4, OVER REAL HTTP.
 *
 * «إحنا بنطلّع كل صلاحيات النظام بالمصفوفة وما بنعطي ولا وحدة لحدا؛ الصلاحية الجديدة بتنزل معلَّمة
 * بالأخضر إنها جديدة ويوصل إشعار للأدمن، وهو بيقرر لمين يعطيها وعلى أي دور.»
 *
 *   CRITERION 3  the mark appears in the office's matrix, and the notification reaches the holder
 *                of the permission that gates the matrix — and nobody else.
 *   CRITERION 4  the administrator grants it ⟶ the mark clears. Or rules on it without granting
 *                ⟶ the mark clears too. «يعطيها لدور، أو يقرّر فيها».
 *
 * Criteria 1, 2 and 5 are proven elsewhere and are NOT restated here: 1 lives with the catalogue
 * in `packages/db/prisma/seed-data/permissions.spec.ts`, and 2 and 5 in
 * `src/modules/provider/decision-131-criteria.spec.ts`. One home per assertion.
 *
 * ## 🔴 WHAT THE «IN THEIR OFFICE ALONE» HALF OF CRITERION 4 RESTS ON, STATED RATHER THAN FAKED
 *
 * An HTTP assertion CANNOT prove tenant isolation — `tenantScopeExtension` puts `organizationId`
 * into the query before the database is asked, so the database never gets the chance to refuse.
 * That was measured on 2026-11-11 with a `USING (true)` plant that left a spec at 10/10 green.
 *
 * So the isolation half is asserted the only way it can be: through `asAppRole`, on
 * `APP_DATABASE_URL` — the same non-owner connection the API itself uses — with the FIRST
 * assertion being that the connection is not exempt. Rule 12: the presence of what the proof
 * needs, never the absence of what it fears.
 *
 * ⛔ AND NO SECOND BROKERAGE OFFICE IS CREATED. `soleOrganizationIdOrThrow` refuses `POST
 * /auth/signup` the moment a second one exists, and 114 of 128 api e2e specs sign up. The second
 * tenant CONTEXT is the PROVIDER organization, which already exists on both databases and is not
 * a brokerage office — so the cross-tenant read is real and nothing else in the suite moves.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = Math.random().toString(36).slice(2, 8);

/** A code nobody else uses. db-test is cumulative, so every assertion here is about rows THIS
 *  run created — a leftover must not be able to make one pass or fail. */
const PROBE_CODE = `zz.decision-131-probe.${RUN}`;

/** The app role's own connection — the one RLS actually applies to. */
const APP_DB_URL =
  process.env.APP_DATABASE_URL ??
  'postgresql://ibms_app:ibms_app_dev@localhost:5434/ibms_test?schema=public';

const OFFICE_ID = '00000000-0000-0000-0000-000000000001';
const PROVIDER_ID = '00000000-0000-0000-0000-0000000000f0';

let app: INestApplication<App> | null = null;
let admin: { accessToken: string; userId: string };
let outsider: { accessToken: string; userId: string };
let probePermissionId: string | null = null;
let grantableRoleId: string | null = null;
const createdRoleIds: string[] = [];
const createdUserIds: string[] = [];

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

interface CatalogueRow {
  id: string;
  code: string;
  isNew: boolean;
}
interface NotificationItem {
  kind: string;
  count: number;
  href: string;
  newPermissions?: { code: string; screen: string | null; routes: string[] }[];
}

async function makeUser(
  label: string,
  roleId: string,
): Promise<{ accessToken: string; userId: string }> {
  const email = `${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}@ibms.test`;
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Decision 131 ${label}`, email, password: PASSWORD })
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
  const secret = decodeURIComponent(
    /[?&]secret=([^&]+)/.exec(enrollBody.otpAuthUri)![1],
  );
  await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(body.accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secret),
    })
    .expect(200);

  await prisma.userRoleAssignment.create({
    data: { userId: body.user.id, roleId },
  });
  createdUserIds.push(body.user.id);
  return { accessToken: body.accessToken, userId: body.user.id };
}

async function seedRole(name: string, codes: string[]): Promise<string> {
  const role = await prisma.role.create({
    data: {
      name,
      nameEn: name,
      nameAr: name,
      requiresMfaAlways: false,
      requiresHardwareToken: false,
      isSystem: false,
    },
  });
  createdRoleIds.push(role.id);
  if (codes.length > 0) {
    const permissions = await prisma.permission.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    expect(permissions.map((p) => p.code).sort()).toEqual([...codes].sort());
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
  }
  return role.id;
}

/** A read on the connection RLS actually applies to, in the given tenant context. */
async function asAppRole<T>(
  organizationId: string | null,
  sql: string,
): Promise<T[]> {
  const { PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient({ datasources: { db: { url: APP_DB_URL } } });
  try {
    return await client.$transaction(async (tx) => {
      if (organizationId !== null) {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.current_org_id', '${organizationId}', true)`,
        );
      }
      return await tx.$queryRawUnsafe(sql);
    });
  } finally {
    await client.$disconnect();
  }
}

async function catalogue(token: string): Promise<CatalogueRow[]> {
  const res = await request(app!.getHttpServer())
    .get('/rbac/permissions')
    .set(bearer(token))
    .expect(200);
  return res.body as CatalogueRow[];
}

async function notifications(token: string): Promise<NotificationItem[]> {
  const res = await request(app!.getHttpServer())
    .get('/notifications')
    .set(bearer(token))
    .expect(200);
  return (res.body as { items: NotificationItem[] }).items;
}

beforeAll(async () => {
  app = await createTestApp();

  /*
   * THE PROBE CODE, STAMPED AFTER THE OFFICE WAS CREATED.
   *
   * Condition 1 of the mark is `introducedAt > office.createdAt`. Using NOW makes that true for
   * every office on any database, so this spec does not depend on when db-test was seeded — which
   * is the kind of hidden assumption that makes a test pass on one machine and not another.
   *
   * ⛔ `Permission` is GLOBAL and this row is visible to every office, so it is deleted in
   * `afterAll`. A leftover probe code moves the catalogue total, which four specs and a generated
   * fixture pin.
   */
  const probe = await prisma.permission.create({
    data: {
      code: PROBE_CODE,
      module: 'compliance-risk',
      description: 'A probe for OWNER DECISION 131 criteria 3 and 4.',
      scope: 'OFFICE',
      introducedAt: new Date(),
    },
  });
  probePermissionId = probe.id;

  const adminRole = await seedRole(`Decision131 Admin ${RUN}`, [
    'role.read',
    'role.create',
    'role.update',
    'permission.read',
  ]);
  // A reader who can SEE the matrix but cannot edit it. The notification must not reach them:
  // being told to decide something you cannot act on is noise, and this file's own rule is that
  // you are only notified about work you could already open.
  const outsiderRole = await seedRole(`Decision131 Outsider ${RUN}`, [
    'permission.read',
  ]);
  // The role the administrator will grant the probe code TO, in criterion 4.
  grantableRoleId = await seedRole(`Decision131 Target ${RUN}`, []);

  admin = await makeUser(`d131-admin-${RUN}`, adminRole);
  outsider = await makeUser(`d131-outsider-${RUN}`, outsiderRole);
}, 240_000);

afterAll(async () => {
  await app?.close();
  app = null;

  // db-test is cumulative. EVERY row this spec wrote comes out, and the probe permission most of
  // all: it is global, so a leftover would be visible to every office and would move the
  // catalogue total that `provider-self-administration.e2e-spec.ts` pins.
  if (probePermissionId) {
    await prisma.officePermissionDismissal.deleteMany({
      where: { permissionId: probePermissionId },
    });
    await prisma.rolePermission.deleteMany({
      where: { permissionId: probePermissionId },
    });
  }
  if (createdUserIds.length > 0) {
    await prisma.userRoleAssignment.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
  }
  if (createdRoleIds.length > 0) {
    await prisma.rolePermission.deleteMany({
      where: { roleId: { in: createdRoleIds } },
    });
    await prisma.userRoleAssignment.deleteMany({
      where: { roleId: { in: createdRoleIds } },
    });
    await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
  }
  if (probePermissionId) {
    await prisma.permission.delete({ where: { id: probePermissionId } });
  }

  // And prove the cleanup worked, rather than assuming it. A probe permission left behind is the
  // residue that breaks four other specs' totals.
  const left = await prisma.permission.count({ where: { code: PROBE_CODE } });
  if (left !== 0) {
    throw new Error(
      `decision 131: ${left} probe permission row(s) survived afterAll — db-test is cumulative ` +
        `and a leftover global code moves the catalogue total that four specs pin.`,
    );
  }
}, 120_000);

describe('OWNER DECISION 131 § 6 — criteria 3 and 4, end to end', () => {
  it('CRITERION 3 — the code lands MARKED «جديدة» in the office matrix', async () => {
    /*
     * «الصلاحية الجديدة بتنزل معلَّمة بالأخضر إنها جديدة.»
     *
     * The three conditions all hold for the probe: it arrived after the office was created, no
     * role here holds it, and nobody here has ruled on it. The word and the colour are the web's;
     * what the api owes is the flag, per office.
     */
    const rows = await catalogue(admin.accessToken);
    const probe = rows.find((r) => r.code === PROBE_CODE);
    expect(
      probe,
      'the probe code is not in the catalogue the matrix reads',
    ).toBeDefined();
    expect(probe!.isNew).toBe(true);

    /*
     * AND NOTHING IS MARKED THAT SHOULD NOT BE, which is what makes the mark worth anything.
     *
     * ⚠️ ASSERTED AS THE INVARIANT RATHER THAN AS A FIXED LIST OF CODES, deliberately. The first
     * version named the two `legal-value.*` codes — correct on a freshly seeded database and
     * WRONG on one seeded before they gained an arrival date, which is exactly how it failed
     * first time here. A list of codes is a statement about one database's seed state; the
     * property is a statement about the rule.
     *
     * The rule: a marked code carries an arrival date LATER than this office's own `createdAt`.
     * If a code with no date is ever marked, condition 1 has broken and every office is about to
     * meet its entire catalogue as new — which is the failure the mark is designed around.
     */
    const marked = rows.filter((r) => r.isNew).map((r) => r.code);
    expect(marked).toContain(PROBE_CODE);

    const office = await prisma.organization.findUniqueOrThrow({
      where: { id: OFFICE_ID },
      select: { createdAt: true },
    });
    const markedRows = await prisma.permission.findMany({
      where: { code: { in: marked } },
      select: { code: true, introducedAt: true },
    });
    for (const row of markedRows) {
      expect(
        row.introducedAt,
        `${row.code} is marked «جديدة» with NO arrival date. Condition 1 has broken: every code ` +
          'that predates the mark would now be marked in every office.',
      ).not.toBeNull();
      expect(
        row.introducedAt!.getTime(),
        `${row.code} is marked but arrived before this office was created`,
      ).toBeGreaterThan(office.createdAt.getTime());
    }
  });

  it('CRITERION 3 — the notification reaches the holder of role.update, and nobody else', async () => {
    /*
     * «ويوصل إشعار للأدمن» — to the holder of a PERMISSION, never a role name. `role.update`
     * gates `PUT /rbac/roles/:id/permissions`, which is the matrix itself, so the recipients are
     * exactly the people who can act on what they are told.
     */
    const forAdmin = await notifications(admin.accessToken);
    const item = forAdmin.find((i) => i.kind === 'new_permission');
    expect(
      item,
      'the administrator was not told a permission arrived',
    ).toBeDefined();
    expect(item!.href, 'the link must go where the decision is made').toBe(
      '/settings/roles',
    );
    expect(item!.newPermissions?.map((p) => p.code)).toContain(PROBE_CODE);

    // The other direction. A reader who can SEE the matrix (`permission.read`) but cannot EDIT it
    // is told nothing: they could not grant it, and a notification they cannot act on is noise.
    const forOutsider = await notifications(outsider.accessToken);
    expect(
      forOutsider.map((i) => i.kind),
      'a reader without role.update was told to decide something they cannot grant',
    ).not.toContain('new_permission');
  });

  it('CRITERION 3 — the notification says what the code controls, or names the route', async () => {
    /*
     * «تتحكّم في: [الشاشة أو الزر]» — decision 133's third slot.
     *
     * The probe guards no route and no screen, so it carries neither — and it is STILL in the
     * notification. That is the deliberate choice in `noticeFor`: dropping a code because its
     * controls are unknown would mean an administrator is never told it exists, and under
     * decision 131 nothing is granted, so the notification is the only way anyone learns.
     */
    const item = (await notifications(admin.accessToken)).find(
      (i) => i.kind === 'new_permission',
    );
    const probe = item!.newPermissions!.find((p) => p.code === PROBE_CODE);
    expect(probe).toBeDefined();
    expect(probe!.screen).toBeNull();
    expect(probe!.routes).toEqual([]);

    // And a code that DOES declare its controls carries them, so the slot is not dead.
    const declared = item!.newPermissions!.find(
      (p) => p.code === 'legal-value.declare',
    );
    expect(declared?.routes).toEqual(['POST /legal-values']);
  });

  it('CRITERION 4 — granting it to a role clears the mark', async () => {
    /*
     * «الأدمن يمنحها لدور ⟵ تزول العلامة.» The grant IS the clearing fact — there is no second
     * record of the decision, which is why the shape holds a DISMISSAL and never a grant.
     *
     * Driven through the real route the administrator uses, so this also proves the mark is
     * computed live rather than cached: `findAllForOffice` is deliberately not cached, and a
     * 60-second TTL here would show the mark still on a code they had just decided.
     */
    await request(app!.getHttpServer())
      .put(`/rbac/roles/${grantableRoleId}/permissions`)
      .set(bearer(admin.accessToken))
      .send({ permissionCodes: [PROBE_CODE] })
      .expect(200);

    const probe = (await catalogue(admin.accessToken)).find(
      (r) => r.code === PROBE_CODE,
    );
    expect(
      probe!.isNew,
      'the code is granted to a role in this office and is still marked as undecided',
    ).toBe(false);

    // And it leaves the bell in the same breath — the item is derived from the same rule.
    const item = (await notifications(admin.accessToken)).find(
      (i) => i.kind === 'new_permission',
    );
    expect(item?.newPermissions?.map((p) => p.code) ?? []).not.toContain(
      PROBE_CODE,
    );
  });

  it('CRITERION 4 — and ruling on it WITHOUT granting clears it too', async () => {
    /*
     * «أو يقرّر فيها» — the second way she named. The administrator looked and chose not to
     * grant. That is the one state nothing else in the schema records, which is the whole reason
     * `OfficePermissionDismissal` exists.
     *
     * The grant from the previous test is revoked first, so this proves the DISMISSAL clears the
     * mark rather than inheriting the grant's clearing.
     */
    await request(app!.getHttpServer())
      .put(`/rbac/roles/${grantableRoleId}/permissions`)
      .set(bearer(admin.accessToken))
      .send({ permissionCodes: [] })
      .expect(200);

    const beforeDismissal = (await catalogue(admin.accessToken)).find(
      (r) => r.code === PROBE_CODE,
    );
    expect(
      beforeDismissal!.isNew,
      'revoking the grant must bring the mark back — otherwise the previous test proved nothing',
    ).toBe(true);

    await request(app!.getHttpServer())
      .post(`/rbac/permissions/${encodeURIComponent(PROBE_CODE)}/dismiss`)
      .set(bearer(admin.accessToken))
      .expect(201);

    const afterDismissal = (await catalogue(admin.accessToken)).find(
      (r) => r.code === PROBE_CODE,
    );
    expect(afterDismissal!.isNew).toBe(false);
  });

  it('CRITERION 4 — a reader who cannot edit the matrix cannot dismiss either', async () => {
    // The route carries `role.update`, the same code that gates the matrix. Without it, 403 —
    // otherwise anybody with read access could clear a mark the administrator has not seen.
    await request(app!.getHttpServer())
      .post(`/rbac/permissions/${encodeURIComponent(PROBE_CODE)}/dismiss`)
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('CRITERION 4 — «in their office alone» is the DATABASE refusing, not a filter', async () => {
    /*
     * 🔴 FIRST, THE CONNECTION. An RLS assertion made through this suite's own client proves
     * NOTHING: `ibms` is a superuser with BYPASSRLS on db-test, which bypasses even FORCE. So
     * this travels on `APP_DATABASE_URL` and asserts, before anything else, that the connection
     * it travels on is not exempt.
     */
    const who = await asAppRole<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      null,
      `SELECT current_user, r.rolsuper, r.rolbypassrls
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(who).toHaveLength(1);
    expect(
      who[0].rolsuper,
      'the connection these refusals travel on is a SUPERUSER, so it bypasses RLS and every ' +
        'assertion below is hollow — point APP_DATABASE_URL at the application role',
    ).toBe(false);
    expect(who[0].rolbypassrls).toBe(false);

    const count = async (org: string | null) =>
      Number(
        (
          await asAppRole<{ n: bigint }>(
            org,
            `SELECT count(*) AS n FROM "OfficePermissionDismissal" d
               JOIN "Permission" p ON p.id = d."permissionId"
              WHERE p.code = '${PROBE_CODE}'`,
          )
        )[0].n,
      );

    // The office that made the ruling sees its own row.
    expect(await count(OFFICE_ID)).toBe(1);
    // A DIFFERENT tenant sees zero — the row is invisible, not filtered. The provider
    // organization is used because it already exists and is NOT a brokerage office, so creating
    // a second tenant context costs nothing and `POST /auth/signup` keeps working for the other
    // 114 specs.
    expect(
      await count(PROVIDER_ID),
      "another organization can read this office's decision — criterion 5 is broken",
    ).toBe(0);
    // And with no tenant context at all, zero. A missing GUC must not read as "see everything".
    expect(await count(null)).toBe(0);
  });
});

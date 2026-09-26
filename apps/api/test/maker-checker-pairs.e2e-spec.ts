import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';
import { MAKER_CHECKER_REGISTRY } from '../src/common/maker-checker-pairs.config';

/**
 * THE REGISTRY IS WHAT THE DATABASE ENFORCES — derived, not declared twice.
 *
 * Four lists of maker/checker pairs existed in this repository at once, and three disagreed:
 *
 *   MAKER_CHECKER_REGISTRY       15 — correct, and nothing checked it
 *   the database                 15 CHECK constraints
 *   checker-roles.config.ts      13 checker permissions (both NeedsAssessment pairs missing)
 *   maker-checker.util.ts        11 rows in a header comment (four missing)
 *
 * The complete one had never been compared to the database. Nothing would have noticed a sixteenth
 * constraint being added, a fifteenth being dropped, or a name changing — and Part 4's mode depends on this
 * list being exactly the set of constraints it has to make conditional.
 *
 * So this derives the expected set from `pg_constraint` and compares NAMES both ways. It is an e2e rather
 * than a unit test for the obvious reason: the claim is about the database.
 */
const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = Math.random().toString(36).slice(2, 10);

interface ConstraintRow {
  conname: string;
}

let app: INestApplication<App>;

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('maker/checker pairs (e2e)', () => {
  beforeAll(async () => {
    app = await createTestApp();
  }, 300_000);

  afterAll(async () => {
    await app?.close();
  });

  it('names EXACTLY the maker/checker CHECK constraints the database has', async () => {
    const rows = await prisma.$queryRawUnsafe<ConstraintRow[]>(`
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE con.contype = 'c'
        AND ns.nspname = 'public'
        AND con.conname LIKE '%maker_checker_distinct%'
      ORDER BY con.conname
    `);
    const inDatabase = rows.map((r) => r.conname).sort();
    const inRegistry = MAKER_CHECKER_REGISTRY.map((p) => p.dbCheckConstraint)
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort();

    // Both directions, named rather than counted: a failure says WHICH constraint drifted.
    expect(
      inRegistry,
      'the registry and the database disagree about which maker/checker pairs exist — see docs/duty-segregation-mode.md, Part 4 depends on this list being exact',
    ).toEqual(inDatabase);
    // And it is not vacuously empty, which is how an "assert the whole set" test passes for the wrong
    // reason.
    expect(inDatabase.length).toBeGreaterThan(10);
  }, 120_000);

  it('every pair names a checker permission that exists in the catalogue', async () => {
    // A code that does not exist would make the readiness row say NOBODY for ever and put a permission
    // nobody can hold into a refusal message.
    const codes = [
      ...new Set(MAKER_CHECKER_REGISTRY.map((p) => p.checkerPermission)),
    ];
    const found = await prisma.permission.findMany({
      where: { code: { in: codes } },
      select: { code: true },
    });
    expect(found.map((p) => p.code).sort()).toEqual([...codes].sort());
  }, 120_000);

  it('answers which operations this office cannot complete, and refuses the list to a reader without role.read', async () => {
    const email = `mcp-${RUN}@pairs.test`;
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ fullName: 'Pairs Reader', email, password: PASSWORD })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const { accessToken, user } = login.body as {
      accessToken: string;
      user: { id: string };
    };
    const enroll = await request(app.getHttpServer())
      .post('/auth/mfa/totp/enroll')
      .set(bearer(accessToken))
      .expect(201);
    const eb = enroll.body as { credentialId: string; otpAuthUri: string };
    await request(app.getHttpServer())
      .post('/auth/mfa/totp/enroll/verify')
      .set(bearer(accessToken))
      .send({
        credentialId: eb.credentialId,
        code: authenticator.generate(
          /[?&]secret=([^&]+)/.exec(eb.otpAuthUri)![1],
        ),
      })
      .expect(200);

    // Without `role.read` the list is refused — it describes the office's permission arrangement.
    await request(app.getHttpServer())
      .get('/rbac/duty-segregation-readiness')
      .set(bearer(accessToken))
      .expect(403);

    const org = await prisma.organization.findFirstOrThrow({
      orderBy: { id: 'asc' },
    });
    const permission = await prisma.permission.findFirstOrThrow({
      where: { code: 'role.read' },
      select: { id: true },
    });
    const role = await prisma.role.create({
      data: {
        organizationId: org.id,
        name: `PAIRS_READER_${RUN}`,
        nameEn: 'Pairs reader',
        nameAr: 'قارئ الأزواج',
        requiresMfaAlways: false,
        requiresHardwareToken: false,
        permissions: {
          create: [{ organizationId: org.id, permissionId: permission.id }],
        },
      },
      select: { id: true },
    });
    await prisma.userRoleAssignment.create({
      data: { userId: user.id, roleId: role.id },
    });

    const res = await request(app.getHttpServer())
      .get('/rbac/duty-segregation-readiness')
      .set(bearer(accessToken))
      .expect(200);
    const rows = res.body as {
      entityType: string;
      checkerPermission: string;
      holderCount: number;
      status: string;
    }[];

    // One row per pair — the list is the point, not a summary of it.
    expect(rows).toHaveLength(MAKER_CHECKER_REGISTRY.length);
    for (const row of rows) {
      expect(['NOBODY', 'SINGLE_HOLDER', 'READY']).toContain(row.status);
      // The status is DERIVED from the count, so a row cannot say READY while reporting nobody.
      if (row.holderCount === 0) expect(row.status).toBe('NOBODY');
      if (row.holderCount === 1) expect(row.status).toBe('SINGLE_HOLDER');
      if (row.holderCount > 1) expect(row.status).toBe('READY');
    }
    // The seeded office has several roles holding checker permissions, so at least one row is READY —
    // otherwise this test would pass against a readiness list that returns zeros for everything.
    expect(rows.some((r) => r.status === 'READY')).toBe(true);

    await prisma.userRoleAssignment.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.role.delete({ where: { id: role.id } });
  }, 180_000);
});

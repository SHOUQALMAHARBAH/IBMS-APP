import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, rawPrisma, TEST_ORGANIZATION_ID } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * PART 4 STEP 4 — declaring the office's mode, and THE SHIPPING GATE as a test.
 *
 * The gate is the reason this file exists in this shape. `docs/duty-segregation-mode.md` states at the top
 * that COMBINED mode may not ship before the self-approval report exists and works — a commitment made to the
 * owner, on the strength of which a control was weakened. A gate written only in a document is a gate
 * somebody ships past, so the service refuses COMBINED while `SELF_APPROVAL_REPORT_EXISTS` is false, and the
 * test below asserts that refusal.
 *
 * **When the report ships, that flag, that refusal and this test are deleted in one commit.** A test that
 * asserts the gate is a liability the moment the gate is lifted, which is why it says so here rather than
 * leaving somebody to discover a failing assertion and delete it without knowing what it meant.
 */
const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = Math.random().toString(36).slice(2, 8);
const REASON =
  'This office has one licensed broker, so both halves of an approval are performed by her.';

let app: INestApplication<App> | null = null;
const createdRoleIds: string[] = [];

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface ModeBody {
  mode: string;
  declaredAt: string | null;
  declaredByUserId: string | null;
  declaredByName: string | null;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** A signed-in user holding a role with EXACTLY these codes. */
async function actorHolding(
  label: string,
  codes: string[],
): Promise<{ accessToken: string; userId: string }> {
  const server = (app as INestApplication<App>).getHttpServer();
  const org = await prisma.organization.findFirstOrThrow({
    orderBy: { id: 'asc' },
  });
  const permissions = await prisma.permission.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  // A mistyped code grants nothing and would make every refusal below pass for the wrong reason.
  expect(permissions.map((p) => p.code).sort()).toEqual([...codes].sort());

  const role = await prisma.role.create({
    data: {
      organizationId: org.id,
      name: `${label.toUpperCase()}_${RUN}`,
      nameEn: label,
      nameAr: label,
      requiresMfaAlways: false,
      requiresHardwareToken: false,
      permissions: {
        create: permissions.map((p) => ({
          organizationId: org.id,
          permissionId: p.id,
        })),
      },
    },
    select: { id: true },
  });
  createdRoleIds.push(role.id);

  const email = `${label}-${RUN}@mode.test`;
  await request(server)
    .post('/auth/signup')
    .send({ fullName: `Mode ${label}`, email, password: PASSWORD })
    .expect(201);
  const login = await request(server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const { accessToken, user } = login.body as IssuedSessionBody;

  const enroll = await request(server)
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const eb = enroll.body as MfaEnrollBody;
  await request(server)
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: eb.credentialId,
      code: authenticator.generate(
        /[?&]secret=([^&]+)/.exec(eb.otpAuthUri)![1],
      ),
    })
    .expect(200);

  await prisma.userRoleAssignment.create({
    data: { userId: user.id, roleId: role.id },
  });
  return { accessToken, userId: user.id };
}

/** SEGREGATED and never declared, whatever a killed run left behind. Called at both ends. */
async function resetOffice(): Promise<void> {
  await rawPrisma.organization.update({
    where: { id: TEST_ORGANIZATION_ID },
    data: {
      dutySegregationMode: 'SEGREGATED',
      dutySegregationModeDeclaredAt: null,
      dutySegregationModeDeclaredByUserId: null,
    },
  });
}

beforeAll(async () => {
  await resetOffice();
  app = await createTestApp();
}, 300_000);

afterAll(async () => {
  await app?.close();
  await resetOffice();
  if (createdRoleIds.length > 0) {
    await prisma.userRoleAssignment.deleteMany({
      where: { roleId: { in: createdRoleIds } },
    });
    await prisma.rolePermission.deleteMany({
      where: { roleId: { in: createdRoleIds } },
    });
    await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
  }
});

describe('duty segregation mode — declaring it (e2e)', () => {
  it('THE SHIPPING GATE: COMBINED is refused while the self-approval report does not exist', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const admin = await actorHolding('mode-declarer', [
      'duty-segregation.mode.declare',
    ]);

    const refused = await request(server)
      .patch('/duty-segregation/mode')
      .set(bearer(admin.accessToken))
      .send({ mode: 'COMBINED', reason: REASON })
      .expect(403);
    const message = JSON.stringify(refused.body);
    // The refusal has to say WHY, and the why is the missing report — not a permission and not a validation
    // problem. Somebody holding this is entitled to know what has to exist before they can proceed.
    expect(message).toContain('self-approval report');

    // And nothing moved.
    const office = await rawPrisma.organization.findUniqueOrThrow({
      where: { id: TEST_ORGANIZATION_ID },
      select: {
        dutySegregationMode: true,
        dutySegregationModeDeclaredAt: true,
      },
    });
    expect(office.dutySegregationMode).toBe('SEGREGATED');
    expect(office.dutySegregationModeDeclaredAt).toBeNull();
  }, 300_000);

  it('declaring SEGREGATED explicitly is recorded, audited, and reads back with who and when', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const admin = await actorHolding('mode-declarer-2', [
      'duty-segregation.mode.declare',
    ]);

    // Before: the office is segregated because that is the DEFAULT, and the read says so by having no
    // declaration. That distinction is what the report needs beside every act.
    const before = await request(server)
      .get('/duty-segregation/mode')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect((before.body as ModeBody).mode).toBe('SEGREGATED');
    expect((before.body as ModeBody).declaredAt).toBeNull();

    // A reason that says nothing is refused. The mode change is the whole request, so the reason is mandatory
    // here — unlike the per-act one, which is optional because an ordinary approval must send nothing.
    await request(server)
      .patch('/duty-segregation/mode')
      .set(bearer(admin.accessToken))
      .send({ mode: 'SEGREGATED', reason: 'because' })
      .expect(400);

    const declared = await request(server)
      .patch('/duty-segregation/mode')
      .set(bearer(admin.accessToken))
      .send({
        mode: 'SEGREGATED',
        reason: 'Confirming the default explicitly after the annual review.',
      })
      .expect(200);
    const body = declared.body as ModeBody;
    expect(body.mode).toBe('SEGREGATED');
    // Declaring the mode the office is already in is IDEMPOTENT and deliberately not audited — but this call
    // is the first declaration, so it does stamp who and when.
    expect(body.declaredByUserId).toBe(admin.userId);
    expect(body.declaredByName).not.toBeNull();
    expect(body.declaredAt).not.toBeNull();

    // THE AUDIT ROW, asserted rather than assumed — Rule 4: a regulator asking "when did this office stop
    // segregating duties, and who decided" must get an answer from the trail. Scoped to this actor, never a
    // count over the table: db-test is cumulative.
    const rows = await rawPrisma.auditLogEntry.findMany({
      where: {
        userId: admin.userId,
        action: 'UPDATE',
        entityType: 'Organization',
      },
      select: { afterValue: true, beforeValue: true },
    });
    expect(rows.length).toBe(1);
    const after = JSON.stringify(rows[0].afterValue);
    expect(after).toContain('annual review');
    expect(after).toContain('SEGREGATED');
    // The BEFORE half matters as much: "it was already segregated" is what distinguishes a confirmation from
    // a change, and without it the trail cannot tell them apart.
    expect(JSON.stringify(rows[0].beforeValue)).toContain('SEGREGATED');
  }, 300_000);

  it('the read is open to whoever reviews the acts; the WRITE is not', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    // Compliance reads the self-approval report and must be able to see the office's posture beside it — and
    // must NOT be able to change it. Whoever declares the mode is not whoever reviews what it permits, which
    // is the same segregation principle one level up.
    const reviewer = await actorHolding('mode-reviewer', [
      'internal-controls.view',
    ]);

    await request(server)
      .get('/duty-segregation/mode')
      .set(bearer(reviewer.accessToken))
      .expect(200);

    await request(server)
      .patch('/duty-segregation/mode')
      .set(bearer(reviewer.accessToken))
      .send({ mode: 'SEGREGATED', reason: REASON })
      .expect(403);
  }, 300_000);

  it('holding neither code sees nothing at all', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const nobody = await actorHolding('mode-outsider', [
      'customer.360-view.read',
    ]);
    await request(server)
      .get('/duty-segregation/mode')
      .set(bearer(nobody.accessToken))
      .expect(403);
  }, 300_000);

  it('/auth/me carries the mode, so an approve screen knows whether to ask for a reason', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const anyone = await actorHolding('mode-me', ['customer.360-view.read']);
    const me = await request(server)
      .get('/auth/me')
      .set(bearer(anyone.accessToken))
      .expect(200);
    // Every authenticated caller, not only the administrator: a screen that cannot know the mode either asks
    // everybody for a reason or asks nobody and then 422s.
    expect(
      (me.body as { dutySegregationMode: string }).dutySegregationMode,
    ).toBe('SEGREGATED');
  }, 300_000);
});

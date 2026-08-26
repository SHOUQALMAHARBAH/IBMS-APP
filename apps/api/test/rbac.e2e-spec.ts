import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface RecertificationItemBody {
  id: string;
  cycleId: string;
  cycleLabel: string;
  subjectUserId: string;
  subjectFullName: string;
  subjectEmail: string;
  subjectRoles: string[];
  reviewerUserId: string;
  decision: string | null;
}
interface CycleBody {
  id: string;
}

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return match[1];
}

async function signupAndLogin(
  app: INestApplication<App>,
  email: string,
): Promise<{ accessToken: string; userId: string }> {
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'RBAC Test User', email, password: PASSWORD })
    .expect(201);
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = res.body as IssuedSessionBody;
  return { accessToken: body.accessToken, userId: body.user.id };
}

/** MfaRequiredGuard runs before PermissionsGuard in the guard chain — every
 * user in these tests must enroll MFA first or every request 403s on that
 * guard instead of exercising RBAC. */
async function enrollMfa(
  app: INestApplication<App>,
  accessToken: string,
): Promise<void> {
  const enroll = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  const secret = secretFromOtpAuthUri(enrollBody.otpAuthUri);
  await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secret),
    })
    .expect(200);
}

async function grantRole(userId: string, roleName: RoleName): Promise<void> {
  const role = await prisma.role.upsert({
    where: { name: roleName },
    update: {},
    create: { name: roleName },
  });
  await prisma.userRoleAssignment.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: { revokedAt: null },
    create: { userId, roleId: role.id },
  });
}

async function makeUser(
  app: INestApplication<App>,
  label: string,
  role?: RoleName,
): Promise<{ accessToken: string; userId: string; email: string }> {
  const email = uniqueEmail(label);
  const { accessToken, userId } = await signupAndLogin(app, email);
  await enrollMfa(app, accessToken);
  if (role) await grantRole(userId, role);
  return { accessToken, userId, email };
}

/** AccessRecertificationService.startCycle always assigns the FIRST
 * eligible (!= subject) member of the reviewer pool — not "whoever started
 * the cycle". The test DB accumulates COMPLIANCE_OFFICER/
 * BRANCH_DEPARTMENT_MANAGER/EXECUTIVE_MANAGEMENT grants across every past
 * run of this file, which would otherwise make "who becomes the reviewer"
 * nondeterministic here. Reset the pool immediately before any test that
 * depends on knowing exactly who it'll be — scoped to these three roles
 * only, and only ever touches the (test-only) db-test database.
 */
async function resetReviewerPool(): Promise<void> {
  await prisma.userRoleAssignment.updateMany({
    where: {
      revokedAt: null,
      role: {
        name: {
          in: [
            'COMPLIANCE_OFFICER',
            'BRANCH_DEPARTMENT_MANAGER',
            'EXECUTIVE_MANAGEMENT',
          ],
        },
      },
    },
    data: { revokedAt: new Date() },
  });
}

describe('RBAC / access recertification (e2e)', () => {
  let app: INestApplication<App>;

  async function boot(): Promise<INestApplication<App>> {
    if (!app) app = await createTestApp();
    return app;
  }

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('GET /rbac/roles, /rbac/permissions', () => {
    it('is forbidden for a user without role.manage/permission.manage', async () => {
      const app = await boot();
      const plain = await makeUser(app, 'rbac-plain');
      await request(app.getHttpServer())
        .get('/rbac/roles')
        .set(bearer(plain.accessToken))
        .expect(403);
      await request(app.getHttpServer())
        .get('/rbac/permissions')
        .set(bearer(plain.accessToken))
        .expect(403);
    });

    it('is allowed for SYSTEM_SECURITY_ADMINISTRATOR and returns the seeded catalogue', async () => {
      const app = await boot();
      const admin = await makeUser(
        app,
        'rbac-admin',
        'SYSTEM_SECURITY_ADMINISTRATOR',
      );
      const roles = await request(app.getHttpServer())
        .get('/rbac/roles')
        .set(bearer(admin.accessToken))
        .expect(200);
      expect((roles.body as unknown[]).length).toBe(11);

      const permissions = await request(app.getHttpServer())
        .get('/rbac/permissions')
        .set(bearer(admin.accessToken))
        .expect(200);
      expect((permissions.body as { code: string }[]).length).toBeGreaterThan(
        50,
      );
    });
  });

  describe('access-recertification cycle lifecycle', () => {
    it('is forbidden to start a cycle or list items without access-recertification permissions', async () => {
      const app = await boot();
      const plain = await makeUser(app, 'recert-plain');
      await request(app.getHttpServer())
        .post('/access-recertification/cycles')
        .set(bearer(plain.accessToken))
        .send({ cycleLabel: 'unauthorized-attempt' })
        .expect(403);
      await request(app.getHttpServer())
        .get('/access-recertification/items')
        .set(bearer(plain.accessToken))
        .expect(403);
    });

    it('a Compliance Officer starting a cycle never becomes the reviewer of their own item, and reviews the subject assigned to them', async () => {
      const app = await boot();
      await resetReviewerPool();
      const compliance = await makeUser(
        app,
        'recert-compliance',
        'COMPLIANCE_OFFICER',
      );
      const subject = await makeUser(
        app,
        'recert-subject',
        'SALES_RELATIONSHIP_OFFICER',
      );

      const cycleRes = await request(app.getHttpServer())
        .post('/access-recertification/cycles')
        .set(bearer(compliance.accessToken))
        .send({ cycleLabel: `e2e-${Date.now()}` })
        .expect(201);
      const cycleId = (cycleRes.body as CycleBody).id;

      const itemsRes = await request(app.getHttpServer())
        .get('/access-recertification/items')
        .query({ cycleId })
        .set(bearer(compliance.accessToken))
        .expect(200);
      const items = itemsRes.body as RecertificationItemBody[];

      // The compliance officer must never review themselves — with only
      // one pool member, they have no item at all in this cycle rather
      // than one reviewed by someone else, which is the correct behavior
      // (see access-recertification.service.spec.ts's equivalent unit test).
      expect(items.some((i) => i.subjectUserId === compliance.userId)).toBe(
        false,
      );
      // The subject, with no other eligible reviewer in a freshly-reset
      // pool, must have been assigned to this compliance officer.
      const subjectItem = items.find((i) => i.subjectUserId === subject.userId);
      expect(subjectItem).toBeDefined();
      expect(subjectItem?.reviewerUserId).toBe(compliance.userId);
      // The item is enriched for the review screen — not just raw ids.
      expect(subjectItem?.subjectEmail).toBe(subject.email);
      expect(subjectItem?.subjectFullName.length).toBeGreaterThan(0);
      expect(subjectItem?.subjectRoles).toContain('SALES_RELATIONSHIP_OFFICER');
      expect(subjectItem?.cycleLabel.length).toBeGreaterThan(0);

      // Deciding it works...
      await request(app.getHttpServer())
        .post(`/access-recertification/items/${subjectItem!.id}/decision`)
        .set(bearer(compliance.accessToken))
        .send({ decision: 'confirmed' })
        .expect(201);

      // ...and a second decision on the same item is rejected.
      await request(app.getHttpServer())
        .post(`/access-recertification/items/${subjectItem!.id}/decision`)
        .set(bearer(compliance.accessToken))
        .send({ decision: 'revoked' })
        .expect(409);
    });

    it("rejects a decision from a user who holds access-recertification.review but is not this item's assigned reviewer", async () => {
      const app = await boot();
      await resetReviewerPool();
      const compliance = await makeUser(
        app,
        'recert-compliance2',
        'COMPLIANCE_OFFICER',
      );
      const subject = await makeUser(app, 'recert-subject2', 'CLAIMS_OFFICER');
      const bystander = await makeUser(
        app,
        'recert-bystander',
        'COMPLIANCE_OFFICER',
      );

      const cycleRes = await request(app.getHttpServer())
        .post('/access-recertification/cycles')
        .set(bearer(compliance.accessToken))
        .send({ cycleLabel: `e2e-${Date.now()}` })
        .expect(201);
      const cycleId = (cycleRes.body as CycleBody).id;

      const itemsRes = await request(app.getHttpServer())
        .get('/access-recertification/items')
        .query({ cycleId })
        .set(bearer(compliance.accessToken))
        .expect(200);
      const subjectItem = (itemsRes.body as RecertificationItemBody[]).find(
        (i) => i.subjectUserId === subject.userId,
      );
      // "compliance" was created (and thus resolved as the pool's first
      // eligible member) before "bystander", so it — not bystander — is
      // the assigned reviewer.
      expect(subjectItem).toBeDefined();
      expect(subjectItem?.reviewerUserId).toBe(compliance.userId);

      await request(app.getHttpServer())
        .post(`/access-recertification/items/${subjectItem!.id}/decision`)
        .set(bearer(bystander.accessToken))
        .send({ decision: 'confirmed' })
        .expect(403);
    });
  });
});

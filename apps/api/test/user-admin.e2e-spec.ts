import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const PROVISIONED_PASSWORD = 'Another-Correct-Horse-7!';

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string; roles: string[] };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface AdminUserBody {
  id: string;
  email: string;
  roles: string[];
}
interface RolesBody {
  userId: string;
  roles: string[];
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
    .send({ fullName: 'User Admin Test', email, password: PASSWORD })
    .expect(201);
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = res.body as IssuedSessionBody;
  return { accessToken: body.accessToken, userId: body.user.id };
}

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

async function grantRoleDirect(
  userId: string,
  roleName: RoleName,
): Promise<void> {
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
  if (role) await grantRoleDirect(userId, role);
  return { accessToken, userId, email };
}

/**
 * Backlog A.2 — user provisioning and role assignment.
 *
 * The gap this closes: `POST /auth/signup` creates an account with NO roles,
 * `RbacController` is read-only, and role assignment is gated by `user.manage`
 * — which had no endpoint. A freshly-seeded deployment therefore had the full
 * role catalogue, the full permission grid, and no reachable path to any
 * permission. The first test below is that path, end to end.
 */
describe('User admin / provisioning (e2e)', () => {
  let app: INestApplication<App>;

  const appPromise = createTestApp().then((created) => {
    app = created;
    return created;
  });

  afterAll(async () => {
    await (await appPromise).close();
  });

  it('provisions an account WITH roles, and that account can immediately use them', async () => {
    await appPromise;
    const admin = await makeUser(
      app,
      'ua-admin',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );

    const email = uniqueEmail('ua-provisioned');
    const created = await request(app.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        fullName: 'Provisioned Sales Officer',
        email,
        password: PROVISIONED_PASSWORD,
        roles: ['SALES_RELATIONSHIP_OFFICER'],
      })
      .expect(201);

    const body = created.body as AdminUserBody;
    expect(body.roles).toEqual(['SALES_RELATIONSHIP_OFFICER']);

    // The account is usable straight away — this is the whole point.
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PROVISIONED_PASSWORD })
      .expect(200);
    const session = login.body as IssuedSessionBody;
    expect(session.user.roles).toContain('SALES_RELATIONSHIP_OFFICER');

    // MFA is mandatory for everyone (backlog A.1) and `MfaRequiredGuard` runs
    // ahead of `PermissionsGuard`, so a brand-new account must enrol before it
    // can reach any guarded route — role or no role. That is policy, not a
    // gap: enrol, then prove the granted permission actually works.
    await request(app.getHttpServer())
      .get('/leads')
      .set(bearer(session.accessToken))
      .expect(403);

    await enrollMfa(app, session.accessToken);

    // The full bootstrap path, end to end: an administrator provisioned this
    // account, the role it was given grants `lead.list.read`, and the account
    // can now use it. Before `POST /admin/users` existed there was no way to
    // reach this point at all.
    await request(app.getHttpServer())
      .get('/leads')
      .set(bearer(session.accessToken))
      .expect(200);
  });

  it('refuses a caller without user.manage', async () => {
    await appPromise;
    const sales = await makeUser(app, 'ua-sales', 'SALES_RELATIONSHIP_OFFICER');
    await request(app.getHttpServer())
      .post('/admin/users')
      .set(bearer(sales.accessToken))
      .send({
        fullName: 'Nope',
        email: uniqueEmail('ua-nope'),
        password: PROVISIONED_PASSWORD,
        roles: ['SALES_RELATIONSHIP_OFFICER'],
      })
      .expect(403);

    await request(app.getHttpServer())
      .get('/admin/users')
      .set(bearer(sales.accessToken))
      .expect(403);
  });

  it('rejects a password that fails the Part 10.1 policy, and a duplicate email', async () => {
    await appPromise;
    const admin = await makeUser(
      app,
      'ua-admin2',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );

    await request(app.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        fullName: 'Weak',
        email: uniqueEmail('ua-weak'),
        password: 'shortpass123',
        roles: ['SALES_RELATIONSHIP_OFFICER'],
      })
      .expect(400);

    const email = uniqueEmail('ua-dupe');
    await request(app.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        fullName: 'First',
        email,
        password: PROVISIONED_PASSWORD,
        roles: ['SALES_RELATIONSHIP_OFFICER'],
      })
      .expect(201);
    // A second create on the same email is a clean 409, not an unhandled 500.
    await request(app.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        fullName: 'Second',
        email,
        password: PROVISIONED_PASSWORD,
        roles: ['SALES_RELATIONSHIP_OFFICER'],
      })
      .expect(409);
  });

  it('grants and revokes a role, and the revoked grant is kept, not deleted', async () => {
    await appPromise;
    const admin = await makeUser(
      app,
      'ua-admin3',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const subject = await makeUser(app, 'ua-subject');

    const granted = await request(app.getHttpServer())
      .post(`/admin/users/${subject.userId}/roles`)
      .set(bearer(admin.accessToken))
      .send({ role: 'CLAIMS_OFFICER' })
      .expect(201);
    expect((granted.body as RolesBody).roles).toContain('CLAIMS_OFFICER');

    const revoked = await request(app.getHttpServer())
      .post(`/admin/users/${subject.userId}/roles/revoke`)
      .set(bearer(admin.accessToken))
      .send({ role: 'CLAIMS_OFFICER' })
      .expect(201);
    expect((revoked.body as RolesBody).roles).not.toContain('CLAIMS_OFFICER');

    // The audit record of WHEN access was withdrawn must survive.
    const role = await prisma.role.findUniqueOrThrow({
      where: { name: 'CLAIMS_OFFICER' },
    });
    const assignment = await prisma.userRoleAssignment.findUnique({
      where: { userId_roleId: { userId: subject.userId, roleId: role.id } },
    });
    expect(assignment).not.toBeNull();
    expect(assignment?.revokedAt).not.toBeNull();

    // Revoking again is a 409 — there is no active grant left to withdraw.
    await request(app.getHttpServer())
      .post(`/admin/users/${subject.userId}/roles/revoke`)
      .set(bearer(admin.accessToken))
      .send({ role: 'CLAIMS_OFFICER' })
      .expect(409);
  });

  it('deactivating an account blocks its login', async () => {
    await appPromise;
    const admin = await makeUser(
      app,
      'ua-admin4',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const email = uniqueEmail('ua-deactivate');
    const created = await request(app.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        fullName: 'To Be Disabled',
        email,
        password: PROVISIONED_PASSWORD,
        roles: ['SALES_RELATIONSHIP_OFFICER'],
      })
      .expect(201);
    const created2 = created.body as AdminUserBody;

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PROVISIONED_PASSWORD })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/admin/users/${created2.id}/deactivate`)
      .set(bearer(admin.accessToken))
      .expect(201);

    // De-provisioning has a real access-control effect, not just a flag.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PROVISIONED_PASSWORD })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/admin/users/${created2.id}/activate`)
      .set(bearer(admin.accessToken))
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PROVISIONED_PASSWORD })
      .expect(200);
  });

  it('refuses to deactivate the calling administrator', async () => {
    await appPromise;
    const admin = await makeUser(
      app,
      'ua-admin5',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    await request(app.getHttpServer())
      .post(`/admin/users/${admin.userId}/deactivate`)
      .set(bearer(admin.accessToken))
      .expect(422);
  });
});

import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}
function uniqueLabel(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return match[1];
}

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface VendorBody {
  id: string;
  name: string;
  vendorType: string;
}

let sharedApp: INestApplication<App> | undefined;
async function boot(): Promise<INestApplication<App>> {
  if (!sharedApp) sharedApp = await createTestApp();
  return sharedApp;
}

async function makeUser(
  app: INestApplication<App>,
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Vendor E2E User', email, password: PASSWORD })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const { accessToken, user } = login.body as IssuedSessionBody;

  const enroll = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(enrollBody.otpAuthUri)),
    })
    .expect(200);

  for (const roleName of roles) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
    await prisma.userRoleAssignment.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: { revokedAt: null },
      create: { userId: user.id, roleId: role.id },
    });
  }
  return { accessToken, userId: user.id };
}

describe('Procurement / Vendor (e2e) — backlog Part C #67', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates every route behind vendor.manage', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'vendor-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/vendors')
      .set(bearer(outsider.accessToken))
      .send({ name: 'Nobody Supplies', vendorType: 'other' })
      .expect(403);
    await request(app.getHttpServer())
      .get('/vendors')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('rejects a vendorType outside the documented 7-value set', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'vendor-manager-bad',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    await request(app.getHttpServer())
      .post('/vendors')
      .set(bearer(manager.accessToken))
      .send({ name: 'Bad Type Co', vendorType: 'something_else' })
      .expect(400);
  });

  it('walks create -> list (filtered) -> get -> update for a procurement vendor', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'vendor-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );

    const name = uniqueLabel('Acme Office Supplies');
    const created = (
      await request(app.getHttpServer())
        .post('/vendors')
        .set(bearer(manager.accessToken))
        .send({ name, vendorType: 'other' })
        .expect(201)
    ).body as VendorBody;
    expect(created.vendorType).toBe('other');

    const list = (
      await request(app.getHttpServer())
        .get('/vendors?vendorType=other')
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as VendorBody[];
    expect(list.find((v) => v.id === created.id)).toBeTruthy();

    const fetched = (
      await request(app.getHttpServer())
        .get(`/vendors/${created.id}`)
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as VendorBody;
    expect(fetched.name).toBe(name);

    const renamed = uniqueLabel('Acme Office Supplies Renamed');
    const updated = (
      await request(app.getHttpServer())
        .patch(`/vendors/${created.id}`)
        .set(bearer(manager.accessToken))
        .send({ name: renamed })
        .expect(200)
    ).body as VendorBody;
    expect(updated.name).toBe(renamed);
    expect(updated.vendorType).toBe('other'); // untouched by a name-only patch
  });

  it('404s getting or updating an unknown vendor', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'vendor-admin',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    await request(app.getHttpServer())
      .get('/vendors/00000000-0000-0000-0000-000000000000')
      .set(bearer(admin.accessToken))
      .expect(404);
    await request(app.getHttpServer())
      .patch('/vendors/00000000-0000-0000-0000-000000000000')
      .set(bearer(admin.accessToken))
      .send({ name: 'Nope' })
      .expect(404);
  });
});

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
interface InformationAssetBody {
  id: string;
  name: string;
  assetType: string;
  ownerUserId: string;
  classification: string;
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
    .send({ fullName: 'Information Asset E2E User', email, password: PASSWORD })
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

describe('Cybersecurity / Information Asset (e2e) — backlog Part C #69', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates every route behind information-asset.manage', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'asset-outsider',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    await request(app.getHttpServer())
      .post('/information-assets')
      .set(bearer(outsider.accessToken))
      .send({
        name: 'Nobody Assets',
        assetType: 'other',
        ownerUserId: outsider.userId,
        classification: 'PUBLIC',
      })
      .expect(403);
    await request(app.getHttpServer())
      .get('/information-assets')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('rejects an assetType outside the documented 6-value set', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'asset-admin-bad-type',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    await request(app.getHttpServer())
      .post('/information-assets')
      .set(bearer(admin.accessToken))
      .send({
        name: 'Bad Type Asset',
        assetType: 'something_else',
        ownerUserId: admin.userId,
        classification: 'PUBLIC',
      })
      .expect(400);
  });

  it('rejects a classification outside the DataClassification enum', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'asset-admin-bad-class',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    await request(app.getHttpServer())
      .post('/information-assets')
      .set(bearer(admin.accessToken))
      .send({
        name: 'Bad Classification Asset',
        assetType: 'other',
        ownerUserId: admin.userId,
        classification: 'TOP_SECRET',
      })
      .expect(400);
  });

  it('404s creating an asset owned by a non-existent user', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'asset-compliance-bad-owner',
      'COMPLIANCE_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/information-assets')
      .set(bearer(compliance.accessToken))
      .send({
        name: 'Orphan Owner Asset',
        assetType: 'other',
        ownerUserId: '00000000-0000-0000-0000-000000000000',
        classification: 'INTERNAL',
      })
      .expect(404);
  });

  it('walks create -> list (filtered) -> get -> update for an information asset', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'asset-admin',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const owner = await makeUser(
      app,
      'asset-owner',
      'SALES_RELATIONSHIP_OFFICER',
    );

    const name = uniqueLabel('Customer Data Warehouse');
    const created = (
      await request(app.getHttpServer())
        .post('/information-assets')
        .set(bearer(admin.accessToken))
        .send({
          name,
          assetType: 'customer_data',
          ownerUserId: owner.userId,
          classification: 'HIGHLY_CONFIDENTIAL',
        })
        .expect(201)
    ).body as InformationAssetBody;
    expect(created.assetType).toBe('customer_data');
    expect(created.ownerUserId).toBe(owner.userId);

    const list = (
      await request(app.getHttpServer())
        .get('/information-assets?assetType=customer_data')
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body as InformationAssetBody[];
    expect(list.find((a) => a.id === created.id)).toBeTruthy();

    const fetched = (
      await request(app.getHttpServer())
        .get(`/information-assets/${created.id}`)
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body as InformationAssetBody;
    expect(fetched.name).toBe(name);

    const renamed = uniqueLabel('Customer Data Warehouse Renamed');
    const updated = (
      await request(app.getHttpServer())
        .patch(`/information-assets/${created.id}`)
        .set(bearer(admin.accessToken))
        .send({ name: renamed })
        .expect(200)
    ).body as InformationAssetBody;
    expect(updated.name).toBe(renamed);
    expect(updated.assetType).toBe('customer_data'); // untouched by a name-only patch
  });

  it('404s reassigning an asset to a non-existent owner on update', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'asset-admin-reassign',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const owner = await makeUser(app, 'asset-owner-reassign', 'CLAIMS_OFFICER');

    const created = (
      await request(app.getHttpServer())
        .post('/information-assets')
        .set(bearer(admin.accessToken))
        .send({
          name: uniqueLabel('Reassign Target Asset'),
          assetType: 'backup',
          ownerUserId: owner.userId,
          classification: 'CONFIDENTIAL',
        })
        .expect(201)
    ).body as InformationAssetBody;

    await request(app.getHttpServer())
      .patch(`/information-assets/${created.id}`)
      .set(bearer(admin.accessToken))
      .send({ ownerUserId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);
  });

  it('404s getting or updating an unknown information asset', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'asset-compliance-404',
      'COMPLIANCE_OFFICER',
    );
    await request(app.getHttpServer())
      .get('/information-assets/00000000-0000-0000-0000-000000000000')
      .set(bearer(compliance.accessToken))
      .expect(404);
    await request(app.getHttpServer())
      .patch('/information-assets/00000000-0000-0000-0000-000000000000')
      .set(bearer(compliance.accessToken))
      .send({ name: 'Nope' })
      .expect(404);
  });
});

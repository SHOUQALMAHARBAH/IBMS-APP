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
interface RopaEntryBody {
  id: string;
  processingActivity: string;
  categoriesOfData: string[];
  recipients: string[];
  retentionPeriodMonths: number | null;
}
interface RopaExportBody {
  generatedAt: string;
  entryCount: number;
  entries: RopaEntryBody[];
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
    .send({ fullName: 'RoPA E2E User', email, password: PASSWORD })
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

describe('Records of Processing Activities (e2e) — backlog Part D §5.1, Process #52', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates every route behind ropa.manage', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'ropa-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/ropa-entries')
      .set(bearer(outsider.accessToken))
      .send({
        processingActivity: 'x',
        categoriesOfData: ['a'],
        purpose: 'p',
        recipients: ['r'],
      })
      .expect(403);
    await request(app.getHttpServer())
      .get('/ropa-entries')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('walks create -> list -> get -> update for a processing-activity register entry', async () => {
    const app = await boot();
    const dpo = await makeUser(app, 'ropa-dpo-walk', 'DATA_PROTECTION_OFFICER');

    const created = (
      await request(app.getHttpServer())
        .post('/ropa-entries')
        .set(bearer(dpo.accessToken))
        .send({
          processingActivity: 'KYC identity verification',
          categoriesOfData: ['national_id', 'contact_details'],
          purpose: 'Regulatory KYC compliance',
          recipients: ['Internal Compliance team'],
          retentionPeriodMonths: 120,
        })
        .expect(201)
    ).body as RopaEntryBody;
    expect(created.categoriesOfData).toEqual([
      'national_id',
      'contact_details',
    ]);

    const list = (
      await request(app.getHttpServer())
        .get('/ropa-entries')
        .set(bearer(dpo.accessToken))
        .expect(200)
    ).body as RopaEntryBody[];
    expect(list.find((e) => e.id === created.id)).toBeTruthy();

    const fetched = (
      await request(app.getHttpServer())
        .get(`/ropa-entries/${created.id}`)
        .set(bearer(dpo.accessToken))
        .expect(200)
    ).body as RopaEntryBody;
    expect(fetched.retentionPeriodMonths).toBe(120);

    const updated = (
      await request(app.getHttpServer())
        .patch(`/ropa-entries/${created.id}`)
        .set(bearer(dpo.accessToken))
        .send({ recipients: ['Internal Compliance team', 'External auditor'] })
        .expect(200)
    ).body as RopaEntryBody;
    expect(updated.recipients).toEqual([
      'Internal Compliance team',
      'External auditor',
    ]);
    expect(updated.processingActivity).toBe('KYC identity verification');
  });

  it('exports the full register with an EXPORT audit row, not a per-row read', async () => {
    const app = await boot();
    const dpo = await makeUser(
      app,
      'ropa-dpo-export',
      'DATA_PROTECTION_OFFICER',
    );

    await request(app.getHttpServer())
      .post('/ropa-entries')
      .set(bearer(dpo.accessToken))
      .send({
        processingActivity: 'Claims processing',
        categoriesOfData: ['claim_details'],
        purpose: 'Claims settlement',
        recipients: ['Insurer'],
      })
      .expect(201);

    const exported = (
      await request(app.getHttpServer())
        .get('/ropa-entries/export')
        .set(bearer(dpo.accessToken))
        .expect(200)
    ).body as RopaExportBody;
    expect(exported.entryCount).toBeGreaterThanOrEqual(1);
    expect(exported.entries.length).toBe(exported.entryCount);
  });

  it('404s getting or updating an unknown entry', async () => {
    const app = await boot();
    const dpo = await makeUser(app, 'ropa-dpo-404', 'DATA_PROTECTION_OFFICER');
    await request(app.getHttpServer())
      .get('/ropa-entries/00000000-0000-0000-0000-000000000000')
      .set(bearer(dpo.accessToken))
      .expect(404);
    await request(app.getHttpServer())
      .patch('/ropa-entries/00000000-0000-0000-0000-000000000000')
      .set(bearer(dpo.accessToken))
      .send({ purpose: 'x' })
      .expect(404);
  });
});

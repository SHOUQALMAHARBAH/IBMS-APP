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
interface ArticleBody {
  id: string;
  title: string;
  titleAr: string | null;
  category: string;
  bodyEn: string | null;
  bodyAr: string | null;
  publishedAt: string;
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
    .send({ fullName: 'Knowledge Base E2E User', email, password: PASSWORD })
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
    // Partial UNIQUE `UserRoleAssignment_one_active_per_user_role` (migration
    // 20260920140000) means a revoked grant is HISTORY and a new grant is a
    // new row — so this creates one only when no active grant exists, rather
    // than resurrecting a revoked one and erasing its audit trail.
    const activeGrant = await prisma.userRoleAssignment.findFirst({
      where: { userId: user.id, roleId: role.id, revokedAt: null },
    });
    if (!activeGrant) {
      await prisma.userRoleAssignment.create({
        data: { userId: user.id, roleId: role.id },
      });
    }
  }
  return { accessToken, userId: user.id };
}

describe('Knowledge Management (e2e) — backlog Part C #74', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates every route behind kb.publish', async () => {
    const app = await boot();
    const outsider = await makeUser(app, 'kb-outsider', 'CLAIMS_OFFICER');
    await request(app.getHttpServer())
      .post('/knowledge-base-articles')
      .set(bearer(outsider.accessToken))
      .send({ title: 'X', category: 'product_knowledge' })
      .expect(403);
    await request(app.getHttpServer())
      .get('/knowledge-base-articles')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('rejects a category outside the documented 4-value set', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'kb-manager-bad',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    await request(app.getHttpServer())
      .post('/knowledge-base-articles')
      .set(bearer(manager.accessToken))
      .send({ title: 'Bad Category Article', category: 'gossip' })
      .expect(400);
  });

  it('walks create (English-only) -> list (filtered) -> get -> update to add an Arabic translation', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'kb-compliance',
      'COMPLIANCE_OFFICER',
    );

    const title = uniqueLabel('Property All Risks Overview');
    const created = (
      await request(app.getHttpServer())
        .post('/knowledge-base-articles')
        .set(bearer(compliance.accessToken))
        .send({
          title,
          category: 'product_knowledge',
          bodyEn: 'Coverage summary for Property All Risks.',
        })
        .expect(201)
    ).body as ArticleBody;
    expect(created.category).toBe('product_knowledge');
    expect(created.titleAr).toBeNull();
    expect(created.publishedAt).toBeTruthy();

    const list = (
      await request(app.getHttpServer())
        .get('/knowledge-base-articles?category=product_knowledge')
        .set(bearer(compliance.accessToken))
        .expect(200)
    ).body as ArticleBody[];
    expect(list.find((a) => a.id === created.id)).toBeTruthy();

    const fetched = (
      await request(app.getHttpServer())
        .get(`/knowledge-base-articles/${created.id}`)
        .set(bearer(compliance.accessToken))
        .expect(200)
    ).body as ArticleBody;
    expect(fetched.title).toBe(title);

    const updated = (
      await request(app.getHttpServer())
        .patch(`/knowledge-base-articles/${created.id}`)
        .set(bearer(compliance.accessToken))
        .send({ titleAr: 'نظرة عامة على التأمين ضد جميع الأخطار' })
        .expect(200)
    ).body as ArticleBody;
    expect(updated.titleAr).toBe('نظرة عامة على التأمين ضد جميع الأخطار');
    expect(updated.title).toBe(title); // untouched by an Arabic-only patch
  });

  it('creates a fully bilingual article in one call', async () => {
    const app = await boot();
    const placement = await makeUser(
      app,
      'kb-placement',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    const created = (
      await request(app.getHttpServer())
        .post('/knowledge-base-articles')
        .set(bearer(placement.accessToken))
        .send({
          title: uniqueLabel('Motor Rate Guide'),
          titleAr: 'دليل أسعار السيارات',
          category: 'rate_guide',
          bodyEn: 'Rates by vehicle class.',
          bodyAr: 'الأسعار حسب فئة المركبة.',
        })
        .expect(201)
    ).body as ArticleBody;
    expect(created.titleAr).toBe('دليل أسعار السيارات');
    expect(created.bodyAr).toBe('الأسعار حسب فئة المركبة.');
  });

  it('404s getting or updating an unknown article', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'kb-manager-404',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    await request(app.getHttpServer())
      .get('/knowledge-base-articles/00000000-0000-0000-0000-000000000000')
      .set(bearer(manager.accessToken))
      .expect(404);
    await request(app.getHttpServer())
      .patch('/knowledge-base-articles/00000000-0000-0000-0000-000000000000')
      .set(bearer(manager.accessToken))
      .send({ title: 'Nope' })
      .expect(404);
  });
});

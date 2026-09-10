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
interface DpiaScreeningBody {
  id: string;
  outcome: string;
  dpoReviewDueAt: string | null;
  dpoReviewedAt: string | null;
  dpoSpotCheckedAt: string | null;
  escalatedToFullDpiaAt: string | null;
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
    .send({ fullName: 'DPIA E2E User', email, password: PASSWORD })
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

const ALL_NO = {
  qSensitiveData: false,
  qLargeScaleProcessing: false,
  qCrossBorderTransfer: false,
  qNewTechnologyMonitoring: false,
  qNewDigitalChannel: false,
};

describe('DPIA Screening (e2e) — backlog Part D §5.1, Process #52', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates every route behind dpia.review', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'dpia-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/dpia-screenings')
      .set(bearer(outsider.accessToken))
      .send({ subjectDescription: 'x', ...ALL_NO })
      .expect(403);
    await request(app.getHttpServer())
      .get('/dpia-screenings')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('auto-approves an all-No screening, and a DPO spot-check completes it', async () => {
    const app = await boot();
    const dpo = await makeUser(
      app,
      'dpia-dpo-autoapprove',
      'DATA_PROTECTION_OFFICER',
    );

    const created = (
      await request(app.getHttpServer())
        .post('/dpia-screenings')
        .set(bearer(dpo.accessToken))
        .send({
          subjectDescription: 'New internal reporting dashboard.',
          ...ALL_NO,
        })
        .expect(201)
    ).body as DpiaScreeningBody;
    expect(created.outcome).toBe('AUTO_APPROVED');
    expect(created.dpoReviewDueAt).toBeNull();

    const spotChecked = (
      await request(app.getHttpServer())
        .post(`/dpia-screenings/${created.id}/spot-check`)
        .set(bearer(dpo.accessToken))
        .expect(201)
    ).body as DpiaScreeningBody;
    expect(spotChecked.dpoSpotCheckedAt).not.toBeNull();

    // 422 re-spot-check
    await request(app.getHttpServer())
      .post(`/dpia-screenings/${created.id}/spot-check`)
      .set(bearer(dpo.accessToken))
      .expect(422);

    // 422 reviewing an AUTO_APPROVED screening — review is for DPO_REVIEW_REQUIRED only
    await request(app.getHttpServer())
      .post(`/dpia-screenings/${created.id}/review`)
      .set(bearer(dpo.accessToken))
      .expect(422);
  });

  it('any single Yes requires DPO review, and a completed review leaves the outcome unchanged', async () => {
    const app = await boot();
    const dpo = await makeUser(
      app,
      'dpia-dpo-review',
      'DATA_PROTECTION_OFFICER',
    );

    const created = (
      await request(app.getHttpServer())
        .post('/dpia-screenings')
        .set(bearer(dpo.accessToken))
        .send({
          subjectDescription: 'New biometric fraud-detection feature.',
          ...ALL_NO,
          qSensitiveData: true,
        })
        .expect(201)
    ).body as DpiaScreeningBody;
    expect(created.outcome).toBe('DPO_REVIEW_REQUIRED');
    expect(created.dpoReviewDueAt).not.toBeNull();

    const reviewed = (
      await request(app.getHttpServer())
        .post(`/dpia-screenings/${created.id}/review`)
        .set(bearer(dpo.accessToken))
        .expect(201)
    ).body as DpiaScreeningBody;
    expect(reviewed.outcome).toBe('DPO_REVIEW_REQUIRED');
    expect(reviewed.dpoReviewedAt).not.toBeNull();

    // mutually exclusive with escalation now
    await request(app.getHttpServer())
      .post(`/dpia-screenings/${created.id}/escalate`)
      .set(bearer(dpo.accessToken))
      .expect(422);
  });

  it('escalates a materially high-risk screening to a Full DPIA, and blocks a subsequent ordinary review', async () => {
    const app = await boot();
    const dpo = await makeUser(
      app,
      'dpia-dpo-escalate',
      'DATA_PROTECTION_OFFICER',
    );

    const created = (
      await request(app.getHttpServer())
        .post('/dpia-screenings')
        .set(bearer(dpo.accessToken))
        .send({
          subjectDescription: 'New cross-border customer analytics platform.',
          ...ALL_NO,
          qCrossBorderTransfer: true,
          qLargeScaleProcessing: true,
        })
        .expect(201)
    ).body as DpiaScreeningBody;

    const escalated = (
      await request(app.getHttpServer())
        .post(`/dpia-screenings/${created.id}/escalate`)
        .set(bearer(dpo.accessToken))
        .expect(201)
    ).body as DpiaScreeningBody;
    expect(escalated.outcome).toBe('ESCALATED_FULL_DPIA');
    expect(escalated.escalatedToFullDpiaAt).not.toBeNull();

    await request(app.getHttpServer())
      .post(`/dpia-screenings/${created.id}/review`)
      .set(bearer(dpo.accessToken))
      .expect(422);
  });

  it('404s an unknown screening', async () => {
    const app = await boot();
    const dpo = await makeUser(app, 'dpia-dpo-404', 'DATA_PROTECTION_OFFICER');
    await request(app.getHttpServer())
      .get('/dpia-screenings/00000000-0000-0000-0000-000000000000')
      .set(bearer(dpo.accessToken))
      .expect(404);
  });
});

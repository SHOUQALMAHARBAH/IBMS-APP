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
interface DsrQueueItemBody {
  id: string;
  status: string;
  daysUntilDue: number;
}
interface DpoWorkspaceSummaryBody {
  generatedAt: string;
  consentStatus: {
    activeCount: number;
    withdrawnCount: number;
    declinedCount: number;
  };
  dsrQueue: DsrQueueItemBody[];
  incidentRegister: { id: string; status: string }[];
  dpiaRegister: { id: string; outcome: string }[];
  legalHoldRegister: { id: string; releasedAt: string | null }[];
  crossBorderTransferRegister: { id: string }[];
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
    .send({ fullName: 'DPO Workspace E2E User', email, password: PASSWORD })
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

describe('DPO Workspace (e2e) — backlog Part D §5.1, Process #52 item #9', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates the summary behind the new dpo-workspace.view permission', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'workspace-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .get('/dpo-workspace/summary')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('surfaces a fresh open DSR, an active Legal Hold, and a fresh cross-border transfer as BEFORE/AFTER deltas (db-test is cumulative)', async () => {
    const app = await boot();
    const dpo = await makeUser(app, 'workspace-dpo', 'DATA_PROTECTION_OFFICER');

    const before = (
      await request(app.getHttpServer())
        .get('/dpo-workspace/summary')
        .set(bearer(dpo.accessToken))
        .expect(200)
    ).body as DpoWorkspaceSummaryBody;

    const customer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: `DPO Workspace E2E ${Math.random().toString(36).slice(2, 8)}`,
        ownerUserId: dpo.userId,
      },
    });

    const dsr = (
      await request(app.getHttpServer())
        .post('/dsr')
        .set(bearer(dpo.accessToken))
        .send({ type: 'ACCESS', customerId: customer.id })
        .expect(201)
    ).body as { id: string };

    const hold = (
      await request(app.getHttpServer())
        .post('/legal-holds')
        .set(bearer(dpo.accessToken))
        .send({
          scope: 'DPO Workspace e2e file',
          reason: 'Litigation pending.',
        })
        .expect(201)
    ).body as { id: string };

    const transfer = (
      await request(app.getHttpServer())
        .post('/cross-border-transfers')
        .set(bearer(dpo.accessToken))
        .send({
          description: 'DPO Workspace e2e transfer.',
          destinationCountry: 'Germany',
          legalBasis: 'explicit_consent',
        })
        .expect(201)
    ).body as { id: string };

    const after = (
      await request(app.getHttpServer())
        .get('/dpo-workspace/summary')
        .set(bearer(dpo.accessToken))
        .expect(200)
    ).body as DpoWorkspaceSummaryBody;

    expect(after.dsrQueue.length).toBe(before.dsrQueue.length + 1);
    expect(after.dsrQueue.find((d) => d.id === dsr.id)).toBeTruthy();
    expect(
      after.dsrQueue.find((d) => d.id === dsr.id)?.daysUntilDue,
    ).toBeGreaterThan(0);

    expect(after.legalHoldRegister.length).toBe(
      before.legalHoldRegister.length + 1,
    );
    expect(after.legalHoldRegister.find((h) => h.id === hold.id)).toBeTruthy();

    expect(after.crossBorderTransferRegister.length).toBeGreaterThanOrEqual(
      before.crossBorderTransferRegister.length + 1,
    );
    expect(
      after.crossBorderTransferRegister.find((t) => t.id === transfer.id),
    ).toBeTruthy();
  });

  it('excludes a DPIA screening in the AUTO_APPROVED outcome, and includes one requiring DPO review', async () => {
    const app = await boot();
    const dpo = await makeUser(
      app,
      'workspace-dpo-dpia',
      'DATA_PROTECTION_OFFICER',
    );

    const autoApproved = (
      await request(app.getHttpServer())
        .post('/dpia-screenings')
        .set(bearer(dpo.accessToken))
        .send({
          subjectDescription: 'DPO Workspace e2e — no risk feature.',
          qSensitiveData: false,
          qLargeScaleProcessing: false,
          qCrossBorderTransfer: false,
          qNewTechnologyMonitoring: false,
          qNewDigitalChannel: false,
        })
        .expect(201)
    ).body as { id: string };

    const needsReview = (
      await request(app.getHttpServer())
        .post('/dpia-screenings')
        .set(bearer(dpo.accessToken))
        .send({
          subjectDescription: 'DPO Workspace e2e — sensitive-data feature.',
          qSensitiveData: true,
          qLargeScaleProcessing: false,
          qCrossBorderTransfer: false,
          qNewTechnologyMonitoring: false,
          qNewDigitalChannel: false,
        })
        .expect(201)
    ).body as { id: string };

    const summary = (
      await request(app.getHttpServer())
        .get('/dpo-workspace/summary')
        .set(bearer(dpo.accessToken))
        .expect(200)
    ).body as DpoWorkspaceSummaryBody;

    expect(
      summary.dpiaRegister.find((d) => d.id === needsReview.id),
    ).toBeTruthy();
    expect(
      summary.dpiaRegister.find((d) => d.id === autoApproved.id),
    ).toBeFalsy();
  });
});

import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
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
): Promise<{ accessToken: string; userId: string; totpSecret: string }> {
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
  // Kept so a test can perform a STEP-UP: `GET /ropa-entries/export` carries
  // `@RequireStepUp()` since module 0-c batch 6b, and step-up is a password re-entry PLUS a
  // live MFA code — the secret is the only way to produce the second half.
  const totpSecret = secretFromOtpAuthUri(enrollBody.otpAuthUri);
  await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(totpSecret),
    })
    .expect(200);

  for (const roleName of roles) {
    const role = await ensureRole(roleName);
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
  return { accessToken, userId: user.id, totpSecret };
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

    /*
     * ROW 68 — THE EXPORT IS BEHIND A STEP-UP NOW, AND THIS TEST IS THE PROOF.
     * Re-pointed 2026-11-06 (module 0-c batch 6b), with the reversal stated.
     *
     * This read `.expect(200)` on the bare session, which pinned an UNCHALLENGED export as correct
     * behaviour. `require-step-up.decorator.ts` has always named "data export" as one of its three
     * cases, and the gate was wired to exactly one route in the api — none of the three.
     *
     * The 403 FIRST is what makes the decoration load-bearing rather than decorative: remove
     * `@RequireStepUp()` from the route and this assertion fails, because the export goes through
     * unchallenged. An updated 200-after-step-up on its own would pass either way.
     */
    await request(app.getHttpServer())
      .get('/ropa-entries/export')
      .set(bearer(dpo.accessToken))
      .expect(403);

    // A password re-entry AND a live code — re-proving the first factor, not just the second, so a
    // bystander at an unlocked machine cannot export the register.
    await request(app.getHttpServer())
      .post('/auth/step-up')
      .set(bearer(dpo.accessToken))
      .send({
        password: PASSWORD,
        code: authenticator.generate(dpo.totpSecret),
      })
      .expect(200);

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

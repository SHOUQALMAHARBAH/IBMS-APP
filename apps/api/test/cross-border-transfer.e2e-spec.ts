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
interface CrossBorderTransferBody {
  id: string;
  destinationCountry: string;
  legalBasis: string;
  approvedByUserId: string | null;
  transferredAt: string;
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
    .send({ fullName: 'CBT E2E User', email, password: PASSWORD })
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

describe('Cross-Border Transfer (e2e) — backlog Part D §5.1, Process #52', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates every route behind cross-border-transfer.approve', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'cbt-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/cross-border-transfers')
      .set(bearer(outsider.accessToken))
      .send({
        description: 'x',
        destinationCountry: 'UK',
        legalBasis: 'statutory_exception',
      })
      .expect(403);
    await request(app.getHttpServer())
      .get('/cross-border-transfers')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('rejects a legalBasis outside the documented 3-value set', async () => {
    const app = await boot();
    const dpo = await makeUser(app, 'cbt-dpo-bad', 'DATA_PROTECTION_OFFICER');
    await request(app.getHttpServer())
      .post('/cross-border-transfers')
      .set(bearer(dpo.accessToken))
      .send({
        description: 'x',
        destinationCountry: 'UK',
        legalBasis: 'trust_me',
      })
      .expect(400);
  });

  it('rejects Jordan as a destination — this record type only covers transfers outside Jordan', async () => {
    const app = await boot();
    const dpo = await makeUser(
      app,
      'cbt-dpo-jordan',
      'DATA_PROTECTION_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/cross-border-transfers')
      .set(bearer(dpo.accessToken))
      .send({
        description: 'x',
        destinationCountry: 'Jordan',
        legalBasis: 'statutory_exception',
      })
      .expect(400);
  });

  it('walks create (approval is implicit) -> list (filtered) -> get, and stamps approvedByUserId to the caller', async () => {
    const app = await boot();
    const dpo = await makeUser(app, 'cbt-dpo-walk', 'DATA_PROTECTION_OFFICER');

    const created = (
      await request(app.getHttpServer())
        .post('/cross-border-transfers')
        .set(bearer(dpo.accessToken))
        .send({
          description: 'Reinsurance claim file shared with a UK reinsurer.',
          destinationCountry: 'United Kingdom',
          legalBasis: 'standard_contractual_clauses',
          legalBasisEvidenceRef: 'scc-doc-1',
        })
        .expect(201)
    ).body as CrossBorderTransferBody;
    expect(created.approvedByUserId).toBe(dpo.userId);
    expect(created.legalBasis).toBe('standard_contractual_clauses');

    const list = (
      await request(app.getHttpServer())
        .get('/cross-border-transfers?legalBasis=standard_contractual_clauses')
        .set(bearer(dpo.accessToken))
        .expect(200)
    ).body as CrossBorderTransferBody[];
    expect(list.find((r) => r.id === created.id)).toBeTruthy();

    const fetched = (
      await request(app.getHttpServer())
        .get(`/cross-border-transfers/${created.id}`)
        .set(bearer(dpo.accessToken))
        .expect(200)
    ).body as CrossBorderTransferBody;
    expect(fetched.destinationCountry).toBe('United Kingdom');
  });

  it('404s an unknown record', async () => {
    const app = await boot();
    const dpo = await makeUser(app, 'cbt-dpo-404', 'DATA_PROTECTION_OFFICER');
    await request(app.getHttpServer())
      .get('/cross-border-transfers/00000000-0000-0000-0000-000000000000')
      .set(bearer(dpo.accessToken))
      .expect(404);
  });
});

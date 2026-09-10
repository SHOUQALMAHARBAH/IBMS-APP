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
interface DataSharingApprovalBody {
  id: string;
  vendorId: string | null;
  requestedByUserId: string;
  approvedByUserId: string | null;
  isPending: boolean;
  isApproved: boolean;
  isDeclined: boolean;
  slaDueAt: string;
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
    .send({ fullName: 'DSA E2E User', email, password: PASSWORD })
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

describe('Third Parties & Data Sharing (e2e) — backlog Part D §5.1, Process #52', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates create behind data-sharing.request and decisions behind data-sharing.approve', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'dsa-outsider',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const sales = await makeUser(
      app,
      'dsa-sales-gate',
      'SALES_RELATIONSHIP_OFFICER',
    );

    await request(app.getHttpServer())
      .post('/data-sharing-approvals')
      .set(bearer(outsider.accessToken))
      .send({
        description: 'x'.repeat(30),
        classification: 'INTERNAL',
        channel: 'ENCRYPTED_EMAIL',
      })
      .expect(403);

    const created = (
      await request(app.getHttpServer())
        .post('/data-sharing-approvals')
        .set(bearer(sales.accessToken))
        .send({
          description: 'x'.repeat(30),
          classification: 'INTERNAL',
          channel: 'ENCRYPTED_EMAIL',
        })
        .expect(201)
    ).body as DataSharingApprovalBody;

    await request(app.getHttpServer())
      .post(`/data-sharing-approvals/${created.id}/approve`)
      .set(bearer(sales.accessToken))
      .expect(403); // holds data-sharing.request, not data-sharing.approve
  });

  it('creates without a vendor (a genuinely one-off share), skipping the risk-tiering check entirely', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'dsa-sales-oneoff',
      'SALES_RELATIONSHIP_OFFICER',
    );

    const created = (
      await request(app.getHttpServer())
        .post('/data-sharing-approvals')
        .set(bearer(sales.accessToken))
        .send({
          description:
            'Claims documents shared with a one-off external loss adjuster, no standing vendor relationship.',
          classification: 'CONFIDENTIAL',
          channel: 'ENCRYPTED_EMAIL',
        })
        .expect(201)
    ).body as DataSharingApprovalBody;
    expect(created.vendorId).toBeNull();
    expect(created.isPending).toBe(true);
  });

  it('rejects an insecure channel for CONFIDENTIAL data', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'dsa-sales-insecure',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/data-sharing-approvals')
      .set(bearer(sales.accessToken))
      .send({
        description: 'Confidential claim documents sent over plain email.',
        classification: 'CONFIDENTIAL',
        channel: 'UNENCRYPTED_EMAIL',
      })
      .expect(400);
  });

  it('422s a share with a Medium-tier vendor that has no signed DPA on file (the #71 readiness gate, wired live for the first time)', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'dsa-sales-notready',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const vendor = await prisma.vendor.create({
      data: {
        name: 'Not-Ready Adjuster Co',
        vendorType: 'loss_adjuster',
        riskTier: 'medium',
      },
    });

    await request(app.getHttpServer())
      .post('/data-sharing-approvals')
      .set(bearer(sales.accessToken))
      .send({
        description:
          'Claim documents shared with a Medium-tier vendor with no DPA yet.',
        classification: 'CONFIDENTIAL',
        channel: 'ENCRYPTED_EMAIL',
        vendorId: vendor.id,
      })
      .expect(422);
  });

  it('a regulatory channel bypasses the vendor-risk check even for an unready High-tier vendor, but still enforces the channel/classification check', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'dsa-sales-reg',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const vendor = await prisma.vendor.create({
      data: {
        name: 'Unready High Tier Co',
        vendorType: 'it_cloud',
        riskTier: 'high',
      },
    });

    const created = (
      await request(app.getHttpServer())
        .post('/data-sharing-approvals')
        .set(bearer(sales.accessToken))
        .send({
          description:
            'A regulatory filing shared through the CBJ portal for an unready vendor.',
          classification: 'HIGHLY_CONFIDENTIAL',
          channel: 'CBJ_REGULATORY_PORTAL',
          vendorId: vendor.id,
          isRegulatoryChannel: true,
        })
        .expect(201)
    ).body as DataSharingApprovalBody;
    expect(created.vendorId).toBe(vendor.id);
  });

  it('walks a ready vendor share through to approval, enforcing maker/checker segregation', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'dsa-sales-ready',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const dpo = await makeUser(app, 'dsa-dpo-ready', 'DATA_PROTECTION_OFFICER');
    const vendor = await prisma.vendor.create({
      data: {
        name: 'Ready Vendor Co',
        vendorType: 'printing_archiving',
        riskTier: 'low',
      },
    });

    const created = (
      await request(app.getHttpServer())
        .post('/data-sharing-approvals')
        .set(bearer(sales.accessToken))
        .send({
          description:
            'Policy documents shared for archival printing with a Low-tier, ready vendor.',
          classification: 'INTERNAL',
          channel: 'VENDOR_SECURE_PORTAL',
          vendorId: vendor.id,
        })
        .expect(201)
    ).body as DataSharingApprovalBody;

    await request(app.getHttpServer())
      .post(`/data-sharing-approvals/${created.id}/approve`)
      .set(bearer(sales.accessToken))
      .expect(403); // requester cannot approve their own request

    const approved = (
      await request(app.getHttpServer())
        .post(`/data-sharing-approvals/${created.id}/approve`)
        .set(bearer(dpo.accessToken))
        .expect(201)
    ).body as DataSharingApprovalBody;
    expect(approved.isApproved).toBe(true);
    expect(approved.approvedByUserId).toBe(dpo.userId);

    await request(app.getHttpServer())
      .post(`/data-sharing-approvals/${created.id}/approve`)
      .set(bearer(dpo.accessToken))
      .expect(422); // already decided
  });

  it('declines a request, leaving approvedByUserId null', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'dsa-sales-decline',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const dpo = await makeUser(
      app,
      'dsa-dpo-decline',
      'DATA_PROTECTION_OFFICER',
    );

    const created = (
      await request(app.getHttpServer())
        .post('/data-sharing-approvals')
        .set(bearer(sales.accessToken))
        .send({
          description:
            'A marketing data share request that should be declined.',
          classification: 'INTERNAL',
          channel: 'ENCRYPTED_EMAIL',
        })
        .expect(201)
    ).body as DataSharingApprovalBody;

    const declined = (
      await request(app.getHttpServer())
        .post(`/data-sharing-approvals/${created.id}/decline`)
        .set(bearer(dpo.accessToken))
        .expect(201)
    ).body as DataSharingApprovalBody;
    expect(declined.isDeclined).toBe(true);
    expect(declined.approvedByUserId).toBeNull();
  });

  it('404s an unknown vendorId', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'dsa-sales-404vendor',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/data-sharing-approvals')
      .set(bearer(sales.accessToken))
      .send({
        description: 'x'.repeat(30),
        classification: 'INTERNAL',
        channel: 'ENCRYPTED_EMAIL',
        vendorId: '00000000-0000-0000-0000-000000000000',
      })
      .expect(404);
  });
});

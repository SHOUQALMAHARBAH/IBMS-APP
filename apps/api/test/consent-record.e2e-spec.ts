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
interface ConsentRecordBody {
  id: string;
  customerId: string | null;
  insuredPersonId: string | null;
  purpose: string;
  isMarketing: boolean;
  granted: boolean;
  consentTextVersion: string;
  grantedAt: string | null;
  withdrawnAt: string | null;
  isActive: boolean;
  createdAt: string;
}
interface RequestWithdrawalBody {
  consentRecordId: string;
  requestedAt: string;
  dueAt: string | null;
}
interface ConsentStatusBody {
  customerId: string;
  marketing: {
    allowed: boolean;
    reason: string;
    consentRecordId: string | null;
  };
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
    .send({ fullName: 'Consent E2E User', email, password: PASSWORD })
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

describe('Consent Management (e2e) — Part D §5.1 / M03', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('captures, reads, and withdraws consent through the two-step request/confirm flow, and feeds Process 44s marketing gate', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'consent-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const dpo = await makeUser(app, 'consent-dpo', 'DATA_PROTECTION_OFFICER');
    const finance = await makeUser(
      app,
      'consent-fin',
      'FINANCE_COLLECTIONS_OFFICER',
    );

    const customer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: `Consent E2E ${Math.random().toString(36).slice(2, 8)}`,
        ownerUserId: sales.userId,
      },
    });
    const insuredPerson = await prisma.insuredPerson.create({
      data: {
        customerId: customer.id,
        role: 'employee_group_medical',
        fullName: 'Consent E2E Dependent',
      },
    });

    // a role outside [Sales, Placement, Claims, DPO] cannot manage consent
    await request(app.getHttpServer())
      .post('/consent-records')
      .set(bearer(finance.accessToken))
      .send({
        customerId: customer.id,
        purpose: 'MARKETING',
        granted: true,
        consentTextVersion: 'privacy-notice-v1.2',
      })
      .expect(403);

    // exactly one of customerId / insuredPersonId — both, or neither, is 422
    await request(app.getHttpServer())
      .post('/consent-records')
      .set(bearer(sales.accessToken))
      .send({
        customerId: customer.id,
        insuredPersonId: insuredPerson.id,
        purpose: 'MARKETING',
        granted: true,
        consentTextVersion: 'v1',
      })
      .expect(422);
    await request(app.getHttpServer())
      .post('/consent-records')
      .set(bearer(sales.accessToken))
      .send({ purpose: 'MARKETING', granted: true, consentTextVersion: 'v1' })
      .expect(422);

    // unknown customer -> 404
    await request(app.getHttpServer())
      .post('/consent-records')
      .set(bearer(sales.accessToken))
      .send({
        customerId: '11111111-1111-4111-8111-111111111111',
        purpose: 'MARKETING',
        granted: true,
        consentTextVersion: 'v1',
      })
      .expect(404);

    // capture a MARKETING grant — isMarketing is derived, grantedAt stamped
    const granted = await request(app.getHttpServer())
      .post('/consent-records')
      .set(bearer(sales.accessToken))
      .send({
        customerId: customer.id,
        purpose: 'MARKETING',
        granted: true,
        consentTextVersion: 'privacy-notice-v1.2',
      })
      .expect(201);
    const marketingConsent = granted.body as ConsentRecordBody;
    expect(marketingConsent.isMarketing).toBe(true);
    expect(marketingConsent.granted).toBe(true);
    expect(marketingConsent.grantedAt).not.toBeNull();
    expect(marketingConsent.isActive).toBe(true);
    const marketingId = marketingConsent.id;

    // capture an explicit decline — recorded, not silently dropped; no
    // grantedAt, isMarketing false for a non-marketing purpose
    const declined = await request(app.getHttpServer())
      .post('/consent-records')
      .set(bearer(sales.accessToken))
      .send({
        customerId: customer.id,
        purpose: 'KYC_AML',
        granted: false,
        consentTextVersion: 'kyc-notice-v1',
      })
      .expect(201);
    const declinedConsent = declined.body as ConsentRecordBody;
    expect(declinedConsent.granted).toBe(false);
    expect(declinedConsent.grantedAt).toBeNull();
    expect(declinedConsent.isMarketing).toBe(false);

    // capture a grant for the InsuredPerson (the other valid owner)
    const ipGrant = await request(app.getHttpServer())
      .post('/consent-records')
      .set(bearer(sales.accessToken))
      .send({
        insuredPersonId: insuredPerson.id,
        purpose: 'UNDERWRITING',
        granted: true,
        consentTextVersion: 'underwriting-notice-v1',
      })
      .expect(201);
    const ipConsentId = (ipGrant.body as ConsentRecordBody).id;

    // withdrawing a never-granted record is 422
    await request(app.getHttpServer())
      .post(`/consent-records/${declinedConsent.id}/request-withdrawal`)
      .set(bearer(dpo.accessToken))
      .expect(422);

    // request-withdrawal starts the SLA clock without touching the register
    const reqWd = await request(app.getHttpServer())
      .post(`/consent-records/${marketingId}/request-withdrawal`)
      .set(bearer(dpo.accessToken))
      .expect(201);
    const wd = reqWd.body as RequestWithdrawalBody;
    expect(wd.dueAt).not.toBeNull();
    const stillActive = await request(app.getHttpServer())
      .get(`/consent-records/${marketingId}`)
      .set(bearer(dpo.accessToken))
      .expect(200);
    expect((stillActive.body as ConsentRecordBody).withdrawnAt).toBeNull();

    // the generic SlaTimer row exists for this ConsentRecord
    const timers = await prisma.slaTimer.findMany({
      where: { entityType: 'ConsentRecord', entityId: marketingId },
    });
    expect(timers).toHaveLength(1);
    expect(timers[0]?.workflowName).toBe('consent_withdrawal');
    expect(timers[0]?.resolvedAt).toBeNull();

    // confirm-withdrawal reflects it in the register and resolves the timer
    const confirmed = await request(app.getHttpServer())
      .post(`/consent-records/${marketingId}/confirm-withdrawal`)
      .set(bearer(dpo.accessToken))
      .expect(201);
    const withdrawn = confirmed.body as ConsentRecordBody;
    expect(withdrawn.withdrawnAt).not.toBeNull();
    expect(withdrawn.isActive).toBe(false);
    const resolvedTimer = await prisma.slaTimer.findFirst({
      where: { entityType: 'ConsentRecord', entityId: marketingId },
    });
    expect(resolvedTimer?.resolvedAt).not.toBeNull();

    // idempotent re-confirm
    await request(app.getHttpServer())
      .post(`/consent-records/${marketingId}/confirm-withdrawal`)
      .set(bearer(dpo.accessToken))
      .expect(201);

    // a standalone confirm-withdrawal with no prior request-withdrawal call
    // also works (no SlaTimer row existed for this record beforehand)
    const ipWithdrawn = await request(app.getHttpServer())
      .post(`/consent-records/${ipConsentId}/confirm-withdrawal`)
      .set(bearer(dpo.accessToken))
      .expect(201);
    expect((ipWithdrawn.body as ConsentRecordBody).withdrawnAt).not.toBeNull();

    // Process 44's marketing gate reads the live withdrawal immediately —
    // "affected communications suppressed immediately" for free
    const status = await request(app.getHttpServer())
      .get(`/communications/consent-status?customerId=${customer.id}`)
      .set(bearer(sales.accessToken))
      .expect(200);
    const marketingStatus = status.body as ConsentStatusBody;
    expect(marketingStatus.marketing.allowed).toBe(false);
    expect(marketingStatus.marketing.reason).toBe('withdrawn');

    // reads: filters
    const byCustomer = await request(app.getHttpServer())
      .get(`/consent-records?customerId=${customer.id}`)
      .set(bearer(dpo.accessToken))
      .expect(200);
    const custIds = (byCustomer.body as ConsentRecordBody[]).map((r) => r.id);
    expect(custIds).toContain(marketingId);
    expect(custIds).toContain(declinedConsent.id);
    expect(custIds).not.toContain(ipConsentId);

    const declinedOnly = await request(app.getHttpServer())
      .get(`/consent-records?customerId=${customer.id}&granted=false`)
      .set(bearer(dpo.accessToken))
      .expect(200);
    expect((declinedOnly.body as ConsentRecordBody[]).map((r) => r.id)).toEqual(
      [declinedConsent.id],
    );

    // audit: CREATE for the capture, UPDATE for the withdrawal
    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: 'ConsentRecord', entityId: marketingId },
    });
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('CREATE');
    expect(actions).toContain('UPDATE');
  });
});

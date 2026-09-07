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
interface CommunicationBody {
  id: string;
  customerId: string | null;
  channel: string;
  languageUsed: string | null;
  direction: string;
  isMarketing: boolean;
  respectedConsent: boolean;
  consentRecordId: string | null;
  subject: string | null;
  body: string | null;
  loggedByUserId: string | null;
  sentAt: string;
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
    .send({ fullName: 'Comm E2E User', email, password: PASSWORD })
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

describe('Customer Communication (e2e) — backlog Part C #44', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('logs an outbound communication respecting the recorded channel/language and gates a marketing send on ConsentRecord', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'comm-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const compliance = await makeUser(
      app,
      'comm-compliance',
      'COMPLIANCE_OFFICER',
    );

    const customer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: `Comm E2E Co ${Math.random().toString(36).slice(2, 8)}`,
        ownerUserId: sales.userId,
        languagePreference: 'AR',
        preferredContactChannel: 'EMAIL',
      },
    });
    const noChannelCustomer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: 'Comm E2E NoChannel',
        ownerUserId: sales.userId,
        languagePreference: 'EN',
      },
    });

    // an RFQ-correspondence row on the same table (rfqId set) — must never
    // surface through the Process-44 endpoints
    const opp = await prisma.opportunity.create({
      data: { customerId: customer.id },
    });
    const rfq = await prisma.rFQ.create({
      data: { opportunityId: opp.id, insuranceLine: 'Property All Risks' },
    });
    const rfqCorr = await prisma.communicationLog.create({
      data: {
        customerId: customer.id,
        rfqId: rfq.id,
        channel: 'EMAIL',
        direction: 'INBOUND',
        body: 'Insurer query about the sum insured',
      },
    });

    // --- permission + validation gates ---

    await request(app.getHttpServer())
      .post('/communications')
      .set(bearer(compliance.accessToken))
      .send({ customerId: customer.id, body: 'hello' })
      .expect(403);

    await request(app.getHttpServer())
      .post('/communications')
      .set(bearer(sales.accessToken))
      .send({
        customerId: '11111111-1111-4111-8111-111111111111',
        body: 'hello',
      })
      .expect(404);

    // channel disagrees with the recorded EMAIL -> 422
    await request(app.getHttpServer())
      .post('/communications')
      .set(bearer(sales.accessToken))
      .send({ customerId: customer.id, channel: 'SMS', body: 'hello' })
      .expect(422);

    // language disagrees with the recorded AR -> 422
    await request(app.getHttpServer())
      .post('/communications')
      .set(bearer(sales.accessToken))
      .send({ customerId: customer.id, languageUsed: 'EN', body: 'hello' })
      .expect(422);

    // a full account number in the body -> 400 (DTO guard)
    await request(app.getHttpServer())
      .post('/communications')
      .set(bearer(sales.accessToken))
      .send({
        customerId: customer.id,
        body: 'your account 123456789012 is overdue',
      })
      .expect(400);

    // --- a plain service (non-marketing) send: channel + language derived ---

    const serviceSend = await request(app.getHttpServer())
      .post('/communications')
      .set(bearer(sales.accessToken))
      .send({
        customerId: customer.id,
        body: 'Your renewal documents are attached.',
        subject: 'Renewal',
      })
      .expect(201);
    const s = serviceSend.body as CommunicationBody;
    expect(s.channel).toBe('EMAIL');
    expect(s.languageUsed).toBe('AR');
    expect(s.direction).toBe('OUTBOUND');
    expect(s.isMarketing).toBe(false);
    expect(s.respectedConsent).toBe(true);
    expect(s.consentRecordId).toBeNull();
    expect(s.loggedByUserId).toBe(sales.userId);

    // --- a marketing send with NO consent on file -> 422, no row ---

    await request(app.getHttpServer())
      .post('/communications')
      .set(bearer(sales.accessToken))
      .send({
        customerId: customer.id,
        isMarketing: true,
        body: 'Check out our new motor product!',
      })
      .expect(422);

    // a malformed customerId on consent-status -> 400 (not a downstream 404)
    await request(app.getHttpServer())
      .get('/communications/consent-status?customerId=not-a-uuid')
      .set(bearer(sales.accessToken))
      .expect(400);

    const beforeStatus = await request(app.getHttpServer())
      .get(`/communications/consent-status?customerId=${customer.id}`)
      .set(bearer(sales.accessToken))
      .expect(200);
    expect((beforeStatus.body as ConsentStatusBody).marketing.allowed).toBe(
      false,
    );
    expect((beforeStatus.body as ConsentStatusBody).marketing.reason).toBe(
      'no_record',
    );

    // --- grant marketing consent, then the same send succeeds ---

    const consent = await prisma.consentRecord.create({
      data: {
        customerId: customer.id,
        purpose: 'MARKETING',
        isMarketing: true,
        granted: true,
        consentTextVersion: 'v1',
        grantedAt: new Date(),
      },
    });

    const afterStatus = await request(app.getHttpServer())
      .get(`/communications/consent-status?customerId=${customer.id}`)
      .set(bearer(sales.accessToken))
      .expect(200);
    expect((afterStatus.body as ConsentStatusBody).marketing).toEqual({
      allowed: true,
      reason: 'granted',
      consentRecordId: consent.id,
    });

    const marketingSend = await request(app.getHttpServer())
      .post('/communications')
      .set(bearer(sales.accessToken))
      .send({
        customerId: customer.id,
        isMarketing: true,
        body: 'Check out our new motor product!',
      })
      .expect(201);
    const m = marketingSend.body as CommunicationBody;
    expect(m.isMarketing).toBe(true);
    expect(m.consentRecordId).toBe(consent.id);
    expect(m.channel).toBe('EMAIL');

    // --- withdraw consent -> a marketing send is blocked again ---

    await prisma.consentRecord.update({
      where: { id: consent.id },
      data: { withdrawnAt: new Date() },
    });
    const withdrawnStatus = await request(app.getHttpServer())
      .get(`/communications/consent-status?customerId=${customer.id}`)
      .set(bearer(sales.accessToken))
      .expect(200);
    expect((withdrawnStatus.body as ConsentStatusBody).marketing.reason).toBe(
      'withdrawn',
    );
    await request(app.getHttpServer())
      .post('/communications')
      .set(bearer(sales.accessToken))
      .send({
        customerId: customer.id,
        isMarketing: true,
        body: 'One more promo',
      })
      .expect(422);

    // --- a customer with no recorded channel: omit -> 422, explicit -> 201 ---

    await request(app.getHttpServer())
      .post('/communications')
      .set(bearer(sales.accessToken))
      .send({ customerId: noChannelCustomer.id, body: 'hi' })
      .expect(422);
    const explicitChannel = await request(app.getHttpServer())
      .post('/communications')
      .set(bearer(sales.accessToken))
      .send({
        customerId: noChannelCustomer.id,
        channel: 'WHATSAPP',
        body: 'hi',
      })
      .expect(201);
    expect((explicitChannel.body as CommunicationBody).channel).toBe(
      'WHATSAPP',
    );
    expect((explicitChannel.body as CommunicationBody).languageUsed).toBe('EN');

    // --- reads: Process-44 only (rfqId IS NULL), newest first ---

    const list = await request(app.getHttpServer())
      .get(`/communications?customerId=${customer.id}`)
      .set(bearer(sales.accessToken))
      .expect(200);
    const listBody = list.body as CommunicationBody[];
    const ids = listBody.map((r) => r.id);
    expect(ids).toContain(s.id);
    expect(ids).toContain(m.id);
    expect(ids).not.toContain(rfqCorr.id); // the RFQ-correspondence row is excluded

    const marketingOnly = await request(app.getHttpServer())
      .get(`/communications?customerId=${customer.id}&isMarketing=true`)
      .set(bearer(sales.accessToken))
      .expect(200);
    expect(
      (marketingOnly.body as CommunicationBody[]).map((r) => r.id),
    ).toEqual([m.id]);

    await request(app.getHttpServer())
      .get(`/communications/${s.id}`)
      .set(bearer(sales.accessToken))
      .expect(200);
    // an RFQ-correspondence id is not a customer communication -> 404
    await request(app.getHttpServer())
      .get(`/communications/${rfqCorr.id}`)
      .set(bearer(sales.accessToken))
      .expect(404);

    // --- audit: CREATE rows for the sends + a REJECT row for a blocked send ---

    const createRows = await prisma.auditLogEntry.findMany({
      where: { entityType: 'CommunicationLog', entityId: { in: [s.id, m.id] } },
    });
    expect(createRows.map((r) => r.action).sort()).toEqual([
      'CREATE',
      'CREATE',
    ]);
    expect(JSON.stringify(createRows)).not.toContain('new motor product');

    const rejectRows = await prisma.auditLogEntry.findMany({
      where: {
        entityType: 'CommunicationLog',
        entityId: 'blocked',
        action: 'REJECT',
      },
    });
    expect(
      rejectRows.some(
        (r) =>
          JSON.stringify(r.afterValue).includes(customer.id) &&
          JSON.stringify(r.afterValue).includes('marketing_consent_'),
      ),
    ).toBe(true);
  });
});

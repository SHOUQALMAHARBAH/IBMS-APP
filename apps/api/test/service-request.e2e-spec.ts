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
interface ServiceRequestBody {
  id: string;
  customerId: string;
  policyId: string | null;
  requestType: string;
  detail: string | null;
  status: string;
  isClosed: boolean;
  raisedByUserId: string | null;
  assignedToUserId: string | null;
  fulfilledByUserId: string | null;
  outcomeNote: string | null;
  sla: {
    timerId: string;
    dueAt: string;
    escalatedAt: string | null;
    escalatedTo: string | null;
    resolvedAt: string | null;
    breached: boolean;
  } | null;
  createdAt: string;
  closedAt: string | null;
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
    .send({ fullName: 'SR E2E User', email, password: PASSWORD })
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

describe('Customer Requests (e2e) — backlog Part C #41', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('logs a service request with an SLA timer, runs it open -> in_progress -> fulfilled, and resolves the timer on closure', async () => {
    const app = await boot();
    const sales = await makeUser(app, 'sr-sales', 'SALES_RELATIONSHIP_OFFICER');
    const mgr = await makeUser(app, 'sr-mgr', 'BRANCH_DEPARTMENT_MANAGER');
    const claims = await makeUser(app, 'sr-claims', 'CLAIMS_OFFICER');

    const customer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: `SR E2E Co ${Math.random().toString(36).slice(2, 8)}`,
        ownerUserId: sales.userId,
      },
    });
    const otherCustomer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: 'SR E2E Other',
        ownerUserId: sales.userId,
      },
    });
    const insurer = await prisma.insurer.create({
      data: { name: `SR E2E ins ${Math.random().toString(36).slice(2, 8)}` },
    });
    const opp = await prisma.opportunity.create({
      data: { customerId: otherCustomer.id },
    });
    const otherPolicy = await prisma.policy.create({
      data: {
        opportunityId: opp.id,
        customerId: otherCustomer.id,
        insurerId: insurer.id,
        insuranceLine: 'Property All Risks',
        requestedPremium: '1000.000',
        status: 'ACTIVE',
      },
    });

    // a non-Sales/Manager actor cannot manage service requests
    await request(app.getHttpServer())
      .post('/service-requests')
      .set(bearer(claims.accessToken))
      .send({ customerId: customer.id, requestType: 'certificate' })
      .expect(403);

    // unknown customer -> 404; a policy that belongs to another customer -> 422
    await request(app.getHttpServer())
      .post('/service-requests')
      .set(bearer(sales.accessToken))
      .send({
        customerId: '11111111-1111-4111-8111-111111111111',
        requestType: 'copy',
      })
      .expect(404);
    await request(app.getHttpServer())
      .post('/service-requests')
      .set(bearer(sales.accessToken))
      .send({
        customerId: customer.id,
        requestType: 'copy',
        policyId: otherPolicy.id,
      })
      .expect(422);

    // log the request — an SLA timer is created and linked, not yet breached
    const created = await request(app.getHttpServer())
      .post('/service-requests')
      .set(bearer(sales.accessToken))
      .send({
        customerId: customer.id,
        requestType: 'certificate',
        detail: 'Certificate of insurance for the landlord',
      })
      .expect(201);
    const req = created.body as ServiceRequestBody;
    expect(req.status).toBe('open');
    expect(req.raisedByUserId).toBe(sales.userId);
    expect(req.sla).not.toBeNull();
    expect(req.sla?.resolvedAt).toBeNull();
    expect(req.sla?.breached).toBe(false);
    expect(req.sla?.escalatedTo).toBe('BRANCH_DEPARTMENT_MANAGER');
    const id = req.id;

    // the generic SlaTimer row exists for this ServiceRequest
    const timers = await prisma.slaTimer.findMany({
      where: { entityType: 'ServiceRequest', entityId: id },
    });
    expect(timers).toHaveLength(1);
    expect(timers[0]?.workflowName).toBe('service_request_fulfilment');

    // assign to the manager
    const assigned = await request(app.getHttpServer())
      .post(`/service-requests/${id}/assign`)
      .set(bearer(sales.accessToken))
      .send({ assignedToUserId: mgr.userId })
      .expect(201);
    expect((assigned.body as ServiceRequestBody).assignedToUserId).toBe(
      mgr.userId,
    );

    // start -> in_progress; a second start is idempotent
    const started = await request(app.getHttpServer())
      .post(`/service-requests/${id}/start`)
      .set(bearer(mgr.accessToken))
      .send({})
      .expect(201);
    expect((started.body as ServiceRequestBody).status).toBe('in_progress');
    await request(app.getHttpServer())
      .post(`/service-requests/${id}/start`)
      .set(bearer(mgr.accessToken))
      .send({})
      .expect(201);

    // fulfil requires an outcome note
    await request(app.getHttpServer())
      .post(`/service-requests/${id}/fulfil`)
      .set(bearer(mgr.accessToken))
      .send({})
      .expect(400);

    const NOTE = 'Certificate issued and emailed to the customer contact.';
    const fulfilled = await request(app.getHttpServer())
      .post(`/service-requests/${id}/fulfil`)
      .set(bearer(mgr.accessToken))
      .send({ outcomeNote: NOTE })
      .expect(201);
    const done = fulfilled.body as ServiceRequestBody;
    expect(done.status).toBe('fulfilled');
    expect(done.isClosed).toBe(true);
    expect(done.fulfilledByUserId).toBe(mgr.userId);
    expect(done.outcomeNote).toBe(NOTE);
    expect(done.closedAt).not.toBeNull();
    // the SLA timer is now resolved
    expect(done.sla?.resolvedAt).not.toBeNull();
    expect(done.sla?.breached).toBe(false);

    // idempotent re-fulfil with the same note; a different note is a 409;
    // cancelling a fulfilled request is a 422
    await request(app.getHttpServer())
      .post(`/service-requests/${id}/fulfil`)
      .set(bearer(mgr.accessToken))
      .send({ outcomeNote: NOTE })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/service-requests/${id}/fulfil`)
      .set(bearer(mgr.accessToken))
      .send({ outcomeNote: 'a completely different closure note here' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/service-requests/${id}/cancel`)
      .set(bearer(mgr.accessToken))
      .send({ outcomeNote: 'trying to cancel a fulfilled request' })
      .expect(422);

    // a second request that gets cancelled straight from open
    const second = await request(app.getHttpServer())
      .post('/service-requests')
      .set(bearer(sales.accessToken))
      .send({ customerId: customer.id, requestType: 'change' })
      .expect(201);
    const secondId = (second.body as ServiceRequestBody).id;
    const cancelled = await request(app.getHttpServer())
      .post(`/service-requests/${secondId}/cancel`)
      .set(bearer(sales.accessToken))
      .send({ outcomeNote: 'Duplicate of the first request.' })
      .expect(201);
    expect((cancelled.body as ServiceRequestBody).status).toBe('cancelled');

    // reads: the customer's two requests, and one by id
    const list = await request(app.getHttpServer())
      .get(`/service-requests?customerId=${customer.id}`)
      .set(bearer(mgr.accessToken))
      .expect(200);
    const ids = (list.body as ServiceRequestBody[]).map((r) => r.id);
    expect(ids).toContain(id);
    expect(ids).toContain(secondId);

    const openOnly = await request(app.getHttpServer())
      .get(`/service-requests?customerId=${customer.id}&status=cancelled`)
      .set(bearer(mgr.accessToken))
      .expect(200);
    expect((openOnly.body as ServiceRequestBody[]).map((r) => r.id)).toEqual([
      secondId,
    ]);

    // audit: a CREATE + at least one UPDATE row for the fulfilled request
    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: 'ServiceRequest', entityId: id },
    });
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('CREATE');
    expect(actions).toContain('UPDATE');
    expect(JSON.stringify(audit)).toContain(NOTE);
  });
});

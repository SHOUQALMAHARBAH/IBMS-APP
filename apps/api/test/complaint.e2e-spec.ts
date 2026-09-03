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
interface ComplaintBody {
  id: string;
  customerId: string;
  claimId: string | null;
  issue: string;
  category: string | null;
  status: string;
  isClosed: boolean;
  responsibleEmployeeUserId: string | null;
  resolution: string | null;
  resolvedByUserId: string | null;
  closureApprovedByUserId: string | null;
  closedAt: string | null;
  sla: {
    timerId: string;
    dueAt: string;
    resolvedAt: string | null;
    breached: boolean;
    escalatedTo: string | null;
  } | null;
  actions: Array<{ id: string; actionText: string; takenByUserId: string }>;
  escalations: Array<{
    id: string;
    escalatedTo: string;
    escalatedByUserId: string | null;
    reason: string | null;
  }>;
  createdAt: string;
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
    .send({ fullName: 'Complaint E2E User', email, password: PASSWORD })
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

describe('Complaints Management (e2e) — backlog Part C #42', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('logs a complaint, works it, escalates to the dispute committee, resolves it, and closes it only with a distinct supervisor', async () => {
    const app = await boot();
    const sales = await makeUser(app, 'cx-sales', 'SALES_RELATIONSHIP_OFFICER');
    const handler = await makeUser(app, 'cx-claims', 'CLAIMS_OFFICER');
    const compliance = await makeUser(app, 'cx-comp', 'COMPLIANCE_OFFICER');
    const mgr = await makeUser(app, 'cx-mgr', 'BRANCH_DEPARTMENT_MANAGER');
    const mgr2 = await makeUser(app, 'cx-mgr2', 'BRANCH_DEPARTMENT_MANAGER');
    const noPerm = await makeUser(
      app,
      'cx-none',
      'PLACEMENT_TECHNICAL_OFFICER',
    );

    const customer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: `Cx E2E Co ${Math.random().toString(36).slice(2, 8)}`,
        ownerUserId: sales.userId,
      },
    });
    const otherCustomer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: 'Cx E2E Other',
        ownerUserId: sales.userId,
      },
    });
    const insurer = await prisma.insurer.create({
      data: { name: `Cx E2E ins ${Math.random().toString(36).slice(2, 8)}` },
    });
    const opp = await prisma.opportunity.create({
      data: { customerId: customer.id },
    });
    const policy = await prisma.policy.create({
      data: {
        opportunityId: opp.id,
        customerId: customer.id,
        insurerId: insurer.id,
        insuranceLine: 'Property All Risks',
        requestedPremium: '1000.000',
        status: 'ACTIVE',
      },
    });
    const claim = await prisma.claim.create({
      data: {
        policyId: policy.id,
        customerId: customer.id,
        lossDate: new Date('2026-08-01T00:00:00.000Z'),
        estimatedLoss: '5000.000',
      },
    });
    const otherOpp = await prisma.opportunity.create({
      data: { customerId: otherCustomer.id },
    });
    const otherPolicy = await prisma.policy.create({
      data: {
        opportunityId: otherOpp.id,
        customerId: otherCustomer.id,
        insurerId: insurer.id,
        insuranceLine: 'Motor',
        requestedPremium: '500.000',
        status: 'ACTIVE',
      },
    });
    const otherClaim = await prisma.claim.create({
      data: {
        policyId: otherPolicy.id,
        customerId: otherCustomer.id,
        lossDate: new Date('2026-08-02T00:00:00.000Z'),
        estimatedLoss: '900.000',
      },
    });

    // a user without complaint.log cannot log a complaint
    await request(app.getHttpServer())
      .post('/complaints')
      .set(bearer(noPerm.accessToken))
      .send({
        customerId: customer.id,
        issue: 'Nothing has happened for weeks',
      })
      .expect(403);

    // unknown customer -> 404; a claim belonging to another customer -> 422
    await request(app.getHttpServer())
      .post('/complaints')
      .set(bearer(sales.accessToken))
      .send({
        customerId: '11111111-1111-4111-8111-111111111111',
        issue: 'x'.repeat(10),
      })
      .expect(404);
    await request(app.getHttpServer())
      .post('/complaints')
      .set(bearer(sales.accessToken))
      .send({
        customerId: customer.id,
        issue: 'x'.repeat(10),
        claimId: otherClaim.id,
      })
      .expect(422);

    // a full card number in the issue text is rejected
    await request(app.getHttpServer())
      .post('/complaints')
      .set(bearer(sales.accessToken))
      .send({
        customerId: customer.id,
        issue: 'You double charged my card 4111111111111111 last month',
      })
      .expect(400);

    // log the complaint against the disputed claim
    const created = await request(app.getHttpServer())
      .post('/complaints')
      .set(bearer(sales.accessToken))
      .send({
        customerId: customer.id,
        issue: 'The settlement was 200 JOD below the assessed amount',
        category: 'denied_claim',
        claimId: claim.id,
      })
      .expect(201);
    const c = created.body as ComplaintBody;
    expect(c.status).toBe('LOGGED');
    expect(c.claimId).toBe(claim.id);
    expect(c.sla).not.toBeNull();
    expect(c.sla?.resolvedAt).toBeNull();
    expect(c.sla?.escalatedTo).toBe('BRANCH_DEPARTMENT_MANAGER');
    const id = c.id;

    const timers = await prisma.slaTimer.findMany({
      where: { entityType: 'Complaint', entityId: id },
    });
    expect(timers).toHaveLength(1);
    expect(timers[0]?.workflowName).toBe('complaint_resolution');

    // assign -> ASSIGNED
    const assigned = await request(app.getHttpServer())
      .post(`/complaints/${id}/assign`)
      .set(bearer(sales.accessToken))
      .send({ responsibleEmployeeUserId: handler.userId })
      .expect(201);
    expect((assigned.body as ComplaintBody).status).toBe('ASSIGNED');
    expect((assigned.body as ComplaintBody).responsibleEmployeeUserId).toBe(
      handler.userId,
    );

    // start -> IN_PROGRESS (idempotent)
    await request(app.getHttpServer())
      .post(`/complaints/${id}/start`)
      .set(bearer(handler.accessToken))
      .send({})
      .expect(201);
    const started = await request(app.getHttpServer())
      .post(`/complaints/${id}/start`)
      .set(bearer(handler.accessToken))
      .send({})
      .expect(201);
    expect((started.body as ComplaintBody).status).toBe('IN_PROGRESS');

    // an action note
    const acted = await request(app.getHttpServer())
      .post(`/complaints/${id}/actions`)
      .set(bearer(handler.accessToken))
      .send({ actionText: 'Asked the insurer to re-review the assessment.' })
      .expect(201);
    expect((acted.body as ComplaintBody).actions).toHaveLength(1);

    // a non-MANAGER/COMPLIANCE actor cannot escalate
    await request(app.getHttpServer())
      .post(`/complaints/${id}/escalate`)
      .set(bearer(sales.accessToken))
      .send({})
      .expect(403);

    // COMPLIANCE escalates to the dispute-resolution committee
    const escalated = await request(app.getHttpServer())
      .post(`/complaints/${id}/escalate`)
      .set(bearer(compliance.accessToken))
      .send({ reason: 'Insurer non-response after 20 business days' })
      .expect(201);
    const esc = escalated.body as ComplaintBody;
    expect(esc.status).toBe('ESCALATED');
    expect(esc.escalations).toHaveLength(1);
    expect(esc.escalations[0]?.escalatedTo).toBe(
      'dispute_resolution_committee',
    );
    expect(esc.escalations[0]?.escalatedByUserId).toBe(compliance.userId);
    // the internal-resolution SLA clock has stopped
    expect(esc.sla?.resolvedAt).not.toBeNull();

    // committee sent it back for handling
    await request(app.getHttpServer())
      .post(`/complaints/${id}/start`)
      .set(bearer(handler.accessToken))
      .send({})
      .expect(201);

    // the MANAGER resolves it (so we can test self-close is blocked)
    const RES =
      'Insurer agreed a top-up payment for the shortfall; customer notified and accepted.';
    await request(app.getHttpServer())
      .post(`/complaints/${id}/resolve`)
      .set(bearer(mgr.accessToken))
      .send({ resolution: RES })
      .expect(201);
    // idempotent same resolution; different resolution -> 409
    await request(app.getHttpServer())
      .post(`/complaints/${id}/resolve`)
      .set(bearer(mgr.accessToken))
      .send({ resolution: RES })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/complaints/${id}/resolve`)
      .set(bearer(mgr.accessToken))
      .send({ resolution: 'A completely different resolution statement here.' })
      .expect(409);

    // mandatory supervisor sign-off: the resolver cannot close their own case
    await request(app.getHttpServer())
      .post(`/complaints/${id}/close`)
      .set(bearer(mgr.accessToken))
      .send({})
      .expect(403);

    // a distinct MANAGER closes it
    const closed = await request(app.getHttpServer())
      .post(`/complaints/${id}/close`)
      .set(bearer(mgr2.accessToken))
      .send({})
      .expect(201);
    const done = closed.body as ComplaintBody;
    expect(done.status).toBe('CLOSED');
    expect(done.isClosed).toBe(true);
    expect(done.closureApprovedByUserId).toBe(mgr2.userId);
    expect(done.resolvedByUserId).toBe(mgr.userId);
    expect(done.closedAt).not.toBeNull();

    // idempotent re-close; escalating a closed complaint is a 422
    await request(app.getHttpServer())
      .post(`/complaints/${id}/close`)
      .set(bearer(mgr2.accessToken))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/complaints/${id}/escalate`)
      .set(bearer(mgr2.accessToken))
      .send({})
      .expect(422);

    // reads
    const byCustomer = await request(app.getHttpServer())
      .get(`/complaints?customerId=${customer.id}`)
      .set(bearer(mgr.accessToken))
      .expect(200);
    expect((byCustomer.body as ComplaintBody[]).map((x) => x.id)).toContain(id);

    const byClaim = await request(app.getHttpServer())
      .get(`/complaints?claimId=${claim.id}&status=CLOSED`)
      .set(bearer(mgr.accessToken))
      .expect(200);
    expect((byClaim.body as ComplaintBody[]).map((x) => x.id)).toEqual([id]);

    // audit: CREATE + UPDATE + TRANSITION rows on the Complaint, an
    // EscalationRecord CREATE, and the verbatim resolution somewhere
    const complaintAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: 'Complaint', entityId: id },
    });
    const actions = complaintAudit.map((a) => a.action);
    expect(actions).toContain('CREATE');
    expect(actions).toContain('UPDATE');
    expect(actions).toContain('TRANSITION');
    expect(JSON.stringify(complaintAudit)).toContain(RES);

    const escAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: 'EscalationRecord' },
    });
    expect(
      escAudit.some(
        (a) =>
          a.action === 'CREATE' && JSON.stringify(a.afterValue).includes(id),
      ),
    ).toBe(true);
  });
});

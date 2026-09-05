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
interface DsrBody {
  id: string;
  customerId: string | null;
  insuredPersonId: string | null;
  type: string;
  status: string;
  receivedAt: string;
  identityVerifiedAt: string | null;
  slaDueAt: string;
  accessExtensionAppliedAt: string | null;
  extensionReason: string | null;
  retentionScheduleReference: string | null;
  partialFulfilmentJustification: string | null;
  closedAt: string | null;
  dpoHandlerUserId: string | null;
  processedByUserId: string | null;
  closedByUserId: string | null;
  rejectionReason: string | null;
  noOpenRetentionHoldConfirmedAt: string | null;
  isOverdue: boolean;
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
    .send({ fullName: 'DSR E2E User', email, password: PASSWORD })
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

describe('Data Subject Request Management (e2e) — backlog Part D, Process #52 / M04', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('walks an ACCESS request through the full lifecycle with the extension, SLA timers, and mandatory DPO sign-off', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'dsr-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const dpo1 = await makeUser(app, 'dsr-dpo1', 'DATA_PROTECTION_OFFICER');
    const dpo2 = await makeUser(app, 'dsr-dpo2', 'DATA_PROTECTION_OFFICER');

    const customer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: `DSR E2E ${Math.random().toString(36).slice(2, 8)}`,
        ownerUserId: sales.userId,
      },
    });

    // exactly one of customerId / insuredPersonId — both, or neither, is 422
    await request(app.getHttpServer())
      .post('/dsr')
      .set(bearer(sales.accessToken))
      .send({ type: 'ACCESS' })
      .expect(422);

    // unknown customer -> 404
    await request(app.getHttpServer())
      .post('/dsr')
      .set(bearer(sales.accessToken))
      .send({
        customerId: '11111111-1111-4111-8111-111111111111',
        type: 'ACCESS',
      })
      .expect(404);

    // a role without dsr.log cannot create
    const outsider = await makeUser(
      app,
      'dsr-outsider',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/dsr')
      .set(bearer(outsider.accessToken))
      .send({ customerId: customer.id, type: 'ACCESS' })
      .expect(403);

    // create — logged the same business day (receivedAt is stamped, not
    // caller-suppliable); SLA due date computed for ACCESS (15 business days)
    const created = await request(app.getHttpServer())
      .post('/dsr')
      .set(bearer(sales.accessToken))
      .send({ customerId: customer.id, type: 'ACCESS' })
      .expect(201);
    const dsr = created.body as DsrBody;
    expect(dsr.status).toBe('RECEIVED');
    expect(dsr.slaDueAt).not.toBeNull();
    expect(dsr.identityVerifiedAt).toBeNull();

    // the generic SlaTimer rows exist — TWO stages for the DSR workflows
    // (DPO at T-3 business days, General Manager at the due date itself)
    const timers = await prisma.slaTimer.findMany({
      where: { entityType: 'DataSubjectRequest', entityId: dsr.id },
    });
    expect(timers).toHaveLength(2);
    expect(timers.map((t) => t.escalatedTo).sort()).toEqual(
      ['DATA_PROTECTION_OFFICER', 'GENERAL_MANAGER'].sort(),
    );

    // a non-DPO (dsr.handle) actor cannot work it
    await request(app.getHttpServer())
      .post(`/dsr/${dsr.id}/verify-identity`)
      .set(bearer(sales.accessToken))
      .expect(403);

    // start before verify-identity -> 422 (engine enforces the order)
    await request(app.getHttpServer())
      .post(`/dsr/${dsr.id}/start`)
      .set(bearer(dpo1.accessToken))
      .expect(422);

    // verify-identity, then start
    const verified = await request(app.getHttpServer())
      .post(`/dsr/${dsr.id}/verify-identity`)
      .set(bearer(dpo1.accessToken))
      .expect(201);
    expect((verified.body as DsrBody).status).toBe('IDENTITY_VERIFIED');
    expect((verified.body as DsrBody).identityVerifiedAt).not.toBeNull();

    const started = await request(app.getHttpServer())
      .post(`/dsr/${dsr.id}/start`)
      .set(bearer(dpo1.accessToken))
      .expect(201);
    expect((started.body as DsrBody).status).toBe('IN_PROGRESS');

    // GET :id — exercises the per-read audit row (DSR reads are audited,
    // unlike the Confidential-tier #33/#34/#41/#44/#45/#46/#51 no-audit
    // precedent — see dsr.service.ts's own header comment)
    const got = await request(app.getHttpServer())
      .get(`/dsr/${dsr.id}`)
      .set(bearer(dpo1.accessToken))
      .expect(200);
    expect((got.body as DsrBody).id).toBe(dsr.id);

    // assign the DPO handler
    const assigned = await request(app.getHttpServer())
      .post(`/dsr/${dsr.id}/assign`)
      .set(bearer(dpo1.accessToken))
      .send({ dpoHandlerUserId: dpo1.userId })
      .expect(201);
    expect((assigned.body as DsrBody).dpoHandlerUserId).toBe(dpo1.userId);

    // apply the ACCESS-only +15 business-day extension
    const extended = await request(app.getHttpServer())
      .post(`/dsr/${dsr.id}/apply-extension`)
      .set(bearer(dpo1.accessToken))
      .send({ reason: 'Complex request spanning multiple systems.' })
      .expect(201);
    const extendedBody = extended.body as DsrBody;
    expect(extendedBody.accessExtensionAppliedAt).not.toBeNull();
    expect(new Date(extendedBody.slaDueAt).getTime()).toBeGreaterThan(
      new Date(dsr.slaDueAt).getTime(),
    );

    // review-fix regression: the SLA re-basing (start-the-new-pair, THEN
    // resolve-the-old-pair, gated on a createdBefore cutoff so resolve()'s
    // own startsWith match can't also catch the rows startTimer() just
    // created) must leave the entity with exactly 2 OPEN timers — never 0
    // (a silent coverage gap) and never 4 (both old and new left open).
    const timersAfterExtension = await prisma.slaTimer.findMany({
      where: { entityType: 'DataSubjectRequest', entityId: dsr.id },
    });
    expect(timersAfterExtension).toHaveLength(4); // 2 resolved (old) + 2 open (new)
    expect(
      timersAfterExtension.filter((t) => t.resolvedAt === null),
    ).toHaveLength(2);
    expect(
      timersAfterExtension.filter((t) => t.resolvedAt !== null),
    ).toHaveLength(2);

    // the extension is write-once
    await request(app.getHttpServer())
      .post(`/dsr/${dsr.id}/apply-extension`)
      .set(bearer(dpo1.accessToken))
      .send({ reason: 'trying again' })
      .expect(422);

    // fulfil (ACCESS — no confirmation flag required)
    const fulfilled = await request(app.getHttpServer())
      .post(`/dsr/${dsr.id}/fulfil`)
      .set(bearer(dpo1.accessToken))
      .send({})
      .expect(201);
    expect((fulfilled.body as DsrBody).status).toBe('FULFILLED');
    expect((fulfilled.body as DsrBody).processedByUserId).toBe(dpo1.userId);

    // close by the SAME DPO officer who processed it -> 403 (mandatory sign-off)
    await request(app.getHttpServer())
      .post(`/dsr/${dsr.id}/close`)
      .set(bearer(dpo1.accessToken))
      .expect(403);

    // a role without dsr.close cannot close either
    await request(app.getHttpServer())
      .post(`/dsr/${dsr.id}/close`)
      .set(bearer(sales.accessToken))
      .expect(403);

    // close by a DIFFERENT DPO officer succeeds
    const closed = await request(app.getHttpServer())
      .post(`/dsr/${dsr.id}/close`)
      .set(bearer(dpo2.accessToken))
      .expect(201);
    const closedBody = closed.body as DsrBody;
    expect(closedBody.status).toBe('CLOSED');
    expect(closedBody.closedByUserId).toBe(dpo2.userId);
    expect(closedBody.closedAt).not.toBeNull();

    // idempotent re-close
    await request(app.getHttpServer())
      .post(`/dsr/${dsr.id}/close`)
      .set(bearer(dpo2.accessToken))
      .expect(201);

    // audit: CREATE + several UPDATEs + READ rows, all present
    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: 'DataSubjectRequest', entityId: dsr.id },
    });
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('CREATE');
    expect(actions).toContain('UPDATE');
    expect(actions).toContain('READ');
  });

  it('a DELETION request must confirm no open retention hold before it can be FULFILLED (or use partially-fulfil instead)', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'dsr-del-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const dpo = await makeUser(app, 'dsr-del-dpo', 'DATA_PROTECTION_OFFICER');

    const customer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: `DSR Deletion E2E ${Math.random().toString(36).slice(2, 8)}`,
        ownerUserId: sales.userId,
      },
    });

    // Case 1: DELETION fulfilled with no retention hold — requires the
    // explicit confirmation flag.
    const del1 = (
      await request(app.getHttpServer())
        .post('/dsr')
        .set(bearer(sales.accessToken))
        .send({ customerId: customer.id, type: 'DELETION' })
        .expect(201)
    ).body as DsrBody;
    await request(app.getHttpServer())
      .post(`/dsr/${del1.id}/verify-identity`)
      .set(bearer(dpo.accessToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/dsr/${del1.id}/start`)
      .set(bearer(dpo.accessToken))
      .expect(201);

    // fulfil with no confirmation -> 422
    await request(app.getHttpServer())
      .post(`/dsr/${del1.id}/fulfil`)
      .set(bearer(dpo.accessToken))
      .send({})
      .expect(422);

    // the +15 extension is ACCESS-only — DELETION cannot use it
    await request(app.getHttpServer())
      .post(`/dsr/${del1.id}/apply-extension`)
      .set(bearer(dpo.accessToken))
      .send({ reason: 'trying anyway' })
      .expect(422);

    const fulfilled1 = await request(app.getHttpServer())
      .post(`/dsr/${del1.id}/fulfil`)
      .set(bearer(dpo.accessToken))
      .send({ confirmNoOpenRetentionHold: true })
      .expect(201);
    expect((fulfilled1.body as DsrBody).status).toBe('FULFILLED');
    // review-fix regression: the attestation must be persisted, not just
    // checked in-memory and discarded.
    expect(
      (fulfilled1.body as DsrBody).noOpenRetentionHoldConfirmedAt,
    ).not.toBeNull();

    // Case 2: DELETION with an open retention hold — partially-fulfil
    const del2 = (
      await request(app.getHttpServer())
        .post('/dsr')
        .set(bearer(sales.accessToken))
        .send({ customerId: customer.id, type: 'DELETION' })
        .expect(201)
    ).body as DsrBody;
    await request(app.getHttpServer())
      .post(`/dsr/${del2.id}/verify-identity`)
      .set(bearer(dpo.accessToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/dsr/${del2.id}/start`)
      .set(bearer(dpo.accessToken))
      .expect(201);

    const partial = await request(app.getHttpServer())
      .post(`/dsr/${del2.id}/partially-fulfil`)
      .set(bearer(dpo.accessToken))
      .send({
        retentionScheduleReference: 'RSI-2026-CLAIMS-7YR',
        partialFulfilmentJustification:
          '7-year statutory claims-file retention period has not elapsed.',
      })
      .expect(201);
    const partialBody = partial.body as DsrBody;
    expect(partialBody.status).toBe('PARTIALLY_FULFILLED');
    expect(partialBody.retentionScheduleReference).toBe('RSI-2026-CLAIMS-7YR');

    // this DSR can never be closed as if it were fully fulfilled — its
    // status is, and stays, PARTIALLY_FULFILLED right up to closure; the
    // mandatory sign-off still blocks the same DPO who processed it from
    // also being the one who closes it
    await request(app.getHttpServer())
      .post(`/dsr/${del2.id}/close`)
      .set(bearer(dpo.accessToken))
      .expect(403);
  });

  it('rejects a request (from RECEIVED, before identity is even verified) with a mandatory reason, and lists/filters book-wide', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'dsr-rej-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const dpo = await makeUser(app, 'dsr-rej-dpo', 'DATA_PROTECTION_OFFICER');
    const dpo2 = await makeUser(app, 'dsr-rej-dpo2', 'DATA_PROTECTION_OFFICER');

    const customer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: `DSR Reject E2E ${Math.random().toString(36).slice(2, 8)}`,
        ownerUserId: sales.userId,
      },
    });

    const correction = (
      await request(app.getHttpServer())
        .post('/dsr')
        .set(bearer(sales.accessToken))
        .send({ customerId: customer.id, type: 'CORRECTION' })
        .expect(201)
    ).body as DsrBody;

    // reject straight from RECEIVED — legal per WORKFLOW_TRANSITIONS
    const rejected = await request(app.getHttpServer())
      .post(`/dsr/${correction.id}/reject`)
      .set(bearer(dpo.accessToken))
      .send({
        reason: 'Requester could not be identified as the data subject.',
      })
      .expect(201);
    const rejectedBody = rejected.body as DsrBody;
    expect(rejectedBody.status).toBe('REJECTED');
    expect(rejectedBody.rejectionReason).toBe(
      'Requester could not be identified as the data subject.',
    );

    await request(app.getHttpServer())
      .post(`/dsr/${correction.id}/close`)
      .set(bearer(dpo2.accessToken))
      .expect(201);

    // list filters: this customer's book, scoped by this test's own ids
    // (db-test is cumulative across specs — never assume a clean slate)
    const byCustomer = await request(app.getHttpServer())
      .get(`/dsr?customerId=${customer.id}`)
      .set(bearer(dpo.accessToken))
      .expect(200);
    expect((byCustomer.body as DsrBody[]).map((d) => d.id)).toEqual([
      correction.id,
    ]);

    const byType = await request(app.getHttpServer())
      .get(`/dsr?customerId=${customer.id}&type=CORRECTION`)
      .set(bearer(dpo.accessToken))
      .expect(200);
    expect((byType.body as DsrBody[]).map((d) => d.id)).toEqual([
      correction.id,
    ]);

    const byWrongType = await request(app.getHttpServer())
      .get(`/dsr?customerId=${customer.id}&type=OBJECTION`)
      .set(bearer(dpo.accessToken))
      .expect(200);
    expect(byWrongType.body as DsrBody[]).toEqual([]);
  });
});

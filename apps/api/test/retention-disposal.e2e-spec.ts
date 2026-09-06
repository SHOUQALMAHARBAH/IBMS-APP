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
interface RetentionScheduleItemBody {
  id: string;
  recordCategory: string;
  retentionPeriodMonths: number;
  legalBasis: string | null;
  confirmedByLegalCounselAt: string | null;
  isConfirmed: boolean;
}
interface LegalHoldBody {
  id: string;
  scope: string;
  retentionScheduleItemId: string | null;
  nextReviewDueAt: string;
  releasedAt: string | null;
  isActive: boolean;
}
interface DisposalBatchBody {
  id: string;
  status: string;
  nominatedByUserId: string;
  dpoApprovedByUserId: string | null;
  method: string | null;
  slaDueAt: string | null;
  hasCertificateOfDestruction: boolean;
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
    .send({ fullName: 'Retention E2E User', email, password: PASSWORD })
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

describe('Data Retention & Secure Disposal (e2e) — backlog Part D, Process #52 / M06', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('walks the retention-schedule -> disposal-batch lifecycle end to end, and excludes an actively-held category', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'retention-compliance',
      'COMPLIANCE_OFFICER',
    );
    const manager = await makeUser(
      app,
      'retention-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const dpo = await makeUser(app, 'retention-dpo', 'DATA_PROTECTION_OFFICER');
    const outsider = await makeUser(
      app,
      'retention-outsider',
      'CLAIMS_OFFICER',
    );

    const category = `E2E-Category-${Math.random().toString(36).slice(2, 8)}`;

    // a role without retention-schedule.manage cannot create
    await request(app.getHttpServer())
      .post('/retention-schedule')
      .set(bearer(outsider.accessToken))
      .send({ recordCategory: category, retentionPeriodMonths: 60 })
      .expect(403);

    // create a retention-schedule item (a documented, pending-confirmation
    // draft — "needs Legal Counsel confirmation as a pending input")
    const created = await request(app.getHttpServer())
      .post('/retention-schedule')
      .set(bearer(compliance.accessToken))
      .send({
        recordCategory: category,
        retentionPeriodMonths: 60,
        legalBasis: 'DRAFT pending Legal Counsel citation.',
      })
      .expect(201);
    const item = created.body as RetentionScheduleItemBody;
    expect(item.isConfirmed).toBe(false);
    const itemId = item.id;

    // a duplicate category is 409 (the real unique constraint)
    await request(app.getHttpServer())
      .post('/retention-schedule')
      .set(bearer(compliance.accessToken))
      .send({ recordCategory: category, retentionPeriodMonths: 12 })
      .expect(409);

    // list includes it
    const list = await request(app.getHttpServer())
      .get('/retention-schedule')
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect(
      (list.body as RetentionScheduleItemBody[]).some((r) => r.id === itemId),
    ).toBe(true);

    // place a Legal Hold on this category
    const holdRes = await request(app.getHttpServer())
      .post('/legal-holds')
      .set(bearer(dpo.accessToken))
      .send({
        scope: `${category} — pending regulatory inquiry`,
        reason: 'Regulator requested the full book for this category.',
        retentionScheduleItemId: itemId,
      })
      .expect(201);
    const hold = holdRes.body as LegalHoldBody;
    expect(hold.isActive).toBe(true);
    expect(hold.nextReviewDueAt).not.toBeNull();

    // the 6-month review SLA timer exists
    const holdTimers = await prisma.slaTimer.findMany({
      where: { entityType: 'LegalHold', entityId: hold.id },
    });
    expect(holdTimers).toHaveLength(1);
    expect(holdTimers[0]?.workflowName).toBe('legal_hold_necessity_review');

    // nominating a disposal batch for a category under an active hold is 422
    await request(app.getHttpServer())
      .post('/disposal-batches')
      .set(bearer(manager.accessToken))
      .send({ retentionScheduleItemId: itemId })
      .expect(422);

    // release the hold
    const released = await request(app.getHttpServer())
      .post(`/legal-holds/${hold.id}/release`)
      .set(bearer(dpo.accessToken))
      .expect(201);
    expect((released.body as LegalHoldBody).isActive).toBe(false);
    // idempotent re-release
    await request(app.getHttpServer())
      .post(`/legal-holds/${hold.id}/release`)
      .set(bearer(dpo.accessToken))
      .expect(201);

    // now nomination succeeds — the exclusion is re-derived live, not cached
    const batchRes = await request(app.getHttpServer())
      .post('/disposal-batches')
      .set(bearer(manager.accessToken))
      .send({ retentionScheduleItemId: itemId })
      .expect(201);
    const batch = batchRes.body as DisposalBatchBody;
    expect(batch.status).toBe('NOMINATED');
    expect(batch.nominatedByUserId).toBe(manager.userId);
    const batchId = batch.id;

    // closing before EXECUTED is impossible (workflow engine itself blocks
    // the illegal jump) — confirmed indirectly by the linear walk below;
    // issuing a certificate this early is a 422
    await request(app.getHttpServer())
      .post(`/disposal-batches/${batchId}/certificate`)
      .set(bearer(dpo.accessToken))
      .expect(422);

    // manager-approve
    const managerApproved = await request(app.getHttpServer())
      .post(`/disposal-batches/${batchId}/manager-approve`)
      .set(bearer(manager.accessToken))
      .expect(201);
    expect((managerApproved.body as DisposalBatchBody).status).toBe(
      'MANAGER_APPROVED',
    );

    // the SAME manager who nominated CANNOT also give the DPO approval
    await request(app.getHttpServer())
      .post(`/disposal-batches/${batchId}/dpo-approve`)
      .set(bearer(manager.accessToken))
      .expect(403); // no retention.dispose.approve permission at all

    // dpo-approve — a distinct DPO officer
    const dpoApproved = await request(app.getHttpServer())
      .post(`/disposal-batches/${batchId}/dpo-approve`)
      .set(bearer(dpo.accessToken))
      .expect(201);
    const dpoApprovedBody = dpoApproved.body as DisposalBatchBody;
    expect(dpoApprovedBody.status).toBe('DPO_APPROVED');
    expect(dpoApprovedBody.dpoApprovedByUserId).toBe(dpo.userId);
    expect(dpoApprovedBody.slaDueAt).not.toBeNull();

    // the 30-day execution SLA timer exists
    const executionTimers = await prisma.slaTimer.findMany({
      where: { entityType: 'DisposalBatch', entityId: batchId },
    });
    expect(executionTimers).toHaveLength(1);
    expect(executionTimers[0]?.workflowName).toBe('disposal_batch_execution');
    expect(executionTimers[0]?.resolvedAt).toBeNull();

    // execute — a staff attestation, not a live delete
    const executed = await request(app.getHttpServer())
      .post(`/disposal-batches/${batchId}/execute`)
      .set(bearer(dpo.accessToken))
      .send({ method: 'certified_shredding' })
      .expect(201);
    expect((executed.body as DisposalBatchBody).status).toBe('EXECUTED');

    // the execution SLA timer is now resolved
    const resolvedTimer = await prisma.slaTimer.findFirst({
      where: { entityType: 'DisposalBatch', entityId: batchId },
    });
    expect(resolvedTimer?.resolvedAt).not.toBeNull();

    // closing without a certificate is still 422
    await request(app.getHttpServer())
      .post(`/disposal-batches/${batchId}/close`)
      .set(bearer(dpo.accessToken))
      .expect(422);

    // issue the certificate
    const certified = await request(app.getHttpServer())
      .post(`/disposal-batches/${batchId}/certificate`)
      .set(bearer(dpo.accessToken))
      .expect(201);
    expect(
      (certified.body as DisposalBatchBody).hasCertificateOfDestruction,
    ).toBe(true);

    // a second certificate for the same batch is 409
    await request(app.getHttpServer())
      .post(`/disposal-batches/${batchId}/certificate`)
      .set(bearer(dpo.accessToken))
      .expect(409);

    // NOW close succeeds — "no closing a disposal batch without an
    // attached Certificate of Destruction"
    const closed = await request(app.getHttpServer())
      .post(`/disposal-batches/${batchId}/close`)
      .set(bearer(dpo.accessToken))
      .expect(201);
    expect((closed.body as DisposalBatchBody).status).toBe('CLOSED');

    // confirm the retention-schedule item by Legal Counsel (Compliance,
    // standing in for Legal Counsel — no such role exists in this RBAC grid)
    const confirmed = await request(app.getHttpServer())
      .post(`/retention-schedule/${itemId}/confirm`)
      .set(bearer(compliance.accessToken))
      .expect(201);
    expect((confirmed.body as RetentionScheduleItemBody).isConfirmed).toBe(
      true,
    );

    // a confirmed item can no longer be edited
    await request(app.getHttpServer())
      .patch(`/retention-schedule/${itemId}`)
      .set(bearer(compliance.accessToken))
      .send({ retentionPeriodMonths: 999 })
      .expect(422);

    // re-confirming is 422
    await request(app.getHttpServer())
      .post(`/retention-schedule/${itemId}/confirm`)
      .set(bearer(compliance.accessToken))
      .expect(422);

    // audit: CREATE + TRANSITION rows exist for the batch
    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: 'DisposalBatch', entityId: batchId },
    });
    expect(audit.map((a) => a.action)).toContain('CREATE');
    expect(audit.map((a) => a.action)).toContain('TRANSITION');
  });

  it('rejects an unconfirmed schedule item update from a role outside retention-schedule.manage, and records a Legal-Hold review re-basing its due date', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'retention-compliance-2',
      'COMPLIANCE_OFFICER',
    );
    const dpo = await makeUser(
      app,
      'retention-dpo-2',
      'DATA_PROTECTION_OFFICER',
    );
    const outsider = await makeUser(
      app,
      'retention-outsider-2',
      'SALES_RELATIONSHIP_OFFICER',
    );

    const category = `E2E-Review-${Math.random().toString(36).slice(2, 8)}`;
    const item = (
      await request(app.getHttpServer())
        .post('/retention-schedule')
        .set(bearer(compliance.accessToken))
        .send({ recordCategory: category, retentionPeriodMonths: 24 })
        .expect(201)
    ).body as RetentionScheduleItemBody;

    await request(app.getHttpServer())
      .patch(`/retention-schedule/${item.id}`)
      .set(bearer(outsider.accessToken))
      .send({ retentionPeriodMonths: 36 })
      .expect(403);

    const hold = (
      await request(app.getHttpServer())
        .post('/legal-holds')
        .set(bearer(dpo.accessToken))
        .send({
          scope: category,
          reason: 'Ongoing internal investigation.',
          retentionScheduleItemId: item.id,
        })
        .expect(201)
    ).body as LegalHoldBody;
    const firstDueAt = hold.nextReviewDueAt;

    const reviewed = await request(app.getHttpServer())
      .post(`/legal-holds/${hold.id}/review`)
      .set(bearer(dpo.accessToken))
      .expect(201);
    const reviewedBody = reviewed.body as LegalHoldBody;
    expect(reviewedBody.isActive).toBe(true);
    expect(new Date(reviewedBody.nextReviewDueAt).getTime()).toBeGreaterThan(
      new Date(firstDueAt).getTime(),
    );

    // review re-basing leaves exactly 1 open timer (start-then-resolve,
    // never 0 — a silent gap — and never 2 stacked opens)
    const timersAfterReview = await prisma.slaTimer.findMany({
      where: { entityType: 'LegalHold', entityId: hold.id },
    });
    expect(timersAfterReview.filter((t) => t.resolvedAt === null)).toHaveLength(
      1,
    );
    expect(timersAfterReview.filter((t) => t.resolvedAt !== null)).toHaveLength(
      1,
    );

    // list filters by active
    const activeOnly = await request(app.getHttpServer())
      .get('/legal-holds')
      .query({ retentionScheduleItemId: item.id, active: true })
      .set(bearer(dpo.accessToken))
      .expect(200);
    expect((activeOnly.body as LegalHoldBody[]).map((h) => h.id)).toEqual([
      hold.id,
    ]);
  });
});

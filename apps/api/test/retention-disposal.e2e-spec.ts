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
interface RetentionScheduleItemBody {
  id: string;
  recordCategory: string;
  retentionPeriodMonths: number;
  legalBasis: string | null;
  confirmedByLegalCounselAt: string | null;
  isConfirmed: boolean;
  /** The sixteenth pair's act, ON THE RECORD — null for every ordinary two-person confirmation. */
  combinedDutyAct: unknown;
  /** Batch 5 group 6 — the no-floor declaration, or null where none was ever required. */
  noFloorDeclaration: unknown;
}
interface LegalHoldBody {
  id: string;
  scope: string;
  retentionScheduleItemId: string | null;
  customerId: string | null;
  insuredPersonId: string | null;
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
  return { accessToken, userId: user.id };
}

/**
 * The two categories the statutory floors govern, and the sweep that makes those tests
 * re-runnable against a CUMULATIVE db-test.
 *
 * Neither name can be made run-unique: the floor matches on EQUALITY of the normalised category,
 * so a suffix removes the floor and the test proves nothing. So the rows are swept instead — and
 * swept BY HAND through `prisma`, never through the route under test, because a spec that heals
 * itself through the thing it is testing cannot heal the one run that needs it.
 *
 * WHY IT EXISTS AT ALL, found by planting rather than by reading: with the create gate bypassed
 * the refusal test's POSTs SUCCEED and write rows nothing deletes, and the next run then fails on
 * a 409 instead of the 422 it is about. Two plant results were contaminated that way before this
 * was added.
 */
const FLOOR_CATEGORIES = ['KYCRecord', 'Invoice'];

/**
 * The no-floor declaration these tests send, batch 5 group 6.
 *
 * Every category these specs create is one this system knows no statutory minimum for, so the
 * owner's ruling asks the office to declare on the first save — which is why the creates below
 * carry this. A 422 without it is the mechanism working, not a regression.
 *
 * ONE helper, not five inline copies: the sentence is the mechanism here, and five copies is five
 * places for one of them to say less. Deliberately NOT read from the web dictionary — the api
 * cannot see it, and the whole point of carrying `noticeShown` from the caller is that what was
 * DISPLAYED is what gets recorded. A test is a caller.
 */
const NO_FLOOR_DECLARATION = {
  noticeShown:
    'This system does not know a statutory minimum for a record category with this name ' +
    '— and that does not mean the law sets none for it.',
  reason: 'Test fixture category; no statute applies to it.',
  acknowledged: true as const,
};

async function sweepFloorCategories(): Promise<void> {
  await prisma.retentionScheduleItem.deleteMany({
    where: { recordCategory: { in: FLOOR_CATEGORIES } },
  });
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

    // a role without retention-schedule.update cannot create (the umbrella split, module 0 close
    // decision 3 — the CREATE half is the maker's code)
    await request(app.getHttpServer())
      .post('/retention-schedule')
      .set(bearer(outsider.accessToken))
      .send({
        recordCategory: category,
        retentionPeriodMonths: 60,
        noFloorDeclaration: NO_FLOOR_DECLARATION,
      })
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
        noFloorDeclaration: NO_FLOOR_DECLARATION,
      })
      .expect(201);
    const item = created.body as RetentionScheduleItemBody;
    expect(item.isConfirmed).toBe(false);
    const itemId = item.id;

    // a duplicate category is 409 (the real unique constraint)
    await request(app.getHttpServer())
      .post('/retention-schedule')
      .set(bearer(compliance.accessToken))
      .send({
        recordCategory: category,
        retentionPeriodMonths: 12,
        noFloorDeclaration: NO_FLOOR_DECLARATION,
      })
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

    // AND an UNCONFIRMED period still refuses, with the hold gone. Two independent gates:
    // releasing the hold does not make a draft period actionable. Destroying records against a
    // number nobody has legally confirmed is the one step in this workflow that cannot be
    // undone, and the dual control below governs WHO approves, not whether the period is real.
    const unconfirmed = await request(app.getHttpServer())
      .post('/disposal-batches')
      .set(bearer(manager.accessToken))
      .send({ retentionScheduleItemId: itemId })
      .expect(422);
    expect(JSON.stringify(unconfirmed.body)).toContain(
      'has not been confirmed by legal counsel',
    );
    // Named, so the officer can see WHICH category is blocking.
    expect(JSON.stringify(unconfirmed.body)).toContain(category);

    /*
     * MODULE 0 CLOSE, DECISION 3 — CONFIRMED BY THE DPO, NOT BY THE PERSON WHO SET IT.
     *
     * This line used to confirm as `compliance`, the same actor that created the item above, and it
     * now returns 403: the retention schedule is the SIXTEENTH maker/checker pair, and one person
     * setting a retention period and confirming it as Legal Counsel is precisely what the pair
     * exists to refuse. The test encoded the old behaviour as intended — the same situation as item
     * (c)'s "proceeds when no BrokerLicense record is configured" — so it is RE-POINTED at a second
     * actor rather than loosened, and the refusal it used to allow now has its own test below.
     *
     * The DPO holds `retention-schedule.confirm`: both halves went to both roles that held the
     * umbrella, because which of the two a person holds is the office's choice, not this product's.
     */
    const legallyConfirmed = await request(app.getHttpServer())
      .post(`/retention-schedule/${itemId}/confirm`)
      .set(bearer(dpo.accessToken))
      .expect(201);
    expect(
      (legallyConfirmed.body as RetentionScheduleItemBody).isConfirmed,
    ).toBe(true);

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

    // The confirm step moved EARLIER in this flow — nomination now requires it, so it is
    // exercised above, before the batch exists. Confirming again here would be refused, which
    // is itself correct: a confirmed period is a record, not an editable draft.

    // a confirmed item can no longer be edited
    await request(app.getHttpServer())
      .patch(`/retention-schedule/${itemId}`)
      .set(bearer(compliance.accessToken))
      .send({ retentionPeriodMonths: 999 })
      .expect(422);

    /*
     * Re-confirming is 422 — AS THE DPO, and the actor matters now.
     *
     * As `compliance` this is a 403, not a 422: that actor SET the period, so the maker/checker
     * refusal fires BEFORE the already-confirmed check. That ordering is deliberate (module 0 close,
     * decision 3) — refuse first on the thing the caller cannot change by editing their request, so
     * an officer who may not confirm this row at all hears that rather than discovering it on a
     * second attempt. Asserting 422 here therefore requires an actor who COULD confirm.
     */
    await request(app.getHttpServer())
      .post(`/retention-schedule/${itemId}/confirm`)
      .set(bearer(dpo.accessToken))
      .expect(422);

    // audit: CREATE + TRANSITION rows exist for the batch
    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: 'DisposalBatch', entityId: batchId },
    });
    expect(audit.map((a) => a.action)).toContain('CREATE');
    expect(audit.map((a) => a.action)).toContain('TRANSITION');
  });

  it('rejects an unconfirmed schedule item update from a role outside retention-schedule.update, and records a Legal-Hold review re-basing its due date', async () => {
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
        .send({
          recordCategory: category,
          retentionPeriodMonths: 24,
          noFloorDeclaration: NO_FLOOR_DECLARATION,
        })
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

  it('a Legal Hold can name one data subject structurally — validated, listable, and blocking the M04 DSR cross-check (see dsr.e2e-spec.ts for the full DSR-side walk)', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'retention-hold-subject-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const dpo = await makeUser(
      app,
      'retention-hold-subject-dpo',
      'DATA_PROTECTION_OFFICER',
    );

    const customer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: `Legal Hold Subject E2E ${Math.random().toString(36).slice(2, 8)}`,
        ownerUserId: sales.userId,
      },
    });

    // both customerId and insuredPersonId at once is ambiguous — 422
    await request(app.getHttpServer())
      .post('/legal-holds')
      .set(bearer(dpo.accessToken))
      .send({
        scope: 'ambiguous',
        reason: 'r',
        customerId: customer.id,
        insuredPersonId: customer.id, // any UUID — rejected before an existence check runs
      })
      .expect(422);

    // an unknown customerId is 404
    await request(app.getHttpServer())
      .post('/legal-holds')
      .set(bearer(dpo.accessToken))
      .send({
        scope: 'unknown subject',
        reason: 'r',
        customerId: '00000000-0000-0000-0000-000000000000',
      })
      .expect(404);

    // a hold naming a real customer is created and listable by that subject
    const hold = (
      await request(app.getHttpServer())
        .post('/legal-holds')
        .set(bearer(dpo.accessToken))
        .send({
          scope: `Litigation hold on ${customer.id}`,
          reason: 'Active litigation pending discovery.',
          customerId: customer.id,
        })
        .expect(201)
    ).body as LegalHoldBody;
    expect(hold.customerId).toBe(customer.id);
    expect(hold.insuredPersonId).toBeNull();

    const byCustomer = await request(app.getHttpServer())
      .get('/legal-holds')
      .query({ customerId: customer.id })
      .set(bearer(dpo.accessToken))
      .expect(200);
    expect((byCustomer.body as LegalHoldBody[]).map((h) => h.id)).toEqual([
      hold.id,
    ]);

    // release it so this test leaves no dangling active hold behind
    await request(app.getHttpServer())
      .post(`/legal-holds/${hold.id}/release`)
      .set(bearer(dpo.accessToken))
      .expect(201);
  });

  /**
   * Part V cross-cutting item 5 (Phase 6) — the small-office edge case §10.5
   * names: ONE person holding both the Branch/Department Manager and the DPO
   * title.
   *
   * The pre-existing dual-control test above proves a manager cannot approve —
   * but it proves it with a 403, because that manager holds no
   * `retention.dispose.approve` at all. That is the permission gate, not
   * maker/checker. This user holds BOTH roles and therefore DOES hold the
   * permission, so the only thing left standing between them and approving
   * their own destruction batch is `assertDifferentActors` and the
   * `DisposalBatch_maker_checker_distinct` CHECK. Untested until now.
   */
  it('MODULE 0 CLOSE, DECISION 3 — refuses the person who SET a retention period from confirming it', async () => {
    /*
     * THE BEHAVIOUR THREE TESTS IN THIS FILE USED TO ALLOW, now observed on its own.
     *
     * Before the split, `retention-schedule.manage` gated the edit AND the confirmation, and the
     * confirm step recorded a date with NO ACTOR — so one person setting a retention period and
     * confirming it as Legal Counsel was not merely permitted, it was unrepresentable as a defect.
     * Three tests here did exactly that as a convenience and were re-pointed at a second actor; a
     * re-point without this test would move a behaviour out of sight rather than into a guard.
     *
     * The period decides when a customer's records are destroyed. One person choosing it and
     * confirming it alone is the shape PRIV-SRS-01 M06 exists to prevent.
     */
    const app = await boot();
    const setter = await makeUser(
      app,
      'retention-self-confirm',
      'COMPLIANCE_OFFICER',
    );

    const created = await request(app.getHttpServer())
      .post('/retention-schedule')
      .set(bearer(setter.accessToken))
      .send({
        recordCategory: `self-confirm-${Date.now()}`,
        retentionPeriodMonths: 36,
        legalBasis: 'PDPL Article 5',
        noFloorDeclaration: NO_FLOOR_DECLARATION,
      })
      .expect(201);
    const itemId = (created.body as { id: string }).id;

    // 403, and the body NAMES the pair rather than saying "forbidden" — an officer told only that
    // they may not do this goes looking for a missing grant they already hold.
    const refused = await request(app.getHttpServer())
      .post(`/retention-schedule/${itemId}/confirm`)
      .set(bearer(setter.accessToken))
      .expect(403);
    expect(JSON.stringify(refused.body)).toContain('RetentionScheduleItem');

    // AND NOTHING WAS WRITTEN. The refusal is worth nothing if the row came back confirmed anyway —
    // read from the database rather than from the response that reported the refusal.
    const row = await prisma.retentionScheduleItem.findUniqueOrThrow({
      where: { id: itemId },
      select: {
        confirmedByLegalCounselAt: true,
        confirmedByLegalCounselByUserId: true,
        setByUserId: true,
      },
    });
    expect(row.confirmedByLegalCounselAt).toBeNull();
    expect(row.confirmedByLegalCounselByUserId).toBeNull();
    // The MAKER was stamped on create, which is what made the comparison possible at all.
    expect(row.setByUserId).toBe(setter.userId);
  }, 180_000);

  it('refuses self-approval by one person holding BOTH the manager and DPO roles (item 5)', async () => {
    const app = await boot();
    const both = await makeUser(
      app,
      'disposal-dual-role',
      'BRANCH_DEPARTMENT_MANAGER',
      'DATA_PROTECTION_OFFICER',
    );

    const category = `dual-role-${Date.now()}`;
    const item = await request(app.getHttpServer())
      .post('/retention-schedule')
      .set(bearer(both.accessToken))
      .send({
        recordCategory: category,
        retentionPeriodMonths: 12,
        legalBasis: 'PDPL Article 5',
        noFloorDeclaration: NO_FLOOR_DECLARATION,
      })
      .expect(201);
    const itemId = (item.body as { id: string }).id;

    /*
     * Confirm the period first: nomination refuses a draft, and this test is about the DISPOSAL
     * maker/checker refusal rather than about that gate.
     *
     * CONFIRMED BY A SECOND ACTOR, because the retention schedule is now a maker/checker pair too
     * and `both` SET this period — so `both` confirming it is the sixteenth pair's refusal, not this
     * test's subject. Using a separate confirmer keeps this test about the thing it is named for.
     */
    const confirmer = await makeUser(
      app,
      'retention-dual-confirmer',
      'DATA_PROTECTION_OFFICER',
    );
    await request(app.getHttpServer())
      .post(`/retention-schedule/${itemId}/confirm`)
      .set(bearer(confirmer.accessToken))
      .expect(201);

    const batch = await request(app.getHttpServer())
      .post('/disposal-batches')
      .set(bearer(both.accessToken))
      .send({ retentionScheduleItemId: itemId })
      .expect(201);
    const batchId = (batch.body as { id: string }).id;

    // Holds the permission — so this is NOT a 403. It is the maker/checker
    // rule refusing a second signature from the first signatory.
    const refused = await request(app.getHttpServer())
      .post(`/disposal-batches/${batchId}/dpo-approve`)
      .set(bearer(both.accessToken))
      .expect(403);
    // Also a 403, like the permission refusal in the test above — so the
    // MESSAGE is what distinguishes them, and asserting it is the only way
    // this test proves maker/checker rather than re-proving the guard.
    expect((refused.body as { message: string }).message).toContain(
      'the checker must be a different user than the maker',
    );
    expect(JSON.stringify(refused.body)).toMatch(/same|different|actor/i);

    // And the batch really did not move — the refusal is not cosmetic.
    const still = await prisma.disposalBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(still.dpoApprovedByUserId).toBeNull();
    expect(still.status).toBe('NOMINATED');
  });

  it('MODULE 0 CLOSE — REFUSES a retention period below the statutory floor, carrying the ARTICLE and its own text', async () => {
    /*
     * One of the owner's three standing refusals, proven over real HTTP because the screen renders
     * the SERVER's own sentence (decision 90) — so what this response body says is literally what a
     * compliance officer reads.
     *
     * BOTH FLOORS, because they are two different statutes and a test of one says nothing about the
     * other. And 60 months is the shared edge: it CLEARS the AML floor exactly and is still refused
     * as a commercial record, which is the whole reason there are two floors rather than one.
     */
    const app = await boot();
    await sweepFloorCategories();
    const compliance = await makeUser(
      app,
      'retention-floor-compliance',
      'COMPLIANCE_OFFICER',
    );

    // ---------------------------------------------- AML art. 17/a — five years, CDD records
    const aml = await request(app.getHttpServer())
      .post('/retention-schedule')
      .set(bearer(compliance.accessToken))
      .send({ recordCategory: 'KYCRecord', retentionPeriodMonths: 12 })
      .expect(422);
    const amlMessage = JSON.stringify(aml.body);
    expect(amlMessage).toContain('art. 17/a');
    expect(amlMessage).toContain(
      'Anti-Money Laundering and Counter-Terrorism Financing Law No. 20 of 2021',
    );
    expect(amlMessage).toContain(
      'customer due-diligence records and account files must be kept for at least five years',
    );
    expect(amlMessage).toContain('WHICHEVER IS LONGER');
    expect(amlMessage).toContain('60 months');

    // ---------------------------------------------- Commercial Law art. 19 — ten years
    const commercial = await request(app.getHttpServer())
      .post('/retention-schedule')
      .set(bearer(compliance.accessToken))
      .send({ recordCategory: 'Invoice', retentionPeriodMonths: 60 })
      .expect(422);
    const commercialMessage = JSON.stringify(commercial.body);
    expect(commercialMessage).toContain('art. 19');
    expect(commercialMessage).toContain('Commercial Law No. 12 of 1966');
    expect(commercialMessage).toContain(
      'financial and commercial records must be kept for ten years',
    );
    expect(commercialMessage).toContain(
      'CLOSING DATE OF THE FINANCIAL TRANSACTION',
    );
    expect(commercialMessage).toContain('120 months');

    /*
     * NON-VACUITY, and it is the half that matters: a refusal BEFORE the write means no row exists,
     * so the next run is not a 409. Without this assertion the test would pass against a refusal
     * raised AFTER the insert, which would leave the row behind and break its own second run.
     */
    try {
      for (const category of FLOOR_CATEGORIES) {
        expect(
          await prisma.retentionScheduleItem.findFirst({
            where: { recordCategory: category },
          }),
          `${category} was written before the refusal — the floor is being checked too late`,
        ).toBeNull();
      }
    } finally {
      // Swept on the way out TOO, because the one run where a row exists is the run where the
      // refusal stopped refusing — and that is precisely when the next run must not fail on a 409
      // about the leftover instead of on the regression.
      await sweepFloorCategories();
    }
  }, 120_000);

  it('MODULE 0 CLOSE — ACCEPTS a period AT the floor, and ACCEPTS any period for a category with NO decided floor', async () => {
    const app = await boot();
    await sweepFloorCategories();
    const compliance = await makeUser(
      app,
      'retention-floor-accept',
      'COMPLIANCE_OFFICER',
    );

    let atFloorId: string | undefined;
    let unsourcedId: string | undefined;
    try {
      // ---------------------------------------------- AT the floor, accepted
      const atFloor = await request(app.getHttpServer())
        .post('/retention-schedule')
        .set(bearer(compliance.accessToken))
        .send({ recordCategory: 'KYCRecord', retentionPeriodMonths: 60 })
        .expect(201);
      const atFloorBody = atFloor.body as RetentionScheduleItemBody;
      atFloorId = atFloorBody.id;
      expect(atFloorBody.retentionPeriodMonths).toBe(60);

      // ABOVE it, freely — and on the EDIT path, which is where a create-only gate would be a
      // formality: set 60, then patch to 6.
      await request(app.getHttpServer())
        .patch(`/retention-schedule/${atFloorId}`)
        .set(bearer(compliance.accessToken))
        .send({ retentionPeriodMonths: 240 })
        .expect(200);
      const belowOnEdit = await request(app.getHttpServer())
        .patch(`/retention-schedule/${atFloorId}`)
        .set(bearer(compliance.accessToken))
        .send({ retentionPeriodMonths: 6 })
        .expect(422);
      expect(JSON.stringify(belowOnEdit.body)).toContain('art. 17/a');

      // An edit that touches only `legalBasis` is NOT refused over a figure it is not touching.
      await request(app.getHttpServer())
        .patch(`/retention-schedule/${atFloorId}`)
        .set(bearer(compliance.accessToken))
        .send({ legalBasis: 'AML Law No. 20 of 2021, art. 17/a.' })
        .expect(200);

      /*
       * ---------------------------------------------- NO DECIDED FLOOR, and NOTHING INVENTED
       *
       * The owner's constraint, which matters more than the refusal: a category whose statute we
       * have not read gets the office's own period. One month for a category nobody sourced is
       * accepted — and the response carries no floor, no article and no invented number.
       */
      const unsourced = await request(app.getHttpServer())
        .post('/retention-schedule')
        .set(bearer(compliance.accessToken))
        .send({
          recordCategory: `E2E-Unsourced-${Math.random().toString(36).slice(2, 8)}`,
          retentionPeriodMonths: 1,
          // This system knows no minimum for this name, so the office declares — the ask itself is
          // proven in the silent-case test below; here the point is that ONE month is accepted and
          // nothing is invented.
          noFloorDeclaration: NO_FLOOR_DECLARATION,
        })
        .expect(201);
      const unsourcedBody = unsourced.body as RetentionScheduleItemBody;
      unsourcedId = unsourcedBody.id;
      expect(unsourcedBody.retentionPeriodMonths).toBe(1);
      /*
       * AN EXACT KEY SET, because an invented floor arrives as an ADDED FIELD and every
       * `toHaveProperty` keeps passing while one appears. This is also what makes "no invented
       * NUMBER" checkable without asserting on digits: if there is no floor field, there is no
       * number presented as a floor.
       *
       * My first version asserted `not.toContain('60')` on the serialised body, which PASSED on
       * its first run and failed on its second — the body carries a uuid, and whether the digits
       * 60 appear in it is decided by Postgres. The recorded base64 trap, in numeric form.
       */
      expect(Object.keys(unsourcedBody).sort()).toEqual([
        // `combinedDutyAct` is the SIXTEENTH PAIR'S projection, added in this same commit after
        // `combined-duty-projection.py` reported this pair as the one writing the act and showing
        // nobody. It is null here, which is the ordinary case. This assertion caught the shape
        // change the moment it landed — which is the whole argument for an exact key set over a
        // list of `toHaveProperty` calls, each of which keeps passing while a field appears.
        'combinedDutyAct',
        'confirmedByLegalCounselAt',
        'id',
        'isConfirmed',
        'legalBasis',
        // Batch 5 group 6's declaration — the SECOND field this assertion caught the moment it
        // landed, one batch after the projection. That is the argument for an exact key set.
        'noFloorDeclaration',
        'recordCategory',
        'retentionPeriodMonths',
      ]);
      expect(unsourcedBody.combinedDutyAct).toBeNull();
      /*
       * RE-POINTED WITH THE REVERSAL STATED, not relaxed.
       *
       * This block used to assert the response mentions no 'art.', 'statutory', 'Law No.',
       * 'minimum' or 'floor' — "nothing invented". Batch 5 group 6 makes those words legitimately
       * present, because the declaration carries the notice and THE NOTICE NAMES BOTH KNOWN FLOORS
       * BY INSTRUMENT AND ARTICLE. That naming is the mechanism, not an invention: it is how
       * somebody saving due-diligence records under a different name recognises what they are doing.
       *
       * What must still be absent is a floor ATTRIBUTED TO THIS CATEGORY, and the exact key set
       * above is what proves it — the view carries no floor field at all. So the claim now sits
       * where it can actually fail rather than being hunted for by word.
       */
      const declared = unsourcedBody.noFloorDeclaration as {
        noticeShown: string;
        acknowledgedMonths: number;
      } | null;
      expect(declared).not.toBeNull();
      expect(
        declared?.noticeShown,
        'the stored notice is not what was sent — a sentence re-derived at submit answers a ' +
          'different question from the one the record exists for',
      ).toBe(NO_FLOOR_DECLARATION.noticeShown);
      expect(declared?.acknowledgedMonths).toBe(1);
    } finally {
      // The category name CANNOT be made run-unique — the floor matches on equality of the
      // normalised name, so a suffix would remove the floor and the test would prove nothing. So
      // the rows go. Neither carries a disposal batch or a legal hold, so the delete is clean.
      for (const id of [atFloorId, unsourcedId]) {
        if (id) await prisma.retentionScheduleItem.delete({ where: { id } });
      }
      // And by CATEGORY as well, not only by the ids this test captured: a row written by a
      // request whose `.expect()` threw is a row this test never got an id for.
      await sweepFloorCategories();
    }
  }, 120_000);

  it('THE SILENT CASE — a category with no known floor is ACCEPTED with a declaration, and the audit row carries the SENTENCE and the REASON verbatim', async () => {
    /*
     * Batch 5 group 6, the owner's ruling. Before this, a period for a category this system knows
     * no minimum for was accepted with no refusal AND NO WORD — so a hard refusal was escaped by a
     * spelling, silently. `CustomerFile` takes the five-year floor; `Customer` takes nothing.
     *
     * It DECLARES rather than refusing, because the harm is the office's own regulatory exposure.
     */
    const app = await boot();
    const compliance = await makeUser(
      app,
      'retention-nofloor',
      'COMPLIANCE_OFFICER',
    );
    const category = `E2E-NoFloor-${Math.random().toString(36).slice(2, 8)}`;
    // The sentence as a screen would render it. Carried from the client deliberately — the
    // `DuplicateNameWarning` precedent: re-deriving it at submit rewrites what they were told.
    const notice =
      'This system does not know a statutory minimum for a record category with this name ' +
      '— and that does not mean the law sets none for it.';
    const reason =
      'Vendor correspondence; no statute found, reviewed with counsel.';

    // ---------------------------------------------- (1) ASKED, and the refusal says what it is
    const asked = await request(app.getHttpServer())
      .post('/retention-schedule')
      .set(bearer(compliance.accessToken))
      // NO declaration, deliberately — this is the request that proves the office is ASKED. A
      // sweep over these bodies added one here and the test failed with 201, which is the only
      // reason I noticed: a blind rewrite can remove the very thing a test is about.
      .send({ recordCategory: category, retentionPeriodMonths: 6 })
      .expect(422);
    const askedBody = asked.body as {
      code?: string;
      message?: string;
      reasonMinLength?: number;
    };
    expect(askedBody.code).toBe('NO_FLOOR_DECLARATION_REQUIRED');
    expect(askedBody.reasonMinLength).toBe(10);
    // THE PERIOD IS NOT WHAT IS REFUSED, and the message says so.
    expect(String(askedBody.message)).toContain('The period is accepted');
    // The SYSTEM does not know a minimum — never that the LAW sets none. The distinction is the
    // difference between an honest declaration and a legal claim with no source.
    expect(String(askedBody.message)).toContain(
      'does not know a statutory minimum',
    );
    expect(String(askedBody.message)).toContain(
      'Nothing here says the LAW sets no minimum',
    );
    // Nothing was written — the ask comes before the row.
    expect(
      await prisma.retentionScheduleItem.findFirst({
        where: { recordCategory: category },
      }),
    ).toBeNull();

    // A tick that is not ticked is refused by the DTO, so the acknowledgement is an act.
    await request(app.getHttpServer())
      .post('/retention-schedule')
      .set(bearer(compliance.accessToken))
      .send({
        recordCategory: category,
        retentionPeriodMonths: 6,
        noFloorDeclaration: {
          noticeShown: notice,
          reason,
          acknowledged: false,
        },
      })
      .expect(400);

    // ---------------------------------------------- (2) ACCEPTED with the declaration
    const created = await request(app.getHttpServer())
      .post('/retention-schedule')
      .set(bearer(compliance.accessToken))
      .send({
        recordCategory: category,
        retentionPeriodMonths: 6,
        noFloorDeclaration: { noticeShown: notice, reason, acknowledged: true },
      })
      .expect(201);
    const body = created.body as RetentionScheduleItemBody & {
      noFloorDeclaration: {
        noticeShown: string;
        reason: string;
        acknowledgedMonths: number;
        acknowledgedByUserId: string;
      } | null;
    };
    const itemId = body.id;
    try {
      expect(body.retentionPeriodMonths).toBe(6);
      // THE SENTENCE IS IN THE RESPONSE, verbatim.
      expect(body.noFloorDeclaration?.noticeShown).toBe(notice);
      expect(body.noFloorDeclaration?.reason).toBe(reason);
      expect(body.noFloorDeclaration?.acknowledgedMonths).toBe(6);
      expect(body.noFloorDeclaration?.acknowledgedByUserId).toBe(
        compliance.userId,
      );

      // ---------------------------------------------- (3) THE AUDIT ROW, VERBATIM
      /*
       * The owner's rule: the row carries the SENTENCE SHOWN and the REASON, not the word
       * "acknowledged" — because a year from now the question is what the person SAW.
       */
      const entries = await prisma.auditLogEntry.findMany({
        where: { entityType: 'RetentionScheduleItem', entityId: itemId },
        select: { action: true, afterValue: true },
      });
      expect(entries).toHaveLength(1);
      const after = entries[0].afterValue as Record<string, unknown>;
      expect(after.noFloorNoticeShown).toBe(notice);
      expect(after.noFloorReason).toBe(reason);
      // NOT a flag. Asserted as an absence, which is the only form that can fail.
      expect(JSON.stringify(after)).not.toContain('acknowledged');

      // ---------------------------------------------- (4) NOT RE-ASKED at the same or longer
      for (const months of [6, 7, 240]) {
        await request(app.getHttpServer())
          .patch(`/retention-schedule/${itemId}`)
          .set(bearer(compliance.accessToken))
          .send({ retentionPeriodMonths: months })
          .expect(200);
      }

      // ---------------------------------------------- (5) ASKED AGAIN on a SHORTENING
      /*
       * The acknowledged figure is still 6 — the longer saves above required no declaration and
       * deliberately did not overwrite it, because a longer period does not undo what the office
       * was told. So 5 is a shortening against 6 and asks again.
       */
      const row = await prisma.retentionScheduleItem.findUniqueOrThrow({
        where: { id: itemId },
        select: {
          noFloorAcknowledgedMonths: true,
          retentionPeriodMonths: true,
        },
      });
      expect(row.noFloorAcknowledgedMonths).toBe(6);
      expect(row.retentionPeriodMonths).toBe(240);

      const reAsked = await request(app.getHttpServer())
        .patch(`/retention-schedule/${itemId}`)
        .set(bearer(compliance.accessToken))
        .send({ retentionPeriodMonths: 5 })
        .expect(422);
      expect((reAsked.body as { code?: string }).code).toBe(
        'NO_FLOOR_DECLARATION_REQUIRED',
      );

      // And it goes through with a fresh declaration, re-stamping the acknowledged figure.
      const shortened = 'Shortened after counsel confirmed no statute applies.';
      await request(app.getHttpServer())
        .patch(`/retention-schedule/${itemId}`)
        .set(bearer(compliance.accessToken))
        .send({
          retentionPeriodMonths: 5,
          noFloorDeclaration: {
            noticeShown: notice,
            reason: shortened,
            acknowledged: true,
          },
        })
        .expect(200);
      const after5 = await prisma.retentionScheduleItem.findUniqueOrThrow({
        where: { id: itemId },
        select: { noFloorAcknowledgedMonths: true, noFloorReason: true },
      });
      expect(after5.noFloorAcknowledgedMonths).toBe(5);
      expect(after5.noFloorReason).toBe(shortened);

      // An edit that touches only `legalBasis` is not a period decision and is never asked.
      await request(app.getHttpServer())
        .patch(`/retention-schedule/${itemId}`)
        .set(bearer(compliance.accessToken))
        .send({ legalBasis: 'No statute identified.' })
        .expect(200);
    } finally {
      /*
       * THE AUDIT ROWS ARE NOT CLEANED UP, and cannot be: `AuditLogEntry` carries an immutability
       * trigger and Postgres refuses the DELETE by name — "AuditLogEntry rows are immutable (Part
       * 10.3)". My first teardown tried, which is how I met that guarantee from the inside. They
       * carry no FK to the item, so removing the row is unaffected.
       */
      await prisma.retentionScheduleItem.delete({ where: { id: itemId } });
    }
  }, 120_000);

  it('a category that HAS a floor is NEVER asked to declare — the refusal and the acceptance already answer there', async () => {
    /*
     * The fourth evidence case, and the one a reasonable implementation gets wrong. The notice says
     * the SYSTEM does not know a minimum for that name; for `KYCRecord` it does, so showing it
     * would be this product stating something untrue about its own knowledge.
     */
    const app = await boot();
    const compliance = await makeUser(
      app,
      'retention-floor-nodecl',
      'COMPLIANCE_OFFICER',
    );
    await sweepFloorCategories();

    // BELOW the floor: refused on the ARTICLE, and the declaration code is absent.
    const refused = await request(app.getHttpServer())
      .post('/retention-schedule')
      .set(bearer(compliance.accessToken))
      .send({ recordCategory: 'KYCRecord', retentionPeriodMonths: 12 })
      .expect(422);
    expect(JSON.stringify(refused.body)).toContain('art. 17/a');
    expect(JSON.stringify(refused.body)).not.toContain(
      'NO_FLOOR_DECLARATION_REQUIRED',
    );

    // AT the floor: accepted with NO declaration sent and none recorded.
    let id: string | undefined;
    try {
      const ok = await request(app.getHttpServer())
        .post('/retention-schedule')
        .set(bearer(compliance.accessToken))
        .send({ recordCategory: 'KYCRecord', retentionPeriodMonths: 60 })
        .expect(201);
      const body = ok.body as RetentionScheduleItemBody & {
        noFloorDeclaration: unknown;
      };
      id = body.id;
      expect(body.noFloorDeclaration).toBeNull();

      const row = await prisma.retentionScheduleItem.findUniqueOrThrow({
        where: { id },
        select: {
          noFloorNoticeShown: true,
          noFloorReason: true,
          noFloorAcknowledgedAt: true,
          noFloorAcknowledgedByUserId: true,
          noFloorAcknowledgedMonths: true,
        },
      });
      // ALL FIVE null — a declaration cannot be written where none was asked for.
      expect(Object.values(row).every((v) => v === null)).toBe(true);
    } finally {
      if (id) await prisma.retentionScheduleItem.delete({ where: { id } });
      await sweepFloorCategories();
    }
  }, 120_000);
});

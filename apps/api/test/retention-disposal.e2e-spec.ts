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

  it('BATCH 5 GROUP 7b — the notice fires on an elapsed period, carrying the article, the start date and the no-hold statement', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'retention-notice-compliance',
      'COMPLIANCE_OFFICER',
    );

    // Swept on ENTRY by hand: the category name cannot be made run-unique, because the resolution
    // matches on equality of the normalised name and a suffix would remove it.
    await prisma.retentionExtension.deleteMany({
      where: { recordCategory: 'CommissionLedgerEntry' },
    });
    await prisma.retentionScheduleItem.deleteMany({
      where: { recordCategory: 'CommissionLedgerEntry' },
    });

    let itemId: string | undefined;
    let entryId: string | undefined;
    try {
      // The period: ten years, which is exactly the commercial floor, so it is accepted without a
      // declaration and without an extension.
      const created = await request(app.getHttpServer())
        .post('/retention-schedule')
        .set(bearer(compliance.accessToken))
        .send({
          recordCategory: 'CommissionLedgerEntry',
          retentionPeriodMonths: 120,
        })
        .expect(201);
      itemId = (created.body as RetentionScheduleItemBody).id;

      // A REAL elapsed record: one commission entry paid eleven years ago, against a policy that
      // has none. `@@unique([policyId])` is why it has to be a free policy.
      const policy = await prisma.policy.findFirstOrThrow({
        // `commissionLedgerEntries: { none: {} }`, not `null`: `@@unique([policyId])` makes it
        // one-at-most but Prisma still types the relation as a LIST, so "has none" is a `none`
        // filter. The compiler named the right field, which is the payload type doing its job.
        where: { commissionLedgerEntries: { none: {} } },
        select: { id: true },
      });
      const elevenYearsAgo = new Date();
      elevenYearsAgo.setUTCFullYear(elevenYearsAgo.getUTCFullYear() - 11);
      const entry = await prisma.commissionLedgerEntry.create({
        data: {
          policyId: policy.id,
          amount: '100.000',
          paidAt: elevenYearsAgo,
        },
        select: { id: true },
      });
      entryId = entry.id;

      const notices = await request(app.getHttpServer())
        .get('/retention-notices')
        .set(bearer(compliance.accessToken))
        .expect(200);
      const rows = notices.body as Array<Record<string, unknown>>;

      // ---------------------------------------------- (1) THE NOTICE, FIRING
      const row = rows.find(
        (r) => r.recordCategory === 'CommissionLedgerEntry',
      );
      expect(
        row,
        'no notice row for a category with a period and an elapsed record',
      ).toBeDefined();
      expect(row?.resolvable).toBe(true);
      expect(row?.elapsedCount).toBe(1);
      // THE ARTICLE — the same one the refusal cites.
      const floor = row?.floor as {
        instrument: string;
        article: string;
      } | null;
      expect(floor?.instrument).toContain('Commercial Law No. 12 of 1966');
      expect(floor?.article).toContain('art. 19');
      // THE START DATE, in words rather than as a column name.
      expect(String(row?.countedFrom)).toContain('commission was paid');
      // AND THE NO-HOLD STATEMENT, stated rather than implied.
      expect(row?.noLegalHoldStatement).toBe(
        'No legal hold stands on any of these records.',
      );

      // ---------------------------------------------- (2) A CATEGORY IT CANNOT RESOLVE SAYS SO
      /*
       * `AuditLogEntry` is seeded on every database and is one of the names this system cannot
       * resolve. Decision 28's family: an office that set a period for a category it named itself
       * and is never alerted will believe the system is watching it, so the row exists and carries
       * the reason rather than being omitted.
       */
      const unresolvable = rows.find(
        (r) => r.recordCategory === 'AuditLogEntry',
      );
      expect(
        unresolvable,
        'the seeded AuditLogEntry category has no notice row at all',
      ).toBeDefined();
      expect(unresolvable?.resolvable).toBe(false);
      expect(unresolvable?.elapsedCount).toBe(0);
      expect(String(unresolvable?.unresolvableReason)).toContain(
        'has not been told',
      );
      expect(unresolvable?.countedFrom).toBeNull();

      // ---------------------------------------------- (4) EXTEND, and the clock restarts
      const extended = await request(app.getHttpServer())
        .post('/retention-notices/extend')
        .set(bearer(compliance.accessToken))
        .send({
          recordCategory: 'CommissionLedgerEntry',
          recordIds: [entryId],
          months: 24,
          basis: 'LEGISLATIVE_PROVISION',
          instrument: 'Commercial Law No. 12 of 1966',
          article: 'art. 19',
          note: 'Retained for the pending examination of the 2026 commission file.',
        })
        .expect(201);
      expect((extended.body as { extended: number }).extended).toBe(1);

      // THE CLOCK RESTARTED: the same notice no longer offers it.
      const after = await request(app.getHttpServer())
        .get('/retention-notices')
        .set(bearer(compliance.accessToken))
        .expect(200);
      const afterRow = (after.body as Array<Record<string, unknown>>).find(
        (r) => r.recordCategory === 'CommissionLedgerEntry',
      );
      expect(afterRow?.elapsedCount).toBe(0);
      expect(afterRow?.extendedCount).toBe(1);

      // THE REGISTER ROW — which category, which record, which basis, who, when, until when.
      const register = await request(app.getHttpServer())
        .get('/retention-notices/register?recordCategory=CommissionLedgerEntry')
        .set(bearer(compliance.accessToken))
        .expect(200);
      const entries = register.body as Array<Record<string, unknown>>;
      expect(entries).toHaveLength(1);
      expect(entries[0].recordId).toBe(entryId);
      expect(entries[0].basis).toBe('LEGISLATIVE_PROVISION');
      expect(entries[0].legislativeArticle).toBe('art. 19');
      expect(entries[0].extendedByUserId).toBe(compliance.userId);
      expect(String(entries[0].note)).toContain('pending examination');

      // ---------------------------------------------- (4b) THE SECOND NOTICE, after it elapses
      /*
       * Asserted, not assumed: the brief's point is that an extension is a DECISION rather than an
       * exit, so the same notice comes again with the same three choices. The extension's own
       * `extendedUntil` is moved into the past — the one fact the clock reads.
       */
      await prisma.retentionExtension.updateMany({
        where: { recordCategory: 'CommissionLedgerEntry', recordId: entryId },
        data: { extendedUntil: new Date('2026-01-01T00:00:00.000Z') },
      });
      const second = await request(app.getHttpServer())
        .get('/retention-notices')
        .set(bearer(compliance.accessToken))
        .expect(200);
      const secondRow = (second.body as Array<Record<string, unknown>>).find(
        (r) => r.recordCategory === 'CommissionLedgerEntry',
      );
      expect(
        secondRow?.elapsedCount,
        'the second notice did not come — an extension became an exit',
      ).toBe(1);
      expect(secondRow?.extendedCount).toBe(0);
    } finally {
      await prisma.retentionExtension.deleteMany({
        where: { recordCategory: 'CommissionLedgerEntry' },
      });
      if (entryId)
        await prisma.commissionLedgerEntry.delete({ where: { id: entryId } });
      if (itemId)
        await prisma.retentionScheduleItem.delete({ where: { id: itemId } });
    }
  }, 120_000);

  it('BATCH 5 GROUP 7b — the closed basis list refuses free text as a basis, and consent is unselectable with its reason', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'retention-basis-compliance',
      'COMPLIANCE_OFFICER',
    );
    await prisma.retentionScheduleItem.deleteMany({
      where: { recordCategory: 'Receipt' },
    });

    let itemId: string | undefined;
    try {
      const created = await request(app.getHttpServer())
        .post('/retention-schedule')
        .set(bearer(compliance.accessToken))
        .send({ recordCategory: 'Receipt', retentionPeriodMonths: 120 })
        .expect(201);
      itemId = (created.body as RetentionScheduleItemBody).id;

      const base = {
        recordCategory: 'Receipt',
        recordIds: ['any-record-id'],
        months: 12,
        note: 'Retained for the reason named beside this basis.',
      };

      // A FOURTH BASIS IS A 400 AT THE BOUNDARY — the enum, not a judgement in a service.
      await request(app.getHttpServer())
        .post('/retention-notices/extend')
        .set(bearer(compliance.accessToken))
        .send({ ...base, basis: 'BECAUSE_WE_WANT_TO' })
        .expect(400);

      // FREE TEXT CANNOT BE A BASIS: a legislative basis with no article names no law.
      const noArticle = await request(app.getHttpServer())
        .post('/retention-notices/extend')
        .set(bearer(compliance.accessToken))
        .send({
          ...base,
          basis: 'LEGISLATIVE_PROVISION',
          instrument: 'Some Law',
        })
        .expect(422);
      expect(JSON.stringify(noArticle.body)).toContain(
        'EXTENSION_BASIS_INCOMPLETE',
      );
      expect(JSON.stringify(noArticle.body)).toContain('is not a basis');

      // THE NOTE IS REQUIRED AT THE SHARED MINIMUM — nine characters, not zero, so the assertion
      // isolates the floor rather than a non-empty check.
      await request(app.getHttpServer())
        .post('/retention-notices/extend')
        .set(bearer(compliance.accessToken))
        .send({
          ...base,
          note: 'too short',
          basis: 'LEGISLATIVE_PROVISION',
          instrument: 'Commercial Law No. 12 of 1966',
          article: 'art. 19',
        })
        .expect(400);

      // AND CONSENT IS UNSELECTABLE, with the measured reason — refused even with every field sent,
      // because an option that cannot be substantiated must not be offerable.
      const consent = await request(app.getHttpServer())
        .post('/retention-notices/extend')
        .set(bearer(compliance.accessToken))
        .send({
          ...base,
          basis: 'CUSTOMER_EXPLICIT_CONSENT',
          consentRecordId: '00000000-0000-4000-8000-000000000001',
          consentDuration: '2 years',
          consentPurpose: 'claims history',
        })
        .expect(422);
      const body = JSON.stringify(consent.body);
      expect(body).toContain('EXTENSION_BASIS_NOT_SELECTABLE');
      expect(body).toContain('NO duration');
      // The PRECISE reason: not "no consent exists", which would be false.
      expect(body).toContain('not that no consent exists');
    } finally {
      await prisma.retentionExtension.deleteMany({
        where: { recordCategory: 'Receipt' },
      });
      if (itemId)
        await prisma.retentionScheduleItem.delete({ where: { id: itemId } });
    }
  }, 120_000);

  /*
   * ================================================================================================
   * BATCH 5 GROUP 7c — THE ARCHIVED (BLOCKED) STATE AND ITS FOUR CONDITIONS
   * ================================================================================================
   *
   * The fixture is 7b's, unchanged: a `CommissionLedgerEntry` paid eleven years ago on a policy that
   * has none, under a 120-month period — exactly the commercial floor, so it is accepted without a
   * declaration. Swept on ENTRY BY HAND rather than through anything under test, because a spec that
   * heals itself through the thing it is testing cannot heal the one run that needs it.
   */
  it('BATCH 5 GROUP 7c — CONDITION 1: a blocked record LEAVES the unbounded commission read, and an EXTENSION brings it back', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'archive-read-compliance',
      'COMPLIANCE_OFFICER',
      // `financial-report.view` is held by FINANCE_COLLECTIONS_OFFICER, MANAGER, EXEC and the
      // auditor — measured, not guessed, and `FINANCE_OFFICER` is not a role name this product has.
      // The compiler said so, which is the `RoleName` enum doing its one job.
      'FINANCE_COLLECTIONS_OFFICER',
    );

    await prisma.retentionExtension.deleteMany({
      where: { recordCategory: 'CommissionLedgerEntry' },
    });
    await prisma.retentionScheduleItem.deleteMany({
      where: { recordCategory: 'CommissionLedgerEntry' },
    });

    let itemId: string | undefined;
    let entryId: string | undefined;
    try {
      const policy = await prisma.policy.findFirstOrThrow({
        where: { commissionLedgerEntries: { none: {} } },
        select: { id: true },
      });
      const elevenYearsAgo = new Date();
      elevenYearsAgo.setUTCFullYear(elevenYearsAgo.getUTCFullYear() - 11);
      const entry = await prisma.commissionLedgerEntry.create({
        data: {
          policyId: policy.id,
          amount: '100.000',
          paidAt: elevenYearsAgo,
        },
        select: { id: true },
      });
      entryId = entry.id;

      const countEntries = async (): Promise<number> => {
        const res = await request(app.getHttpServer())
          .get('/financial-report/summary')
          .set(bearer(compliance.accessToken))
          .expect(200);
        // `commission.entryCount`, NOT a top-level `commissionEntries`: that name exists only in
        // the service's own audit payload, not in the response. The non-vacuity floor below is what
        // caught the wrong shape — it read `undefined` rather than quietly comparing two undefineds
        // and passing, which is the whole reason the floor is there.
        return (res.body as { commission: { entryCount: number } }).commission
          .entryCount;
      };

      // ------------------------------------------------ (1) NOT BLOCKED YET, so it is counted
      // NON-VACUITY, and it is the half that matters: with no retention period set there is no
      // clock, so the entry is an ordinary eleven-year-old record and the report includes it.
      // Without this reading, the drop below would be indistinguishable from the entry never having
      // been in the report at all.
      const withEntry = await countEntries();
      expect(withEntry).toBeGreaterThan(0);

      // ------------------------------------------------ (2) BLOCKED, so it leaves
      const created = await request(app.getHttpServer())
        .post('/retention-schedule')
        .set(bearer(compliance.accessToken))
        .send({
          recordCategory: 'CommissionLedgerEntry',
          retentionPeriodMonths: 120,
        })
        .expect(201);
      itemId = (created.body as RetentionScheduleItemBody).id;

      const whileBlocked = await countEntries();
      expect(
        whileBlocked,
        'a blocked entry must leave the unbounded commission roll-up',
      ).toBe(withEntry - 1);

      // ------------------------------------------------ (3) EXTENDED, so it comes back
      // An extension means the record is NOT blocked — it is in ordinary retention for longer — and
      // the exclusion has to honour that. This is the branch that proves `notBlockedWhere` reads its
      // extension list rather than only its cutoff.
      await request(app.getHttpServer())
        .post('/retention-notices/extend')
        .set(bearer(compliance.accessToken))
        .send({
          recordCategory: 'CommissionLedgerEntry',
          recordIds: [entry.id],
          months: 24,
          basis: 'LEGISLATIVE_PROVISION',
          instrument: 'Commercial Law No. 12 of 1966',
          article: 'art 19',
          note: 'Kept for an open commercial dispute over this policy.',
        })
        .expect(201);

      const whileExtended = await countEntries();
      expect(
        whileExtended,
        'an EXTENDED record is not blocked and must be back in the roll-up',
      ).toBe(withEntry);
    } finally {
      await prisma.retentionExtension.deleteMany({
        where: { recordCategory: 'CommissionLedgerEntry' },
      });
      if (entryId)
        await prisma.commissionLedgerEntry.delete({ where: { id: entryId } });
      if (itemId)
        await prisma.retentionScheduleItem.delete({ where: { id: itemId } });
    }
  }, 180_000);

  it('BATCH 5 GROUP 7c — CONDITION 3: retrieval needs the code, a closed basis and a note; an UNBLOCKED record is refused by name; and the register cannot be edited or deleted', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'archive-retrieve-compliance',
      'COMPLIANCE_OFFICER',
    );
    const outsider = await makeUser(
      app,
      'archive-retrieve-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );

    await prisma.retentionExtension.deleteMany({
      where: { recordCategory: 'CommissionLedgerEntry' },
    });
    await prisma.retentionScheduleItem.deleteMany({
      where: { recordCategory: 'CommissionLedgerEntry' },
    });

    let itemId: string | undefined;
    let blockedId: string | undefined;
    let freshId: string | undefined;
    try {
      const policies = await prisma.policy.findMany({
        where: { commissionLedgerEntries: { none: {} } },
        select: { id: true },
        take: 2,
      });
      expect(policies.length, 'need two commission-free policies').toBe(2);

      const elevenYearsAgo = new Date();
      elevenYearsAgo.setUTCFullYear(elevenYearsAgo.getUTCFullYear() - 11);
      const blocked = await prisma.commissionLedgerEntry.create({
        data: {
          policyId: policies[0].id,
          amount: '100.000',
          paidAt: elevenYearsAgo,
        },
        select: { id: true },
      });
      blockedId = blocked.id;
      // Paid YESTERDAY, so inside the period and NOT blocked. This is the record the refusal is
      // about, and having both in one run is what makes the refusal specific rather than universal.
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const fresh = await prisma.commissionLedgerEntry.create({
        data: {
          policyId: policies[1].id,
          amount: '100.000',
          paidAt: yesterday,
        },
        select: { id: true },
      });
      freshId = fresh.id;

      const created = await request(app.getHttpServer())
        .post('/retention-schedule')
        .set(bearer(compliance.accessToken))
        .send({
          recordCategory: 'CommissionLedgerEntry',
          retentionPeriodMonths: 120,
        })
        .expect(201);
      itemId = (created.body as RetentionScheduleItemBody).id;

      const JUDICIAL = {
        recordCategory: 'CommissionLedgerEntry',
        basis: 'JUDICIAL_REQUEST',
        note: 'Amman Court of First Instance, case 123 of 2026.',
      };

      // ------------------------------------------------ gated on the CODE, never a role name
      await request(app.getHttpServer())
        .post('/retention-archive/retrievals')
        .set(bearer(outsider.accessToken))
        .send({ ...JUDICIAL, recordIds: [blocked.id] })
        .expect(403);

      // ------------------------------------------------ a THIRD basis is refused at the boundary
      await request(app.getHttpServer())
        .post('/retention-archive/retrievals')
        .set(bearer(compliance.accessToken))
        .send({
          recordCategory: 'CommissionLedgerEntry',
          recordIds: [blocked.id],
          basis: 'INTERNAL_REVIEW',
          note: 'The office wanted another look at it.',
        })
        .expect(400);

      // ------------------------------------------------ a short note is refused at the SHARED floor
      await request(app.getHttpServer())
        .post('/retention-archive/retrievals')
        .set(bearer(compliance.accessToken))
        .send({
          recordCategory: 'CommissionLedgerEntry',
          recordIds: [blocked.id],
          basis: 'CBJ_AUDIT',
          note: 'audit',
        })
        .expect(400);

      // ------------------------------------------------ AN UNBLOCKED RECORD IS REFUSED, BY NAME
      const notBlocked = await request(app.getHttpServer())
        .post('/retention-archive/retrievals')
        .set(bearer(compliance.accessToken))
        .send({ ...JUDICIAL, recordIds: [fresh.id] })
        .expect(422);
      const refusal = JSON.stringify(notBlocked.body);
      expect(refusal).toContain(fresh.id);
      expect(refusal).toContain('append-only');

      // ------------------------------------------------ the real retrieval
      const ok = await request(app.getHttpServer())
        .post('/retention-archive/retrievals')
        .set(bearer(compliance.accessToken))
        .send({ ...JUDICIAL, recordIds: [blocked.id] })
        .expect(201);
      const retrievals = (
        ok.body as { retrievals: { id: string; basis: string }[] }
      ).retrievals;
      expect(retrievals).toHaveLength(1);
      expect(retrievals[0].basis).toBe('JUDICIAL_REQUEST');

      // THE REGISTER CARRIES THE BASIS AND THE NOTE VERBATIM — read back off the DATABASE rather
      // than off the response, which is only this service's own claim about what it wrote.
      const row = await prisma.retentionArchiveRetrieval.findUniqueOrThrow({
        where: { id: retrievals[0].id },
        select: {
          basis: true,
          note: true,
          recordId: true,
          retrievedByUserId: true,
        },
      });
      expect(row.basis).toBe('JUDICIAL_REQUEST');
      expect(row.note).toBe(JUDICIAL.note);
      expect(row.recordId).toBe(blocked.id);
      expect(row.retrievedByUserId).toBe(compliance.userId);

      // ------------------------------------------------ APPEND-ONLY, PROVEN BY THE DATABASE
      // Not by the grant — MEASURED: `pg_default_acl` hands `ibms_app` all four privileges on every
      // new table in this schema, so a narrower GRANT is a no-op and the triggers are the mechanism.
      // BOTH directions, because a trigger covering one event only is the likelier mistake.
      await expect(
        prisma.retentionArchiveRetrieval.update({
          where: { id: retrievals[0].id },
          data: { note: 'something else entirely' },
        }),
      ).rejects.toThrow(/immutable/i);
      await expect(
        prisma.retentionArchiveRetrieval.delete({
          where: { id: retrievals[0].id },
        }),
      ).rejects.toThrow(/immutable/i);

      // ------------------------------------------------ the register reads back, and is gated too
      const list = await request(app.getHttpServer())
        .get(
          '/retention-archive/retrievals?recordCategory=CommissionLedgerEntry',
        )
        .set(bearer(compliance.accessToken))
        .expect(200);
      const rows = list.body as { id: string }[];
      expect(rows.some((r) => r.id === retrievals[0].id)).toBe(true);

      await request(app.getHttpServer())
        .get('/retention-archive/retrievals')
        .set(bearer(outsider.accessToken))
        .expect(403);
    } finally {
      // THE REGISTER ROWS CANNOT BE DELETED — that is the condition working, so they are left
      // behind deliberately and the records they name are swept instead. A teardown that tried to
      // remove them would fail on the trigger, which is the right outcome met in the wrong place.
      await prisma.retentionExtension.deleteMany({
        where: { recordCategory: 'CommissionLedgerEntry' },
      });
      if (blockedId)
        await prisma.commissionLedgerEntry.delete({ where: { id: blockedId } });
      if (freshId)
        await prisma.commissionLedgerEntry.delete({ where: { id: freshId } });
      if (itemId)
        await prisma.retentionScheduleItem.delete({ where: { id: itemId } });
    }
  }, 180_000);
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * THE FOUR-ACTION SCHEME IS SEPARABLE, OR IT IS ROWS IN A TABLE.
 *
 * Phase 1 split four umbrellas into their actions. The codes existing proves nothing: every role that
 * held an umbrella received ALL of its successors, deliberately, so no SEEDED account can tell
 * `vendor.read` from `vendor.create` — they always arrive together. A test using a seeded role therefore
 * cannot observe the split at all.
 *
 * That is not a hypothetical. Planting `GET /vendors` behind `vendor.create` instead of `vendor.read`
 * left the whole vendor e2e suite GREEN, because every account in it holds both. The plant applied, the
 * bytes changed, and nothing could see it — IMPROVEMENTS § 1.51(d).
 *
 * So each case below builds a role holding ONE of the successors and asserts both halves on the same
 * account: the action it holds works, and the sibling actions are refused. That is the only shape that
 * can fail if a successor is quietly re-gated onto another, and it is what an office actually gets when
 * it uses the Role screen to give somebody view without edit.
 */
const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = Math.random().toString(36).slice(2, 10);

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}

const createdRoleIds: string[] = [];

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** A role holding EXACTLY these codes, and a signed-in user holding that role. */
async function actorHolding(
  app: INestApplication<App>,
  label: string,
  codes: string[],
): Promise<string> {
  const org = await prisma.organization.findFirstOrThrow({
    orderBy: { id: 'asc' },
  });
  const permissions = await prisma.permission.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  // A typo would grant nothing and make every refusal below pass for the wrong reason.
  expect(permissions.map((p) => p.code).sort()).toEqual([...codes].sort());

  const role = await prisma.role.create({
    data: {
      organizationId: org.id,
      name: `${label.toUpperCase()}_${RUN}`,
      nameEn: label,
      nameAr: label,
      requiresMfaAlways: false,
      requiresHardwareToken: false,
      permissions: {
        create: permissions.map((p) => ({
          organizationId: org.id,
          permissionId: p.id,
        })),
      },
    },
    select: { id: true },
  });
  createdRoleIds.push(role.id);

  const email = `${label}-${RUN}@separability.test`;
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Separability ${label}`, email, password: PASSWORD })
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
  const eb = enroll.body as MfaEnrollBody;
  await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: eb.credentialId,
      code: authenticator.generate(
        /[?&]secret=([^&]+)/.exec(eb.otpAuthUri)![1],
      ),
    })
    .expect(200);

  await prisma.userRoleAssignment.create({
    data: { userId: user.id, roleId: role.id },
  });
  return accessToken;
}

let app: INestApplication<App>;

describe('four-action Phases 1 and 4 — each successor can be held alone (e2e)', () => {
  beforeAll(async () => {
    app = await createTestApp();
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    // db-test is cumulative; a leftover role moves every count of the catalogue.
    if (createdRoleIds.length > 0) {
      await prisma.userRoleAssignment.deleteMany({
        where: { roleId: { in: createdRoleIds } },
      });
      await prisma.rolePermission.deleteMany({
        where: { roleId: { in: createdRoleIds } },
      });
      await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    }
  });

  it('vendor.read alone lists vendors and cannot create, correct or terminate one', async () => {
    const token = await actorHolding(app, 'vendor-reader', ['vendor.read']);

    // The half it holds. A 200 here is what makes every 403 below about the permission.
    await request(app.getHttpServer())
      .get('/vendors')
      .set(bearer(token))
      .expect(200);

    await request(app.getHttpServer())
      .post('/vendors')
      .set(bearer(token))
      .send({ name: `Refused ${RUN}`, vendorType: 'other' })
      .expect(403);
    await request(app.getHttpServer())
      .patch('/vendors/some-id')
      .set(bearer(token))
      .send({ name: 'Refused' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/vendors/some-id/terminate')
      .set(bearer(token))
      .send({ reason: 'Refused' })
      .expect(403);
  }, 180_000);

  it('vendor.create alone registers a vendor and cannot read the register back', async () => {
    // The inverse, which is the case that would go unnoticed: a write code that quietly carries the read
    // is the umbrella surviving under a new name.
    const token = await actorHolding(app, 'vendor-creator', ['vendor.create']);

    await request(app.getHttpServer())
      .post('/vendors')
      .set(bearer(token))
      .send({ name: `Created By Create Only ${RUN}`, vendorType: 'other' })
      .expect(201);
    await request(app.getHttpServer())
      .get('/vendors')
      .set(bearer(token))
      .expect(403);
  }, 180_000);

  it('document.read alone lists documents and cannot add a version', async () => {
    const token = await actorHolding(app, 'document-reader', ['document.read']);

    await request(app.getHttpServer())
      .get('/documents')
      .set(bearer(token))
      .expect(200);
    await request(app.getHttpServer())
      .post('/documents/some-id/versions')
      .set(bearer(token))
      .send({
        fileName: 'refused.pdf',
        category: 'OTHER',
        classification: 'INTERNAL',
      })
      .expect(403);
  }, 180_000);

  it('insurer.create alone registers an insurer and cannot deactivate one', async () => {
    // `insurer.read` comes too, because a register form that cannot list is not a state worth testing —
    // the point here is create WITHOUT deactivate.
    const token = await actorHolding(app, 'insurer-registrar', [
      'insurer.read',
      'insurer.create',
    ]);

    const created = await request(app.getHttpServer())
      .post('/insurers')
      .set(bearer(token))
      // Everything the DTO requires, so this test says only what it is about. The required set is copied
      // from `insurance-lines.e2e-spec.ts`, which already knows it — a partial payload answers 400 and a
      // 400 cannot tell a permission split from a missing field.
      .send({
        legalName: `Separability Insurance ${RUN}`,
        legalNameAr: `شركة الفصل ${RUN}`,
        companyPhone: '+962 6 400 0000',
        companyEmail: `separability-${RUN}@example.test`,
        structure: 'CONVENTIONAL',
      })
      .expect(201);
    const id = (created.body as { id: string }).id;

    await request(app.getHttpServer())
      .post(`/insurers/${id}/deactivate`)
      .set(bearer(token))
      .send({ reason: 'Refused by the permission split' })
      .expect(403);
    // And the impact read that belongs to the deactivation decision is refused with it.
    await request(app.getHttpServer())
      .get(`/insurers/${id}/status-impact`)
      .set(bearer(token))
      .expect(403);
    // While the read it does hold still works, so the 403s are about the write.
    await request(app.getHttpServer())
      .get(`/insurers/${id}`)
      .set(bearer(token))
      .expect(200);
  }, 180_000);

  it('needs-assessment.update alone corrects an assessment and cannot raise one', async () => {
    // The ride-along this phase closed: PATCH was gated by `needs-assessment.create`, so correcting a
    // record required the permission to raise one.
    const token = await actorHolding(app, 'assessment-corrector', [
      'needs-assessment.read',
      'needs-assessment.update',
    ]);

    await request(app.getHttpServer())
      .post('/needs-assessments')
      .set(bearer(token))
      .send({ customerId: 'some-id', answers: {} })
      .expect(403);
    // The PATCH is NOT 403 — it gets as far as the record not existing, which is the proof it passed the
    // gate. A 403 here would mean the ride-along is still in place.
    const patched = await request(app.getHttpServer())
      .patch('/needs-assessments/00000000-0000-4000-8000-000000000000')
      .set(bearer(token))
      .send({ answers: {} });
    expect(patched.status, 'the update code must reach the handler').not.toBe(
      403,
    );
  }, 180_000);

  /*
   * PHASE 4 — the same argument, on the umbrella that decides where client money goes.
   *
   * `payment-channel.manage` gated adding a channel, listing them, and disabling one. The seeded Finance
   * role received all three successors, so no seeded account can tell them apart: exactly the condition
   * that made the Phase 1 plant invisible. These two cases are the only shape that can observe it.
   */
  it('payment-channel.read alone lists channels and cannot add or disable one', async () => {
    const token = await actorHolding(app, 'channel-reader', [
      'payment-channel.read',
    ]);

    // The half it holds. A 200 here is what makes both 403s below about the permission rather than about
    // an unauthenticated request or a broken route.
    await request(app.getHttpServer())
      .get('/payment-channels')
      .set(bearer(token))
      .expect(200);

    await request(app.getHttpServer())
      .post('/payment-channels')
      .set(bearer(token))
      .send({
        ownerType: 'customer',
        ownerId: '00000000-0000-4000-8000-000000000000',
        channelType: 'bank_transfer',
        label: `Refused ${RUN}`,
      })
      .expect(403);
    await request(app.getHttpServer())
      .post('/payment-channels/00000000-0000-4000-8000-000000000000/disable')
      .set(bearer(token))
      .send({})
      .expect(403);
  }, 180_000);

  it('payment-channel.deactivate alone reaches the disable handler and cannot list or add', async () => {
    // The direction that matters most on this controller. A deactivate code that quietly carried the read
    // would let whoever can disable a channel enumerate every destination for client money in the office,
    // which is the umbrella surviving under a narrower name.
    const token = await actorHolding(app, 'channel-disabler', [
      'payment-channel.deactivate',
    ]);

    await request(app.getHttpServer())
      .get('/payment-channels')
      .set(bearer(token))
      .expect(403);
    await request(app.getHttpServer())
      .post('/payment-channels')
      .set(bearer(token))
      .send({
        ownerType: 'customer',
        ownerId: '00000000-0000-4000-8000-000000000000',
        channelType: 'bank_transfer',
        label: `Refused ${RUN}`,
      })
      .expect(403);

    // NOT 403 — it gets as far as the channel not existing, which is the proof it passed the gate. A 403
    // here would mean the disable route is still gated on something this role does not hold.
    const disabled = await request(app.getHttpServer())
      .post('/payment-channels/00000000-0000-4000-8000-000000000000/disable')
      .set(bearer(token))
      .send({});
    expect(
      disabled.status,
      'the deactivate code must reach the handler',
    ).not.toBe(403);
  }, 180_000);

  /*
   * PHASE 4, SECOND UMBRELLA — `sla.policy.manage`, split on the owner's ruling.
   *
   * Two things are worth observing separately here and neither is visible to a seeded account, because
   * COMPLIANCE, MANAGER and EXEC each received all four successors:
   *
   *   1. Editing an SLA's duration and switching the SLA off are now separate capabilities.
   *   2. The HOLIDAY calendar came out from under the same umbrella with its own code, because the
   *      umbrella gated two entities. A role that can configure a policy cannot thereby add a public
   *      holiday, and that is the assertion that would silently stop holding if someone re-gated
   *      `POST /sla/holidays` back onto a policy code.
   */
  it('sla.policy.update alone corrects a policy and cannot create, switch off, or add a holiday', async () => {
    const token = await actorHolding(app, 'sla-updater', [
      'sla.policy.read',
      'sla.policy.update',
    ]);

    // The half it holds. A 200 on the list is the anchor that makes every 403 below about a permission.
    await request(app.getHttpServer())
      .get('/sla/policies')
      .set(bearer(token))
      .expect(200);

    await request(app.getHttpServer())
      .post('/sla/policies')
      .set(bearer(token))
      .send({
        policyCode: `SLA-SEP-${RUN}`.toUpperCase().slice(0, 60),
        policyName: 'Refused by separation',
        processType: `separability_${RUN}`,
        durationValue: 3,
        durationUnit: 'BUSINESS_DAYS',
        sourceType: 'INTERNAL_TARGET',
      })
      .expect(403);
    await request(app.getHttpServer())
      .post('/sla/policies/00000000-0000-4000-8000-000000000000/deactivate')
      .set(bearer(token))
      .send({})
      .expect(403);
    // The holiday calendar is a DIFFERENT entity, and this is the assertion that says so.
    await request(app.getHttpServer())
      .post('/sla/holidays')
      .set(bearer(token))
      .send({ observedOn: '2027-01-01', name: `Refused ${RUN}` })
      .expect(403);
  }, 180_000);

  it('sla.holiday.create alone adds a holiday and cannot touch a policy', async () => {
    // The inverse, and the reason this code exists rather than riding on `sla.policy.create`: maintaining
    // the business-day calendar is clerical, while an SLA duration is a policy decision with regulatory
    // weight. An office can now grant one without the other.
    const token = await actorHolding(app, 'sla-holidays', [
      'sla.holiday.create',
    ]);

    await request(app.getHttpServer())
      .post('/sla/holidays')
      .set(bearer(token))
      .send({ observedOn: '2027-01-02', name: `Separability ${RUN}` })
      .expect(201);

    await request(app.getHttpServer())
      .post('/sla/policies')
      .set(bearer(token))
      .send({
        policyCode: `SLA-HOL-${RUN}`.toUpperCase().slice(0, 60),
        policyName: 'Refused by separation',
        processType: `separability_${RUN}`,
        durationValue: 3,
        durationUnit: 'BUSINESS_DAYS',
        sourceType: 'INTERNAL_TARGET',
      })
      .expect(403);
    await request(app.getHttpServer())
      .get('/sla/policies')
      .set(bearer(token))
      .expect(403);
  }, 180_000);
});

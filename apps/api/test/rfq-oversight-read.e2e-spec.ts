import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * WIDENING THE RFQ ROUTE IS NOT ENOUGH, AND THIS FILE IS WHY.
 *
 * Item 4's decision is that Claims, Compliance and the DPO may read an RFQ and its
 * correspondence. The route gate is the layer the decision names — and it is not the
 * layer that refuses them.
 *
 * `RfqService` resolves an RFQ through its parent Opportunity's CUSTOMER, and
 * `assertCustomerVisible` admits the caller only if they own that customer file or hold
 * `customer-file.all-owners.read`. Measured: that code is held by
 * BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT and PLACEMENT_TECHNICAL_OFFICER —
 * and by none of the three oversight roles. The DPO holds no `*.all-owners.read` code
 * of any kind.
 *
 * So the decided any-of was applied to the controller and the result measured over real
 * HTTP: the Manager got 200 and all three oversight roles got **404 "RFQ not found"** —
 * about an RFQ that exists. The widening delivered no capability and replaced an honest
 * 403 ("you do not hold the permission") with a sentence that is not true. It was taken
 * back out, and the decision went to the owner.
 *
 * WHAT THIS FILE PINS, therefore, is the state as it stands plus the trap:
 *
 *  1. A Manager reads both routes — the non-vacuity floor. Without it, three assertions
 *     about a refusal could all pass against an RFQ nobody can read.
 *  2. Claims, Compliance and the DPO are refused with **403**, at the route.
 *
 * A **404** in place of either 403 is the finding this file exists to catch: it means
 * somebody widened the route without widening what the service can see, which is the
 * § 1.62 shape — a gate nothing can satisfy — one layer down. Do not "fix" that by
 * loosening these assertions to accept either status: 403 and 404 are different claims,
 * and only one of them is true.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

let app: INestApplication<App> | null = null;

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function makeUser(
  label: string,
  roleName: string,
): Promise<{ accessToken: string; userId: string }> {
  const email = `rfq-oversight-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `RFQ Oversight ${label}`, email, password: PASSWORD })
    .expect(201);
  const login = await request(app!.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = login.body as { accessToken: string; user: { id: string } };

  const enroll = await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(body.accessToken))
    .expect(201);
  const enrollBody = enroll.body as {
    credentialId: string;
    otpAuthUri: string;
  };
  const secret = /[?&]secret=([^&]+)/.exec(enrollBody.otpAuthUri)![1];
  await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(body.accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secret),
    })
    .expect(200);

  const role = await ensureRole(roleName);
  await prisma.userRoleAssignment.create({
    data: { userId: body.user.id, roleId: role.id },
  });
  return { accessToken: body.accessToken, userId: body.user.id };
}

/**
 * An RFQ that already exists, owned by somebody else. That is the ordinary case for an
 * oversight reader and the only one that matters: an RFQ on a customer the reader
 * happens to own would be admitted by ownership and would prove nothing about the
 * widening. Read rather than created — the creation chain is customer -> opportunity ->
 * needs assessment -> programme -> RFQ, and none of it is what this file is about.
 */
async function anExistingRfqOwnedByAnother(selfId: string): Promise<string> {
  const rfqs = await prisma.rFQ.findMany({
    select: { id: true, opportunityId: true },
    take: 25,
  });
  for (const rfq of rfqs) {
    const opp = await prisma.opportunity.findUnique({
      where: { id: rfq.opportunityId },
      select: { customerId: true },
    });
    if (!opp) continue;
    const customer = await prisma.customer.findUnique({
      where: { id: opp.customerId },
      select: { ownerUserId: true },
    });
    if (customer && customer.ownerUserId !== selfId) return rfq.id;
  }
  throw new Error(
    'no RFQ on another user’s customer in db-test — this file needs one to read, and ' +
      'an RFQ the reader owns cannot distinguish the route gate from the ownership filter',
  );
}

describe('an oversight role cannot reach an RFQ, and the refusal is a 403', () => {
  let manager: { accessToken: string; userId: string };
  let claims: { accessToken: string; userId: string };
  let compliance: { accessToken: string; userId: string };
  let dpo: { accessToken: string; userId: string };
  let rfqId: string;

  beforeAll(async () => {
    app = await createTestApp();
    manager = await makeUser('manager', 'BRANCH_DEPARTMENT_MANAGER');
    claims = await makeUser('claims', 'CLAIMS_OFFICER');
    compliance = await makeUser('compliance', 'COMPLIANCE_OFFICER');
    dpo = await makeUser('dpo', 'DATA_PROTECTION_OFFICER');
    rfqId = await anExistingRfqOwnedByAnother(manager.userId);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
  });

  it('a Manager reads the RFQ and its correspondence — the non-vacuity floor', async () => {
    const rfq = await request(app!.getHttpServer())
      .get(`/rfqs/${rfqId}`)
      .set(bearer(manager.accessToken))
      .expect(200);
    expect((rfq.body as { id: string }).id).toBe(rfqId);

    const comms = await request(app!.getHttpServer())
      .get(`/rfqs/${rfqId}/communications`)
      .set(bearer(manager.accessToken))
      .expect(200);
    expect(Array.isArray(comms.body)).toBe(true);
  }, 300_000);

  for (const role of [
    'CLAIMS_OFFICER',
    'COMPLIANCE_OFFICER',
    'DATA_PROTECTION_OFFICER',
  ] as const) {
    it(`${role} is refused at the ROUTE with 403, not told the RFQ does not exist`, async () => {
      const actor =
        role === 'CLAIMS_OFFICER'
          ? claims
          : role === 'COMPLIANCE_OFFICER'
            ? compliance
            : dpo;

      for (const path of [`/rfqs/${rfqId}`, `/rfqs/${rfqId}/communications`]) {
        const res = await request(app!.getHttpServer())
          .get(path)
          .set(bearer(actor.accessToken));
        // 403 and 404 are different claims about the same request. A 404 here means the
        // route was widened without the ownership filter, so this role now gets a
        // sentence that is false about a record it still cannot read.
        expect({ path, status: res.status }).toEqual({ path, status: 403 });
      }
    }, 300_000);
  }
});

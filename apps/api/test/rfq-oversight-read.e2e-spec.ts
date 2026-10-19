import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * DOOR FOUR, OVER REAL HTTP — an oversight role reads a customer's RFQ chain ONLY while an open
 * piece of work on that customer is assigned to them, and the window shuts when the work does.
 *
 * ## WHY THIS FILE IS THE PROOF AND A UNIT TEST IS NOT
 *
 * The mechanism is TWO layers and they fail differently. `PermissionsGuard` decides who may ASK
 * (403); `CustomerFileAnchorService`, reached inside `RfqService`, decides whose file they may see
 * (404). A unit test with a mocked anchor asserts the mock. An earlier version of this file
 * measured the first layer alone and proved the SECOND one refuses — which is how door four came
 * to be designed at all.
 *
 * ## WHAT IS ASSERTED, AND WHY EACH ONE IS SEPARATE
 *
 *  1. A Manager reads both routes. The non-vacuity floor: without it every refusal below could
 *     pass against an RFQ nobody can read, and the whole file would be green and empty.
 *  2. UNANCHORED, the Compliance Officer and the DPO get **404**. They pass the route gate now, so
 *     404 is the honest answer — the anchor layer refused, and a 403 would be false about why.
 *  3. ANCHORED, each of them gets **200** on both routes — and the anchor is the OTHER one's work
 *     in neither case: the DSR names the DPO as handler, the screening case names the Compliance
 *     Officer as assignee, and each is tested against its own anchor only.
 *  4. THE WINDOW SHUTS. The DSR is closed and the same request becomes 404 again. This is the
 *     property the entire design exists for, so it is asserted rather than assumed from the query.
 *  5. IT IS PER CUSTOMER. The anchored DPO reads a DIFFERENT customer's RFQ and gets 404 — an
 *     anchor opens one file, not the book.
 *  6. IT IS READ ONLY. The anchored Compliance Officer's write is refused.
 *  7. THE CLAIMS OFFICER IS UNCHANGED at **403**, at the route, for both routes. Its anchor — a
 *     claim ASSIGNED to him — is not expressible in this product, so it is deliberately NOT
 *     admitted: a 404 for a role that can never satisfy the second layer would be a false sentence
 *     about a record that exists.
 *  8. THE AUDIT ROW exists for the anchored read and NOT for the Manager's. The log is half of this
 *     guard, so its absence is a defect and not a missing nicety.
 *
 * Do not relax a status here to accept either value: 403 and 404 are different claims about the
 * same request, and only one of them is ever true.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

let app: INestApplication<App> | null = null;

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

interface Actor {
  accessToken: string;
  userId: string;
}

async function makeUser(label: string, roleName: string): Promise<Actor> {
  const email = `rfq-door4-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `RFQ Door4 ${label}`, email, password: PASSWORD })
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
 * Two existing RFQs on DIFFERENT customers, neither owned by our actors.
 *
 * Read rather than created: the chain is customer -> opportunity -> needs assessment -> programme
 * -> RFQ and none of it is what this file is about. Owned by somebody else is the ordinary case for
 * an oversight reader and the only one that proves anything — an RFQ the reader owns would be
 * admitted by ownership and would say nothing about the anchor.
 */
async function twoRfqsOnDifferentCustomers(): Promise<
  { rfqId: string; customerId: string }[]
> {
  const rfqs = await prisma.rFQ.findMany({
    select: { id: true, opportunityId: true },
    take: 40,
  });
  const found: { rfqId: string; customerId: string }[] = [];
  const seen = new Set<string>();
  for (const rfq of rfqs) {
    const opp = await prisma.opportunity.findUnique({
      where: { id: rfq.opportunityId },
      select: { customerId: true },
    });
    if (!opp || seen.has(opp.customerId)) continue;
    seen.add(opp.customerId);
    found.push({ rfqId: rfq.id, customerId: opp.customerId });
    if (found.length === 2) return found;
  }
  throw new Error(
    'db-test needs two RFQs on two different customers for this file; found ' +
      String(found.length),
  );
}

describe('door four: an anchored oversight read of an RFQ', () => {
  let manager: Actor;
  let compliance: Actor;
  let dpo: Actor;
  let claims: Actor;

  let target: { rfqId: string; customerId: string };
  let other: { rfqId: string; customerId: string };

  // The two anchors, created directly: their own creation routes are tested in their own modules,
  // and what this file is about is what an EXISTING open record opens.
  let dsrId: string;
  let kycRecordId: string;
  let screeningMatchId: string;

  beforeAll(async () => {
    app = await createTestApp();
    manager = await makeUser('manager', 'BRANCH_DEPARTMENT_MANAGER');
    compliance = await makeUser('compliance', 'COMPLIANCE_OFFICER');
    dpo = await makeUser('dpo', 'DATA_PROTECTION_OFFICER');
    claims = await makeUser('claims', 'CLAIMS_OFFICER');

    const pair = await twoRfqsOnDifferentCustomers();
    target = pair[0];
    other = pair[1];

    const dsr = await prisma.dataSubjectRequest.create({
      data: {
        customerId: target.customerId,
        dpoHandlerUserId: dpo.userId,
        type: 'ACCESS',
        // Open by default (RECEIVED). Not stated, so the default being open is exercised rather
        // than worked around.
        slaDueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });
    dsrId = dsr.id;

    const kyc = await prisma.kYCRecord.create({
      data: {
        customerId: target.customerId,
        createdByUserId: compliance.userId,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    kycRecordId = kyc.id;

    const match = await prisma.screeningMatch.create({
      data: {
        kycRecordId,
        entrySource: 'OFAC_SDN',
        entryFullName: 'Door Four Fixture',
        subjectName: 'Door Four Fixture',
        subjectCanonical: 'door four fixture',
        matchType: 'NAME',
        listType: 'SANCTIONS',
        // `'pending'`, lowercase, because `ScreeningMatch_decided_is_closed` requires
        // `status = 'pending'` on any case that is not CLOSED. The database refused the first
        // version of this fixture, which is the constraint doing its job.
        status: 'pending',
        caseStatus: 'ASSIGNED',
        assignedToUserId: compliance.userId,
      },
      select: { id: true },
    });
    screeningMatchId = match.id;
  }, 300_000);

  afterAll(async () => {
    // Children first: `ScreeningMatch` points at the KYC record, and db-test is cumulative, so a
    // leftover open case would silently anchor a later run of this file.
    if (screeningMatchId)
      await prisma.screeningMatch.deleteMany({
        where: { id: screeningMatchId },
      });
    if (kycRecordId)
      await prisma.kYCRecord.deleteMany({ where: { id: kycRecordId } });
    if (dsrId)
      await prisma.dataSubjectRequest.deleteMany({ where: { id: dsrId } });
    await app?.close();
  });

  function read(actor: Actor, rfqId: string, suffix = '') {
    return request(app!.getHttpServer())
      .get(`/rfqs/${rfqId}${suffix}`)
      .set(bearer(actor.accessToken));
  }

  it('1 — a Manager reads both routes: the non-vacuity floor', async () => {
    const rfq = await read(manager, target.rfqId).expect(200);
    expect((rfq.body as { id: string }).id).toBe(target.rfqId);
    const comms = await read(manager, target.rfqId, '/communications').expect(
      200,
    );
    expect(Array.isArray(comms.body)).toBe(true);
  }, 300_000);

  it('7 — the CLAIMS_OFFICER is refused at the ROUTE with 403, not told the record is missing', async () => {
    // Unchanged by door four, deliberately: its anchor is not expressible, so it is not admitted.
    for (const suffix of ['', '/communications']) {
      const res = await read(claims, target.rfqId, suffix);
      expect({ suffix, status: res.status }).toEqual({ suffix, status: 403 });
    }
  }, 300_000);

  it('3 — an open DSR handled by the DPO opens that customer, on both routes', async () => {
    const rfq = await read(dpo, target.rfqId).expect(200);
    expect((rfq.body as { id: string }).id).toBe(target.rfqId);
    await read(dpo, target.rfqId, '/communications').expect(200);
  }, 300_000);

  it('3 — an open screening case assigned to the Compliance Officer opens that customer, on both routes', async () => {
    const rfq = await read(compliance, target.rfqId).expect(200);
    expect((rfq.body as { id: string }).id).toBe(target.rfqId);
    await read(compliance, target.rfqId, '/communications').expect(200);
  }, 300_000);

  it('5 — an anchor opens ONE file, not the book: a different customer is still 404', async () => {
    for (const actor of [dpo, compliance]) {
      const res = await read(actor, other.rfqId);
      expect(res.status).toBe(404);
    }
  }, 300_000);

  it('6 — READ ONLY: the anchored Compliance Officer cannot write to the RFQ', async () => {
    const res = await request(app!.getHttpServer())
      .post(`/rfqs/${target.rfqId}/insurers`)
      .set(bearer(compliance.accessToken))
      .send({ insurerIds: [] });
    // Refused at the route — `rfq.create` is Placement's — so the anchor is never consulted. Two
    // layers refuse this, and the inventory spec pins the second: `anchors.resolve` has ONE call
    // site and it is on the read path.
    expect(res.status).toBe(403);
  }, 300_000);

  it('8 — the anchored read is AUDITED, and an owner-level read is not', async () => {
    const before = await prisma.auditLogEntry.count({
      where: { action: 'READ', entityType: 'RFQ', entityId: target.rfqId },
    });

    await read(manager, target.rfqId).expect(200);
    const afterManager = await prisma.auditLogEntry.count({
      where: { action: 'READ', entityType: 'RFQ', entityId: target.rfqId },
    });
    // A whole-book reader never reaches the anchor path, so nothing is logged for them. This is the
    // half that keeps a one-person office at ZERO such rows.
    expect(afterManager).toBe(before);

    await read(dpo, target.rfqId).expect(200);
    const rows = await prisma.auditLogEntry.findMany({
      where: {
        action: 'READ',
        entityType: 'RFQ',
        entityId: target.rfqId,
        userId: dpo.userId,
      },
      select: { afterValue: true, isSensitiveDataAccess: true },
      orderBy: { occurredAt: 'desc' },
      take: 1,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isSensitiveDataAccess).toBe(true);
    // THE ANCHOR IS ON THE ROW, by type and id — so "why was this read allowed" is answerable from
    // the log alone, after the DSR has closed and the query would answer differently.
    expect(rows[0].afterValue).toMatchObject({
      view: 'rfq',
      anchorType: 'DSR',
      anchorId: dsrId,
      customerId: target.customerId,
    });
  }, 300_000);

  it('4 — THE WINDOW SHUTS: closing the DSR makes the same request 404 again', async () => {
    // Asserted last, because it changes the fixture. The DPO's only anchor is this DSR.
    await read(dpo, target.rfqId).expect(200);
    await prisma.dataSubjectRequest.update({
      where: { id: dsrId },
      data: { status: 'FULFILLED', closedAt: new Date() },
    });
    const res = await read(dpo, target.rfqId);
    expect(res.status).toBe(404);
    // And the Compliance Officer, whose anchor is untouched, still reads it — so the refusal above
    // is the DSR closing and not the whole mechanism falling over.
    await read(compliance, target.rfqId).expect(200);
  }, 300_000);

  it('2 — UNANCHORED, both oversight roles get 404 rather than 403', async () => {
    // Also last-ish: it closes the screening case, so it runs after every test that needs it open.
    // All four fields, because `ScreeningMatch_closed_is_decided` requires a decided status, a
    // close time AND a non-empty reason on a CLOSED case. Closing it with `caseStatus` alone is
    // refused by the database — which is the right place for that rule.
    await prisma.screeningMatch.update({
      where: { id: screeningMatchId },
      data: {
        caseStatus: 'CLOSED',
        status: 'cleared',
        closedAt: new Date(),
        reviewReason:
          'Door four fixture: closing the anchor to prove the window shuts.',
      },
    });
    for (const actor of [dpo, compliance]) {
      for (const suffix of ['', '/communications']) {
        const res = await read(actor, target.rfqId, suffix);
        // 404: they passed the route gate and the ANCHOR layer refused. A 403 here would say they
        // hold no permission, which is no longer true.
        expect({ suffix, status: res.status }).toEqual({ suffix, status: 404 });
      }
    }
    // The floor again, at the end: the RFQ is still readable, so the four refusals above are about
    // the anchors and not about a record that disappeared mid-file.
    await read(manager, target.rfqId).expect(200);
  }, 300_000);
});

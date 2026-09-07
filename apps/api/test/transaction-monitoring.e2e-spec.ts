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
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}
function inDays(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface AlertBody {
  id: string;
  customerId: string | null;
  patternType: string;
  detailText: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  status: string;
  escalatedToSuspiciousActivity: boolean;
  escalatedAt: string | null;
  reportedToAuthorityAt: string | null;
  isClosed: boolean;
}
interface SweepResultBody {
  scanned: number;
  created: number;
  skippedExisting: number;
  failed: number;
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
    .send({ fullName: 'AML E2E User', email, password: PASSWORD })
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

describe('AML/CFT Transaction Monitoring (e2e) — backlog Part C #48', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('detects all four patterns via the sweep, supports manual log + escalate + report + close, and enforces permissions', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'aml-compliance',
      'COMPLIANCE_OFFICER',
    );
    const sales = await makeUser(
      app,
      'aml-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );

    const suffix = Math.random().toString(36).slice(2, 8);
    const customerA = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: `AML E2E Co A ${suffix}`,
        ownerUserId: sales.userId,
      },
    });
    const customerB = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: `AML E2E Co B ${suffix}`,
        ownerUserId: sales.userId,
      },
    });
    const insurer = await prisma.insurer.create({
      data: { name: `AML E2E ins ${suffix}` },
    });

    async function makePolicy(customerId: string) {
      const opp = await prisma.opportunity.create({ data: { customerId } });
      return prisma.policy.create({
        data: {
          opportunityId: opp.id,
          customerId,
          insurerId: insurer.id,
          insuranceLine: 'Property All Risks',
          requestedPremium: '1000.000',
          status: 'ACTIVE',
        },
      });
    }

    async function makeInvoiceAndReceipt(
      customerId: string,
      premiumAmount: string,
      paymentChannelId?: string,
    ) {
      const invoice = await prisma.invoice.create({
        data: {
          customerId,
          premiumAmount,
          totalAmount: premiumAmount,
          dueDate: inDays(30),
        },
      });
      const receipt = await prisma.receipt.create({
        data: {
          invoiceId: invoice.id,
          amount: premiumAmount,
          paymentChannelId,
        },
      });
      return { invoice, receipt };
    }

    async function makeCancellation(policyId: string, createdAt: Date) {
      const endorsement = await prisma.endorsement.create({
        data: {
          policyId,
          type: 'NEGATIVE',
          changeType: 'cancellation',
          premiumAdjustment: '-100.000',
          requestedByUserId: sales.userId,
        },
      });
      return prisma.cancellation.create({
        data: {
          endorsementId: endorsement.id,
          reason: 'e2e test',
          basis: 'pro_rata',
          returnPremium: '100.000',
          createdAt,
        },
      });
    }

    async function makeRefund(policyId: string, createdAt: Date) {
      const endorsement = await prisma.endorsement.create({
        data: {
          policyId,
          type: 'NEGATIVE',
          changeType: 'coverage_amendment',
          premiumAdjustment: '-50.000',
          requestedByUserId: sales.userId,
        },
      });
      return prisma.refund.create({
        data: {
          endorsementId: endorsement.id,
          amount: '50.000',
          reason: 'overpayment',
          raisedByUserId: sales.userId,
          createdAt,
        },
      });
    }

    const policyA = await makePolicy(customerA.id);
    await makePolicy(customerB.id);

    // customer-owned PaymentChannel for B, used (via a direct Prisma
    // Receipt.create below, NOT the real POST /invoices/:id/receipt
    // endpoint) to pay A's invoice. This scenario is unreachable through
    // CollectionService.assertReceiptChannelUsable, which rejects any real
    // receipt whose channel belongs to a different customer than the one
    // invoiced — see the DORMANT note on isThirdPartyPaymentSource
    // (transaction-monitoring.config.ts). This test proves the classifier
    // logic is correct, not that the scenario occurs in normal operation.
    const channelB = await prisma.paymentChannel.create({
      data: {
        ownerType: 'customer',
        customerId: customerB.id,
        channelType: 'bank_transfer',
        label: 'B main account',
      },
    });
    const channelA = await prisma.paymentChannel.create({
      data: {
        ownerType: 'customer',
        customerId: customerA.id,
        channelType: 'bank_transfer',
        label: 'A main account',
      },
    });

    // 1. large_premium_payment (well above the drafted 15000 threshold)
    const { receipt: largeReceipt } = await makeInvoiceAndReceipt(
      customerA.id,
      '20000.000',
      channelA.id,
    );
    // 2. third_party_payment_source (small, so it doesn't ALSO trip #1)
    const { receipt: thirdPartyReceipt } = await makeInvoiceAndReceipt(
      customerA.id,
      '500.000',
      channelB.id,
    );
    // 3. an ordinary receipt — small, own channel — must trip nothing
    await makeInvoiceAndReceipt(customerA.id, '400.000', channelA.id);

    // 4. frequent_cancellations (3, well within the 90-day window). Each
    // needs its own Policy — Endorsement_one_live_cancellation_per_policy
    // (migration 20260902170000) allows only one live `changeType:
    // 'cancellation'` Endorsement per policy at a time.
    const cancellationPolicies = await Promise.all([
      makePolicy(customerA.id),
      makePolicy(customerA.id),
      makePolicy(customerA.id),
    ]);
    await makeCancellation(cancellationPolicies[0].id, daysAgo(1));
    await makeCancellation(cancellationPolicies[1].id, daysAgo(5));
    await makeCancellation(cancellationPolicies[2].id, daysAgo(10));

    // 5. frequent_refunds (3, well within the 90-day window)
    await makeRefund(policyA.id, daysAgo(1));
    await makeRefund(policyA.id, daysAgo(5));
    await makeRefund(policyA.id, daysAgo(10));

    // a non-Compliance actor cannot monitor or detect
    await request(app.getHttpServer())
      .post('/transaction-monitoring-alerts/detect')
      .set(bearer(sales.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .get('/transaction-monitoring-alerts')
      .set(bearer(sales.accessToken))
      .expect(403);

    const swept = await request(app.getHttpServer())
      .post('/transaction-monitoring-alerts/detect')
      .set(bearer(compliance.accessToken))
      .expect(201);
    const result = swept.body as SweepResultBody;
    expect(result.created).toBeGreaterThanOrEqual(4); // 2 receipt-scoped + 2 aggregate
    expect(result.failed).toBe(0);

    const list = await request(app.getHttpServer())
      .get(`/transaction-monitoring-alerts?customerId=${customerA.id}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const alerts = list.body as AlertBody[];
    const patternTypes = alerts.map((a) => a.patternType).sort();
    expect(patternTypes).toEqual([
      'frequent_cancellations',
      'frequent_refunds',
      'large_premium_payment',
      'third_party_payment_source',
    ]);
    expect(alerts.every((a) => a.status === 'open')).toBe(true);

    const largeAlert = alerts.find(
      (a) => a.patternType === 'large_premium_payment',
    )!;
    expect(largeAlert.sourceEntityType).toBe('Receipt');
    expect(largeAlert.sourceEntityId).toBe(largeReceipt.id);
    const thirdPartyAlert = alerts.find(
      (a) => a.patternType === 'third_party_payment_source',
    )!;
    expect(thirdPartyAlert.sourceEntityId).toBe(thirdPartyReceipt.id);
    const aggregateAlerts = alerts.filter((a) =>
      ['frequent_cancellations', 'frequent_refunds'].includes(a.patternType),
    );
    expect(aggregateAlerts.every((a) => a.sourceEntityId === null)).toBe(true);

    // idempotent re-sweep: nothing new for the already-flagged rows
    const sweptAgain = await request(app.getHttpServer())
      .post('/transaction-monitoring-alerts/detect')
      .set(bearer(compliance.accessToken))
      .expect(201);
    expect((sweptAgain.body as SweepResultBody).created).toBe(0);
    const listAgain = await request(app.getHttpServer())
      .get(`/transaction-monitoring-alerts?customerId=${customerA.id}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect(listAgain.body as AlertBody[]).toHaveLength(alerts.length);

    // patternType / status filters actually filter
    const filtered = await request(app.getHttpServer())
      .get(
        `/transaction-monitoring-alerts?customerId=${customerA.id}&patternType=large_premium_payment`,
      )
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect(filtered.body as AlertBody[]).toHaveLength(1);

    // manual log: a full account number in detailText -> 400; 'other' -> 201
    await request(app.getHttpServer())
      .post('/transaction-monitoring-alerts')
      .set(bearer(compliance.accessToken))
      .send({
        customerId: customerA.id,
        patternType: 'other',
        detailText: 'wired from account 123456789012',
      })
      .expect(400);
    const manual = await request(app.getHttpServer())
      .post('/transaction-monitoring-alerts')
      .set(bearer(compliance.accessToken))
      .send({
        customerId: customerA.id,
        patternType: 'other',
        detailText: 'client asked to split payment to avoid reporting',
      })
      .expect(201);
    const manualAlert = manual.body as AlertBody;
    expect(manualAlert.status).toBe('open');

    // a SECOND independent manual 'other' alert for the same customer must
    // succeed (the manual escape hatch is for repeated, ongoing notes — the
    // BLOCKER this migration's partial index originally had: a
    // sourceEntityId-IS-NULL predicate would have collided these two).
    const secondManual = await request(app.getHttpServer())
      .post('/transaction-monitoring-alerts')
      .set(bearer(compliance.accessToken))
      .send({ customerId: customerA.id, patternType: 'other' })
      .expect(201);
    expect((secondManual.body as AlertBody).id).not.toBe(manualAlert.id);

    // a manual log of one of the two AGGREGATE patterns DOES collide with an
    // already-open sweep-created alert of the same pattern for this
    // customer — the partial index's actual, intended invariant.
    await request(app.getHttpServer())
      .post('/transaction-monitoring-alerts')
      .set(bearer(compliance.accessToken))
      .send({ customerId: customerA.id, patternType: 'frequent_cancellations' })
      .expect(409);

    // unknown patternType -> 400; unknown customer -> 404
    await request(app.getHttpServer())
      .post('/transaction-monitoring-alerts')
      .set(bearer(compliance.accessToken))
      .send({ customerId: customerA.id, patternType: 'structuring' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/transaction-monitoring-alerts')
      .set(bearer(compliance.accessToken))
      .send({
        customerId: '11111111-1111-4111-8111-111111111111',
        patternType: 'other',
      })
      .expect(404);

    // report-to-authority before escalate -> 422
    await request(app.getHttpServer())
      .post(
        `/transaction-monitoring-alerts/${manualAlert.id}/report-to-authority`,
      )
      .set(bearer(compliance.accessToken))
      .expect(422);

    // a non-Compliance actor cannot escalate
    await request(app.getHttpServer())
      .post(`/transaction-monitoring-alerts/${manualAlert.id}/escalate`)
      .set(bearer(sales.accessToken))
      .expect(403);

    const escalated = await request(app.getHttpServer())
      .post(`/transaction-monitoring-alerts/${manualAlert.id}/escalate`)
      .set(bearer(compliance.accessToken))
      .expect(201);
    expect((escalated.body as AlertBody).escalatedToSuspiciousActivity).toBe(
      true,
    );
    expect((escalated.body as AlertBody).escalatedAt).not.toBeNull();

    // idempotent re-escalate
    const escalatedAgain = await request(app.getHttpServer())
      .post(`/transaction-monitoring-alerts/${manualAlert.id}/escalate`)
      .set(bearer(compliance.accessToken))
      .expect(201);
    expect((escalatedAgain.body as AlertBody).escalatedAt).toBe(
      (escalated.body as AlertBody).escalatedAt,
    );

    const reported = await request(app.getHttpServer())
      .post(
        `/transaction-monitoring-alerts/${manualAlert.id}/report-to-authority`,
      )
      .set(bearer(compliance.accessToken))
      .expect(201);
    expect((reported.body as AlertBody).reportedToAuthorityAt).not.toBeNull();

    // idempotent re-report
    const reportedAgain = await request(app.getHttpServer())
      .post(
        `/transaction-monitoring-alerts/${manualAlert.id}/report-to-authority`,
      )
      .set(bearer(compliance.accessToken))
      .expect(201);
    expect((reportedAgain.body as AlertBody).reportedToAuthorityAt).toBe(
      (reported.body as AlertBody).reportedToAuthorityAt,
    );

    // close it; idempotent re-close; unknown id -> 404
    const closed = await request(app.getHttpServer())
      .post(`/transaction-monitoring-alerts/${manualAlert.id}/close`)
      .set(bearer(compliance.accessToken))
      .expect(201);
    expect((closed.body as AlertBody).status).toBe('closed');
    expect((closed.body as AlertBody).isClosed).toBe(true);
    await request(app.getHttpServer())
      .post(`/transaction-monitoring-alerts/${manualAlert.id}/close`)
      .set(bearer(compliance.accessToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(
        '/transaction-monitoring-alerts/11111111-1111-4111-8111-111111111111/close',
      )
      .set(bearer(compliance.accessToken))
      .expect(404);

    // re-escalating an already-escalated alert stays idempotent even after
    // it has since been closed (escalatedToSuspiciousActivity is checked
    // before the `status === 'open'` guard) — a MINOR fix: the first pass
    // 422'd here instead of returning the current view.
    const reEscalatedAfterClose = await request(app.getHttpServer())
      .post(`/transaction-monitoring-alerts/${manualAlert.id}/escalate`)
      .set(bearer(compliance.accessToken))
      .expect(201);
    expect((reEscalatedAfterClose.body as AlertBody).status).toBe('closed');

    await request(app.getHttpServer())
      .get(`/transaction-monitoring-alerts/${manualAlert.id}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    await request(app.getHttpServer())
      .get(
        '/transaction-monitoring-alerts/11111111-1111-4111-8111-111111111111',
      )
      .set(bearer(compliance.accessToken))
      .expect(404);

    // audit: a CREATE row per detected + manual alert (never carrying detailText), UPDATE rows for escalate/report/close, a READ row for the get()
    const allAlertIds = [
      ...alerts.map((a) => a.id),
      manualAlert.id,
      (secondManual.body as AlertBody).id,
    ];
    const audit = await prisma.auditLogEntry.findMany({
      where: {
        entityType: 'TransactionMonitoringAlert',
        entityId: { in: [...allAlertIds, 'list'] },
      },
    });
    const creates = audit.filter((a) => a.action === 'CREATE');
    expect(creates).toHaveLength(6); // 4 swept + 2 manual
    for (const entry of creates) {
      expect(entry.afterValue).not.toHaveProperty('detailText');
    }
    const updates = audit.filter(
      (a) => a.action === 'UPDATE' && a.entityId === manualAlert.id,
    );
    expect(updates.length).toBeGreaterThanOrEqual(3); // escalate, report, close
    const reads = audit.filter((a) => a.action === 'READ');
    expect(reads.some((r) => r.entityId === manualAlert.id)).toBe(true); // get()
    expect(reads.some((r) => r.entityId === 'list')).toBe(true); // list()
  });
});

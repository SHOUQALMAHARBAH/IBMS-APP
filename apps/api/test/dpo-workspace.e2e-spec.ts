import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';
import {
  CROSS_BORDER_RECENT_TAKE,
  DSR_QUEUE_TAKE,
  INCIDENT_REGISTER_TAKE,
} from '../src/modules/pdpl/dpo-workspace.service';

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
interface DsrQueueItemBody {
  id: string;
  status: string;
  daysUntilDue: number;
}
interface DpoWorkspaceSummaryBody {
  generatedAt: string;
  consentStatus: {
    activeCount: number;
    withdrawnCount: number;
    declinedCount: number;
  };
  dsrQueue: DsrQueueItemBody[];
  incidentRegister: { id: string; status: string }[];
  dpiaRegister: { id: string; outcome: string }[];
  legalHoldRegister: { id: string; releasedAt: string | null }[];
  crossBorderTransferRegister: { id: string }[];
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
    .send({ fullName: 'DPO Workspace E2E User', email, password: PASSWORD })
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

describe('DPO Workspace (e2e) — backlog Part D §5.1, Process #52 item #9', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates the summary behind the new dpo-workspace.view permission', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'workspace-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .get('/dpo-workspace/summary')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('surfaces a fresh open DSR, an active Legal Hold, and a fresh cross-border transfer as BEFORE/AFTER deltas (db-test is cumulative)', async () => {
    const app = await boot();
    const dpo = await makeUser(app, 'workspace-dpo', 'DATA_PROTECTION_OFFICER');

    const before = (
      await request(app.getHttpServer())
        .get('/dpo-workspace/summary')
        .set(bearer(dpo.accessToken))
        .expect(200)
    ).body as DpoWorkspaceSummaryBody;

    const customer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: `DPO Workspace E2E ${Math.random().toString(36).slice(2, 8)}`,
        ownerUserId: dpo.userId,
      },
    });

    const dsr = (
      await request(app.getHttpServer())
        .post('/dsr')
        .set(bearer(dpo.accessToken))
        .send({ type: 'ACCESS', customerId: customer.id })
        .expect(201)
    ).body as { id: string };

    const hold = (
      await request(app.getHttpServer())
        .post('/legal-holds')
        .set(bearer(dpo.accessToken))
        .send({
          scope: 'DPO Workspace e2e file',
          reason: 'Litigation pending.',
        })
        .expect(201)
    ).body as { id: string };

    const transfer = (
      await request(app.getHttpServer())
        .post('/cross-border-transfers')
        .set(bearer(dpo.accessToken))
        .send({
          description: 'DPO Workspace e2e transfer.',
          destinationCountry: 'Germany',
          legalBasis: 'explicit_consent',
        })
        .expect(201)
    ).body as { id: string };

    const after = (
      await request(app.getHttpServer())
        .get('/dpo-workspace/summary')
        .set(bearer(dpo.accessToken))
        .expect(200)
    ).body as DpoWorkspaceSummaryBody;

    // Not `toBe(before + 1)`: db-test is cumulative, and a count that assumes
    // an uncapped list stops being true the moment the list is capped.
    //
    // The cross-border formula DOES apply here, which it would not have before
    // the queue was fixed. `dsrQueue` is now the open requests themselves,
    // capped at DSR_QUEUE_TAKE — not the open subset of a capped scan of
    // everything — so it saturates at exactly the cap, and below it a new open
    // request always adds one.
    //
    // The remaining bound is the ordering: oldest first, so at saturation it is
    // the NEWEST open request that falls outside the cap, which is the
    // deliberate direction (a deadline queue must never lose its most overdue
    // entry, and something has to give). The id lookup below therefore assumes
    // fewer than DSR_QUEUE_TAKE open requests — 209 of them when this was
    // written. If that assumption ever breaks, the queue is 500 items deep and
    // the office has a far larger problem than a red test.
    expect(after.dsrQueue.length).toBeGreaterThanOrEqual(
      Math.min(before.dsrQueue.length + 1, DSR_QUEUE_TAKE),
    );
    expect(after.dsrQueue.find((d) => d.id === dsr.id)).toBeTruthy();
    expect(
      after.dsrQueue.find((d) => d.id === dsr.id)?.daysUntilDue,
    ).toBeGreaterThan(0);

    expect(after.legalHoldRegister.length).toBe(
      before.legalHoldRegister.length + 1,
    );
    expect(after.legalHoldRegister.find((h) => h.id === hold.id)).toBeTruthy();

    // The register returns only the CROSS_BORDER_RECENT_TAKE most recent rows,
    // and db-test is cumulative. Once the table holds that many, a bare
    // "grew by one" assertion can never hold again — it went permanently red
    // on 2026-09-13, at 51 rows against a cap of 50, having quietly been a
    // count over a capped list all along (`project_claim_closure_c29_status`:
    // never a global count in an e2e). Below the cap this still demands real
    // growth; at the cap it demands the register stays full. The assertion
    // that carries the actual meaning is the id lookup directly below, which
    // holds either way because the register is ordered most-recent-first.
    expect(after.crossBorderTransferRegister.length).toBeGreaterThanOrEqual(
      Math.min(
        before.crossBorderTransferRegister.length + 1,
        CROSS_BORDER_RECENT_TAKE,
      ),
    );
    expect(
      after.crossBorderTransferRegister.find((t) => t.id === transfer.id),
    ).toBeTruthy();
  });

  it('excludes a DPIA screening in the AUTO_APPROVED outcome, and includes one requiring DPO review', async () => {
    const app = await boot();
    const dpo = await makeUser(
      app,
      'workspace-dpo-dpia',
      'DATA_PROTECTION_OFFICER',
    );

    const autoApproved = (
      await request(app.getHttpServer())
        .post('/dpia-screenings')
        .set(bearer(dpo.accessToken))
        .send({
          subjectDescription: 'DPO Workspace e2e — no risk feature.',
          qSensitiveData: false,
          qLargeScaleProcessing: false,
          qCrossBorderTransfer: false,
          qNewTechnologyMonitoring: false,
          qNewDigitalChannel: false,
        })
        .expect(201)
    ).body as { id: string };

    const needsReview = (
      await request(app.getHttpServer())
        .post('/dpia-screenings')
        .set(bearer(dpo.accessToken))
        .send({
          subjectDescription: 'DPO Workspace e2e — sensitive-data feature.',
          qSensitiveData: true,
          qLargeScaleProcessing: false,
          qCrossBorderTransfer: false,
          qNewTechnologyMonitoring: false,
          qNewDigitalChannel: false,
        })
        .expect(201)
    ).body as { id: string };

    const summary = (
      await request(app.getHttpServer())
        .get('/dpo-workspace/summary')
        .set(bearer(dpo.accessToken))
        .expect(200)
    ).body as DpoWorkspaceSummaryBody;

    expect(
      summary.dpiaRegister.find((d) => d.id === needsReview.id),
    ).toBeTruthy();
    expect(
      summary.dpiaRegister.find((d) => d.id === autoApproved.id),
    ).toBeFalsy();
  });

  /**
   * The regression these three lock in, fixed 2026-09-13.
   *
   * Each of these lists used to be built by reading the N most recent rows and
   * then filtering in memory. That is fine until the table passes N, at which
   * point an item OLDER than the window stops appearing at all — and because
   * the window was ordered newest-first, the first thing to vanish from a
   * statutory-deadline queue was its oldest, most-overdue entry. Exactly
   * backwards. `ConsentRecord` had already crossed its 1,000 limit (1,132 rows)
   * and the DPO's consent figures were quietly describing a subset.
   *
   * Each test seeds past the relevant cap and asserts the old item is still
   * there. Every one of them fails against the previous implementation, which
   * is the only reason they are worth their runtime.
   */
  describe('a capped list never hides an old open item', () => {
    it('keeps an OLD open DSR in the queue behind a full window of newer ones', async () => {
      const app = await boot();
      const dpo = await makeUser(
        app,
        'workspace-dpo-dsrcap',
        'DATA_PROTECTION_OFFICER',
      );

      const ancient = new Date('2020-01-02T00:00:00.000Z');
      const oldOpen = await prisma.dataSubjectRequest.create({
        data: {
          type: 'ACCESS',
          status: 'IN_PROGRESS',
          receivedAt: ancient,
          createdAt: ancient,
          slaDueAt: new Date('2020-01-20T00:00:00.000Z'),
        },
      });

      // A full window of NEWER requests. All CLOSED, so they belong in nobody's
      // queue — under the old shape they filled the scan anyway and pushed the
      // open one above out of sight.
      const fillerIds = Array.from({ length: DSR_QUEUE_TAKE }, () =>
        randomUUID(),
      );
      await prisma.dataSubjectRequest.createMany({
        data: fillerIds.map((id) => ({
          id,
          type: 'ACCESS' as const,
          status: 'CLOSED' as const,
          slaDueAt: new Date(),
          closedAt: new Date(),
        })),
      });

      try {
        const summary = (
          await request(app.getHttpServer())
            .get('/dpo-workspace/summary')
            .set(bearer(dpo.accessToken))
            .expect(200)
        ).body as DpoWorkspaceSummaryBody;

        // Before the fix this was undefined: 500 newer rows occupied the whole
        // window, and the filter ran afterwards.
        expect(summary.dsrQueue.find((d) => d.id === oldOpen.id)).toBeTruthy();
        // And it leads the queue. Oldest-first is the half that makes the cap
        // safe: if the limit is ever reached it drops the least urgent tail,
        // never the most overdue head. 2020 predates every other row this
        // suite creates, so the head position is deterministic.
        expect(summary.dsrQueue[0]?.id).toBe(oldOpen.id);
      } finally {
        await prisma.dataSubjectRequest.deleteMany({
          where: { id: { in: [...fillerIds, oldOpen.id] } },
        });
      }
    });

    it('keeps an OLD unresolved incident in the register behind a full window of newer ones', async () => {
      const app = await boot();
      const dpo = await makeUser(
        app,
        'workspace-dpo-inccap',
        'DATA_PROTECTION_OFFICER',
      );

      const ancient = new Date('2020-01-02T00:00:00.000Z');
      const oldOpen = await prisma.incidentReport.create({
        data: {
          title: 'Ancient unresolved incident',
          description: 'Still open, and older than any window.',
          severity: 'high',
          status: 'REPORTED',
          reportedAt: ancient,
          createdAt: ancient,
        },
      });

      const fillerIds = Array.from({ length: INCIDENT_REGISTER_TAKE }, () =>
        randomUUID(),
      );
      await prisma.incidentReport.createMany({
        data: fillerIds.map((id, i) => ({
          id,
          title: `Closed filler ${i}`,
          description: 'Closed, and newer than the one under test.',
          severity: 'low',
          status: 'CLOSED' as const,
          closedAt: new Date(),
        })),
      });

      try {
        const summary = (
          await request(app.getHttpServer())
            .get('/dpo-workspace/summary')
            .set(bearer(dpo.accessToken))
            .expect(200)
        ).body as DpoWorkspaceSummaryBody;

        expect(
          summary.incidentRegister.find((i) => i.id === oldOpen.id),
        ).toBeTruthy();
        expect(summary.incidentRegister[0]?.id).toBe(oldOpen.id);
      } finally {
        await prisma.incidentReport.deleteMany({
          where: { id: { in: [...fillerIds, oldOpen.id] } },
        });
      }
    });

    it('counts EVERY consent record, not just a capped page of them', async () => {
      const app = await boot();
      const dpo = await makeUser(
        app,
        'workspace-dpo-consentcap',
        'DATA_PROTECTION_OFFICER',
      );

      // The figure used to be a tally of the 1,000 most recent rows. Top the
      // table up past that if some later reset has dropped it below, so the
      // assertion stays a real test rather than a tautology on a fresh
      // database; db-test was already at 1,132 when this was written, so this
      // is normally a no-op.
      const OLD_CONSENT_CAP = 1000;
      const seededIds: string[] = [];
      const existing = await prisma.consentRecord.count();
      if (existing <= OLD_CONSENT_CAP) {
        for (let i = 0; i < OLD_CONSENT_CAP + 1 - existing; i++) {
          seededIds.push(randomUUID());
        }
        await prisma.consentRecord.createMany({
          data: seededIds.map((id) => ({
            id,
            purpose: 'MARKETING' as const,
            consentTextVersion: 'cap-test-v1',
            granted: true,
            grantedAt: new Date(),
          })),
        });
      }

      try {
        const total = await prisma.consentRecord.count();
        expect(total).toBeGreaterThan(OLD_CONSENT_CAP);

        const summary = (
          await request(app.getHttpServer())
            .get('/dpo-workspace/summary')
            .set(bearer(dpo.accessToken))
            .expect(200)
        ).body as DpoWorkspaceSummaryBody;

        const { activeCount, withdrawnCount, declinedCount } =
          summary.consentStatus;
        // The three buckets partition the table, so they must add up to all of
        // it. Before the fix this summed to exactly OLD_CONSENT_CAP — the size
        // of the page, not the size of the truth.
        expect(activeCount + withdrawnCount + declinedCount).toBe(total);
      } finally {
        if (seededIds.length > 0) {
          await prisma.consentRecord.deleteMany({
            where: { id: { in: seededIds } },
          });
        }
      }
    });
  });
});

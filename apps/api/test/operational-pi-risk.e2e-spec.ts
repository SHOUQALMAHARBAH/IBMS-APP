import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

// `ProfessionalIndemnityPolicy` resolution ("current" = furthest-out
// expiresAt) is book-wide, with no per-test scoping possible (db-test is
// cumulative across runs — project memory) — a fixed date string would tie
// against a leftover row from a prior run, or against another row created
// later in THIS run, making "current" non-deterministic. Every call
// generates a strictly later, run-unique instant instead.
//
// The offset must stay FIXED (not grow with the counter) and the counter
// must only add MILLISECONDS, not days: a first attempt added a whole extra
// day per call (`(36525 + counter) days`), which broke the very
// cross-run monotonicity it was meant to guarantee — a LATER test file
// position in an EARLIER run (a higher counter value, so +1 extra day) can
// still exceed an EARLIER position in a LATER run (a lower counter value)
// when the wall-clock gap between the two runs is under a day, which it
// always is in practice. Real elapsed wall-clock time between any two runs
// (minutes at the very least) dwarfs a single-digit millisecond counter
// spread within one run, so basing monotonicity on `Date.now()` alone with
// the counter only as a same-run tiebreaker is what actually holds up
// across repeated runs.
let farFutureCounter = 0;
function nextFarFuture(): string {
  farFutureCounter += 1;
  return new Date(
    Date.now() + 400_000 * 24 * 60 * 60 * 1000 + farFutureCounter,
  ).toISOString();
}

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
interface RiskRegisterItemBody {
  id: string;
  riskType: string;
  description: string;
  mitigationAction: string | null;
  status: string;
  loggedAt: string;
  closedAt: string | null;
}
interface PiPolicyBody {
  id: string;
  insurerName: string;
  coverageLimit: string;
  expiresAt: string;
  claimsHistorySummary: string | null;
  isCurrentlyLapsed: boolean;
  isCurrent: boolean;
}
interface PiRiskEventBody {
  id: string;
  piPolicyId: string | null;
  sourcePolicyCheckingId: string | null;
  description: string;
  mitigationAction: string | null;
  loggedAt: string;
  isAutoLogged: boolean;
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
    .send({
      fullName: 'Operational/PI Risk E2E User',
      email,
      password: PASSWORD,
    })
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

describe('Operational & Professional Indemnity Risk (e2e) — backlog Part C #53-54', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('logs, updates, closes, and lists/filters generic risk register items', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'risk-compliance',
      'COMPLIANCE_OFFICER',
    );
    const manager = await makeUser(
      app,
      'risk-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const other = await makeUser(
      app,
      'risk-other',
      'SALES_RELATIONSHIP_OFFICER',
    );

    // non-Compliance/Manager is forbidden on every route
    await request(app.getHttpServer())
      .post('/risk-register')
      .set(bearer(other.accessToken))
      .send({ riskType: 'cyber', description: 'x' })
      .expect(403);
    await request(app.getHttpServer())
      .get('/risk-register')
      .set(bearer(other.accessToken))
      .expect(403);

    // an invalid riskType (Professional Indemnity is deliberately excluded
    // — it has its own deeper model) is rejected
    await request(app.getHttpServer())
      .post('/risk-register')
      .set(bearer(compliance.accessToken))
      .send({ riskType: 'professional_indemnity', description: 'x' })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/risk-register')
      .set(bearer(compliance.accessToken))
      .send({
        riskType: 'cyber',
        description: 'A phishing email reached three staff mailboxes.',
      })
      .expect(201);
    const item = created.body as RiskRegisterItemBody;
    expect(item.status).toBe('open');
    expect(item.mitigationAction).toBeNull();

    // a Manager (the second seeded role) can also record a mitigation plan
    const mitigated = await request(app.getHttpServer())
      .post(`/risk-register/${item.id}/mitigation`)
      .set(bearer(manager.accessToken))
      .send({ mitigationAction: 'Mandatory phishing-awareness refresher.' })
      .expect(201);
    expect((mitigated.body as RiskRegisterItemBody).mitigationAction).toBe(
      'Mandatory phishing-awareness refresher.',
    );

    const closed = await request(app.getHttpServer())
      .post(`/risk-register/${item.id}/close`)
      .set(bearer(compliance.accessToken))
      .expect(201);
    const closedBody = closed.body as RiskRegisterItemBody;
    expect(closedBody.status).toBe('closed');
    expect(closedBody.closedAt).not.toBeNull();

    // a mitigation update is no longer legal once closed
    await request(app.getHttpServer())
      .post(`/risk-register/${item.id}/mitigation`)
      .set(bearer(compliance.accessToken))
      .send({ mitigationAction: 'too late' })
      .expect(409);

    // idempotent re-close
    await request(app.getHttpServer())
      .post(`/risk-register/${item.id}/close`)
      .set(bearer(compliance.accessToken))
      .expect(201);

    // a second, still-open item of a different type, for the filter checks
    const secondCreated = await request(app.getHttpServer())
      .post('/risk-register')
      .set(bearer(compliance.accessToken))
      .send({
        riskType: 'financial',
        description: 'A material customer receivable is 120 days overdue.',
      })
      .expect(201);
    const secondItem = secondCreated.body as RiskRegisterItemBody;

    // list filters — scoped by this test's own ids (db-test is cumulative)
    const byType = await request(app.getHttpServer())
      .get('/risk-register?riskType=cyber')
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((byType.body as RiskRegisterItemBody[]).map((b) => b.id)).toContain(
      item.id,
    );
    expect(
      (byType.body as RiskRegisterItemBody[]).map((b) => b.id),
    ).not.toContain(secondItem.id);

    const openOnly = await request(app.getHttpServer())
      .get('/risk-register?status=open')
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect(
      (openOnly.body as RiskRegisterItemBody[]).map((b) => b.id),
    ).toContain(secondItem.id);
    expect(
      (openOnly.body as RiskRegisterItemBody[]).map((b) => b.id),
    ).not.toContain(item.id);

    await request(app.getHttpServer())
      .get('/risk-register/00000000-0000-0000-0000-000000000000')
      .set(bearer(compliance.accessToken))
      .expect(404);
  });

  it('logs a PI policy, updates its claims history, and surfaces current/list views', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'pi-pol-compliance',
      'COMPLIANCE_OFFICER',
    );
    const other = await makeUser(
      app,
      'pi-pol-other',
      'SALES_RELATIONSHIP_OFFICER',
    );

    await request(app.getHttpServer())
      .post('/pi-policy')
      .set(bearer(other.accessToken))
      .send({
        insurerName: 'x',
        coverageLimit: '1000000.000',
        expiresAt: nextFarFuture(),
      })
      .expect(403);

    // an older, already-expired record
    const older = await request(app.getHttpServer())
      .post('/pi-policy')
      .set(bearer(compliance.accessToken))
      .send({
        insurerName: 'Jordan Insurance Co.',
        coverageLimit: '750000.000',
        expiresAt: '2020-01-01',
      })
      .expect(201);
    const olderBody = older.body as PiPolicyBody;
    expect(olderBody.isCurrentlyLapsed).toBe(true);

    // the newer renewal — a NEW row, not an overwrite of the older one
    const current = await request(app.getHttpServer())
      .post('/pi-policy')
      .set(bearer(compliance.accessToken))
      .send({
        insurerName: 'Jordan Insurance Co.',
        coverageLimit: '1000000.000',
        expiresAt: nextFarFuture(),
        claimsHistorySummary: 'No claims to date.',
      })
      .expect(201);
    const currentBody = current.body as PiPolicyBody;
    expect(currentBody.isCurrentlyLapsed).toBe(false);
    expect(currentBody.isCurrent).toBe(true);

    // /current resolves to the furthest-out expiresAt
    const got = await request(app.getHttpServer())
      .get('/pi-policy/current')
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((got.body as PiPolicyBody).id).toBe(currentBody.id);

    // the older record no longer reads as current
    const olderRead = await request(app.getHttpServer())
      .get(`/pi-policy/${olderBody.id}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((olderRead.body as PiPolicyBody).isCurrent).toBe(false);

    // list surfaces both, with exactly one flagged current
    const list = await request(app.getHttpServer())
      .get('/pi-policy')
      .set(bearer(compliance.accessToken))
      .expect(200);
    const listBody = list.body as PiPolicyBody[];
    expect(listBody.filter((p) => p.isCurrent)).toHaveLength(1);
    expect(listBody.find((p) => p.isCurrent)?.id).toBe(currentBody.id);

    // claims history can be updated on ANY record, not just the current one
    const historyUpdated = await request(app.getHttpServer())
      .post(`/pi-policy/${olderBody.id}/claims-history`)
      .set(bearer(compliance.accessToken))
      .send({
        claimsHistorySummary: 'One late-reported claim from this period.',
      })
      .expect(201);
    expect((historyUpdated.body as PiPolicyBody).claimsHistorySummary).toBe(
      'One late-reported claim from this period.',
    );

    await request(app.getHttpServer())
      .get('/pi-policy/00000000-0000-0000-0000-000000000000')
      .set(bearer(compliance.accessToken))
      .expect(404);
  });

  it('resolves "current" deterministically even when two records tie on expiresAt (review-fix regression)', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'pi-pol-tie-compliance',
      'COMPLIANCE_OFFICER',
    );

    // two records sharing the EXACT same expiresAt — a real BLOCKER on the
    // first pass: `findFirst({ orderBy: { expiresAt: 'desc' } })` alone has
    // no secondary sort key, so a tie is DB-implementation-defined, not
    // just theoretically possible (two officers entering the same
    // calendar-year renewal date, a multi-insurer PI tower, or an
    // accidental duplicate all tie to the millisecond via
    // `parseCalendarDate`'s plain-date normalization).
    const tiedExpiresAt = nextFarFuture();
    const first = await request(app.getHttpServer())
      .post('/pi-policy')
      .set(bearer(compliance.accessToken))
      .send({
        insurerName: 'Tie Insurer A',
        coverageLimit: '1000000.000',
        expiresAt: tiedExpiresAt,
      })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/pi-policy')
      .set(bearer(compliance.accessToken))
      .send({
        insurerName: 'Tie Insurer B',
        coverageLimit: '1000000.000',
        expiresAt: tiedExpiresAt,
      })
      .expect(201);
    expect((first.body as PiPolicyBody).expiresAt).toBe(
      (second.body as PiPolicyBody).expiresAt,
    );

    // repeated reads must all agree on the SAME winner — never flip between
    // calls, and never return one answer from /current and a different one
    // from list()'s isCurrent flag
    const reads = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .get('/pi-policy/current')
          .set(bearer(compliance.accessToken))
          .expect(200),
      ),
    );
    const winnerIds = new Set(reads.map((r) => (r.body as PiPolicyBody).id));
    expect(winnerIds.size).toBe(1);

    const list = await request(app.getHttpServer())
      .get('/pi-policy')
      .set(bearer(compliance.accessToken))
      .expect(200);
    const currentInList = (list.body as PiPolicyBody[]).find(
      (p) => p.isCurrent,
    );
    expect(currentInList?.id).toBe([...winnerIds][0]);
  });

  it('manually logs a PI risk event (explicit and auto-resolved policy), records mitigation, and lists/filters', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'pi-evt-compliance',
      'COMPLIANCE_OFFICER',
    );
    const other = await makeUser(
      app,
      'pi-evt-other',
      'SALES_RELATIONSHIP_OFFICER',
    );

    await request(app.getHttpServer())
      .post('/pi-risk-events')
      .set(bearer(other.accessToken))
      .send({ description: 'x' })
      .expect(403);

    // a PI policy to link against explicitly
    const policy = await request(app.getHttpServer())
      .post('/pi-policy')
      .set(bearer(compliance.accessToken))
      .send({
        insurerName: 'Amman Assurance',
        coverageLimit: '2000000.000',
        expiresAt: nextFarFuture(),
      })
      .expect(201);
    const policyId = (policy.body as PiPolicyBody).id;

    // unknown explicit piPolicyId -> 404
    await request(app.getHttpServer())
      .post('/pi-risk-events')
      .set(bearer(compliance.accessToken))
      .send({
        description: 'x',
        piPolicyId: '00000000-0000-0000-0000-000000000000',
      })
      .expect(404);

    const explicit = await request(app.getHttpServer())
      .post('/pi-risk-events')
      .set(bearer(compliance.accessToken))
      .send({
        description: 'Placement officer quoted the wrong indemnity period.',
        piPolicyId: policyId,
      })
      .expect(201);
    const explicitBody = explicit.body as PiRiskEventBody;
    expect(explicitBody.piPolicyId).toBe(policyId);
    expect(explicitBody.sourcePolicyCheckingId).toBeNull();
    expect(explicitBody.isAutoLogged).toBe(false);

    // omitting piPolicyId auto-resolves to the current PI policy — since
    // this test just created one above and PI policy resolution is
    // book-wide (no per-test scoping), the current record IS this test's
    // own `policyId` at this point in the run.
    const autoResolved = await request(app.getHttpServer())
      .post('/pi-risk-events')
      .set(bearer(compliance.accessToken))
      .send({ description: 'A second, unrelated exposure noticed later.' })
      .expect(201);
    expect((autoResolved.body as PiRiskEventBody).piPolicyId).toBe(policyId);

    const mitigated = await request(app.getHttpServer())
      .post(`/pi-risk-events/${explicitBody.id}/mitigation`)
      .set(bearer(compliance.accessToken))
      .send({
        mitigationAction: 'Re-issued the schedule with the correct period.',
      })
      .expect(201);
    expect((mitigated.body as PiRiskEventBody).mitigationAction).toBe(
      'Re-issued the schedule with the correct period.',
    );

    // list filtered by this test's own piPolicyId (db-test is cumulative)
    const byPolicy = await request(app.getHttpServer())
      .get(`/pi-risk-events?piPolicyId=${policyId}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const byPolicyIds = (byPolicy.body as PiRiskEventBody[]).map((b) => b.id);
    expect(byPolicyIds).toContain(explicitBody.id);

    await request(app.getHttpServer())
      .get(`/pi-risk-events/${explicitBody.id}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    await request(app.getHttpServer())
      .get('/pi-risk-events/00000000-0000-0000-0000-000000000000')
      .set(bearer(compliance.accessToken))
      .expect(404);
  });
});

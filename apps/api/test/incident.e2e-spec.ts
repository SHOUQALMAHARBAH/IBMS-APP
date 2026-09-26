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
interface IncidentBody {
  id: string;
  title: string;
  severity: string;
  status: string;
  classification: string;
  classifiedByDpoUserId: string | null;
  seniorManagementCoSignUserId: string | null;
  seniorManagementNotifiedAt: string | null;
  notifiedRegulators: string[];
  notifiedAt: string | null;
  affectedDataSubjectsNotifiedAt: string | null;
  rootCauseAnalysis: string | null;
  isContainmentOverdue: boolean;
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
    .send({ fullName: 'Incident E2E User', email, password: PASSWORD })
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

/** Same onboarding, but granting a role by ID rather than by seeded name — the
 *  one test below builds a CUSTOM role, which `ensureRole` would upsert by name
 *  without its permissions. */
async function makeUserWithRoleId(
  app: INestApplication<App>,
  label: string,
  roleId: string,
): Promise<{ accessToken: string; userId: string }> {
  const created = await makeUser(app, label);
  await prisma.userRoleAssignment.create({
    data: { userId: created.userId, roleId },
  });
  return created;
}

describe('Incident Management (e2e) — backlog Part C #55', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('walks a CRITICAL incident through MATERIAL classification, co-sign, senior-management notification, and multi-regulator notification', async () => {
    const app = await boot();
    const reporter = await makeUser(
      app,
      'inc-reporter',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const responder = await makeUser(
      app,
      'inc-responder',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const dpo = await makeUser(app, 'inc-dpo', 'DATA_PROTECTION_OFFICER');
    const exec = await makeUser(app, 'inc-exec', 'EXECUTIVE_MANAGEMENT');

    // any reporting role may create
    const created = await request(app.getHttpServer())
      .post('/incidents')
      .set(bearer(reporter.accessToken))
      .send({
        title: 'Ransomware on a claims workstation',
        description: 'A claims officer opened a malicious attachment.',
        severity: 'critical',
      })
      .expect(201);
    const incident = created.body as IncidentBody;
    expect(incident.status).toBe('REPORTED');

    // the 4-hour containment SLA timer exists for critical severity
    const containmentTimers = await prisma.slaTimer.findMany({
      where: {
        entityType: 'IncidentReport',
        entityId: incident.id,
        workflowName: 'incident_containment',
      },
    });
    expect(containmentTimers).toHaveLength(1);
    expect(containmentTimers[0]?.resolvedAt).toBeNull();

    // a non-incident.contain role cannot contain
    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/contain`)
      .set(bearer(reporter.accessToken))
      .expect(403);

    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/contain`)
      .set(bearer(responder.accessToken))
      .expect(201);

    // containment timer resolved by the transition's side effect
    const containmentAfter = await prisma.slaTimer.findMany({
      where: {
        entityType: 'IncidentReport',
        entityId: incident.id,
        workflowName: 'incident_containment',
      },
    });
    // IMPROVEMENTS § 1.8 — the weak-assertion sweep. This was
    // `expect(containmentAfter[0]?.resolvedAt).not.toBeNull()`, which PASSES on an empty array:
    // `?.` yields `undefined` and `undefined` is not null. Proven vacuous by pointing the query at a
    // workflow name that does not exist — the file still passed 4/4 — so the assertion held equally
    // well if the timer were never created, never resolved, or deleted outright.
    //
    // The length check is the fix: exactly one containment timer is what this test causes.
    expect(containmentAfter).toHaveLength(1);
    expect(containmentAfter[0].resolvedAt).not.toBeNull();

    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/assess-impact`)
      .set(bearer(responder.accessToken))
      .expect(201);

    // Executive Management cannot classify. Since Phase 2 that is a PERMISSION:
    // `incident.classify` is the DPO's, `incident.classification.co-sign` is
    // Executive Management's. It used to be one code for both routes with the
    // service refusing by role NAME, which no custom role could satisfy.
    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/classify`)
      .set(bearer(exec.accessToken))
      .send({ classification: 'MATERIAL' })
      .expect(403);

    const classified = await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/classify`)
      .set(bearer(dpo.accessToken))
      .send({ classification: 'MATERIAL' })
      .expect(201);
    const classifiedBody = classified.body as IncidentBody;
    expect(classifiedBody.classification).toBe('MATERIAL');
    expect(classifiedBody.classifiedByDpoUserId).toBe(dpo.userId);

    // classifying MATERIAL starts the 1-hour senior-management SLA timer
    const seniorMgmtTimers = await prisma.slaTimer.findMany({
      where: {
        entityType: 'IncidentReport',
        entityId: incident.id,
        workflowName: 'incident_senior_management_notification',
      },
    });
    expect(seniorMgmtTimers).toHaveLength(1);

    // regulator notification AND affected-subject notification are both
    // blocked until the co-sign is recorded — the same gate protects both
    // (a review-fix regression: the two were not originally symmetric)
    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/notify-regulators`)
      .set(bearer(dpo.accessToken))
      .send({ regulators: ['CBJ'] })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/notify-affected-subjects`)
      .set(bearer(dpo.accessToken))
      .expect(422);

    // The DPO who classified cannot also co-sign. Two independent reasons now,
    // and the 403 here is the first: they do not hold
    // `incident.classification.co-sign`. The second — same actor — is what still
    // holds for someone who DOES hold both codes, proved in its own test below.
    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/co-sign`)
      .set(bearer(dpo.accessToken))
      .expect(403);

    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/co-sign`)
      .set(bearer(exec.accessToken))
      .expect(201);

    // idempotent re-co-sign
    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/co-sign`)
      .set(bearer(exec.accessToken))
      .expect(201);

    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/notify-senior-management`)
      .set(bearer(dpo.accessToken))
      .expect(201);

    const seniorMgmtAfter = await prisma.slaTimer.findMany({
      where: {
        entityType: 'IncidentReport',
        entityId: incident.id,
        workflowName: 'incident_senior_management_notification',
      },
    });
    // Same shape as the containment assertion above, and vacuous for the same reason.
    expect(seniorMgmtAfter).toHaveLength(1);
    expect(seniorMgmtAfter[0].resolvedAt).not.toBeNull();

    // one incident, two regulators — the backlog's own third checkbox
    const notified = await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/notify-regulators`)
      .set(bearer(dpo.accessToken))
      .send({ regulators: ['CBJ', 'NCSC'] })
      .expect(201);
    const notifiedBody = notified.body as IncidentBody;
    expect(notifiedBody.status).toBe('NOTIFIED');
    expect(notifiedBody.notifiedRegulators.sort()).toEqual(['CBJ', 'NCSC']);

    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/notify-affected-subjects`)
      .set(bearer(dpo.accessToken))
      .expect(201);

    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/recover`)
      .set(bearer(responder.accessToken))
      .expect(201);

    // root cause is mandatory — an empty body 400s
    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/close`)
      .set(bearer(responder.accessToken))
      .send({})
      .expect(400);

    const closed = await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/close`)
      .set(bearer(responder.accessToken))
      .send({
        rootCauseAnalysis: 'Email filter did not flag a spoofed sender domain.',
      })
      .expect(201);
    expect((closed.body as IncidentBody).status).toBe('CLOSED');

    // idempotent re-close with the same root cause
    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/close`)
      .set(bearer(responder.accessToken))
      .send({
        rootCauseAnalysis: 'Email filter did not flag a spoofed sender domain.',
      })
      .expect(201);

    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: 'IncidentReport', entityId: incident.id },
    });
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('CREATE');
    expect(actions).toContain('UPDATE');
  });

  it('a caller holding BOTH halves still cannot co-sign its own classification', async () => {
    // Phase 2 workstream G, the part that matters.
    //
    // Splitting `incident.classify` in two makes the classify/co-sign pair
    // separately grantable — and an office CAN put both codes on one role. That
    // is deliberate: a small office may want it, and Phase 3's matrix warns
    // rather than refuses.
    //
    // What must NOT depend on how the roles were arranged is that nobody
    // co-signs their own work. `assertDifferentActors` is that control, and this
    // test is the proof it survives the split: one person, both permissions, and
    // the co-sign of their own classification is still refused.
    const app = await boot();
    const bothName = `Incident Both Halves ${Date.now()}`;
    const both = await prisma.role.create({
      data: {
        name: bothName,
        nameEn: bothName,
        nameAr: bothName,
        requiresMfaAlways: false,
        requiresHardwareToken: false,
      },
    });
    const codes = [
      'incident.report',
      'incident.contain',
      'incident.classify',
      'incident.classification.co-sign',
    ];
    const permissions = await prisma.permission.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    expect(permissions.map((r) => r.code).sort()).toEqual([...codes].sort());
    await prisma.rolePermission.createMany({
      data: permissions.map((perm) => ({
        roleId: both.id,
        permissionId: perm.id,
      })),
    });

    try {
      const dualHatted = await makeUserWithRoleId(
        app,
        'incident-both',
        both.id,
      );

      const reported = await request(app.getHttpServer())
        .post('/incidents')
        .set(bearer(dualHatted.accessToken))
        .send({
          title: 'Dual-hatted classification',
          description: 'One person holding both halves of the pair.',
          severity: 'critical',
        })
        .expect(201);
      const incidentId = (reported.body as IncidentBody).id;

      await request(app.getHttpServer())
        .post(`/incidents/${incidentId}/contain`)
        .set(bearer(dualHatted.accessToken))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/incidents/${incidentId}/assess-impact`)
        .set(bearer(dualHatted.accessToken))
        .expect(201);

      // Both halves are reachable for this caller — no 403 on either route.
      await request(app.getHttpServer())
        .post(`/incidents/${incidentId}/classify`)
        .set(bearer(dualHatted.accessToken))
        .send({ classification: 'MATERIAL' })
        .expect(201);

      // And yet the co-sign is refused, because it would be the same human on
      // both sides of a control that exists to have two.
      await request(app.getHttpServer())
        .post(`/incidents/${incidentId}/co-sign`)
        .set(bearer(dualHatted.accessToken))
        .expect(403);

      const stored = await prisma.incidentReport.findUniqueOrThrow({
        where: { id: incidentId },
        select: {
          classifiedByDpoUserId: true,
          seniorManagementCoSignUserId: true,
        },
      });
      expect(stored.classifiedByDpoUserId).toBe(dualHatted.userId);
      expect(
        stored.seniorManagementCoSignUserId,
        'no co-sign may have been recorded',
      ).toBeNull();
    } finally {
      // db-test is cumulative.
      await prisma.userRoleAssignment.deleteMany({
        where: { roleId: both.id },
      });
      await prisma.rolePermission.deleteMany({ where: { roleId: both.id } });
      await prisma.role.deleteMany({ where: { id: both.id } });
    }
  }, 300_000);

  it('a NON_MATERIAL classification skips the co-sign gate and blocks co-sign entirely', async () => {
    const app = await boot();
    const reporter = await makeUser(
      app,
      'inc-nonmat-reporter',
      'CLAIMS_OFFICER',
    );
    const responder = await makeUser(
      app,
      'inc-nonmat-responder',
      'COMPLIANCE_OFFICER',
    );
    const dpo = await makeUser(
      app,
      'inc-nonmat-dpo',
      'DATA_PROTECTION_OFFICER',
    );
    // Needed since the classify/co-sign split: only a holder of
    // `incident.classification.co-sign` gets far enough to be refused by the
    // Non-Material business rule rather than by the permission gate.
    const exec = await makeUser(app, 'inc-nonmat-exec', 'EXECUTIVE_MANAGEMENT');

    const created = await request(app.getHttpServer())
      .post('/incidents')
      .set(bearer(reporter.accessToken))
      .send({
        title: 'A misdirected internal email',
        description:
          'One internal report was sent to the wrong distribution list.',
        severity: 'low',
      })
      .expect(201);
    const incident = created.body as IncidentBody;

    // low severity never gets a containment SLA timer
    const timers = await prisma.slaTimer.findMany({
      where: { entityType: 'IncidentReport', entityId: incident.id },
    });
    expect(timers).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/contain`)
      .set(bearer(responder.accessToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/assess-impact`)
      .set(bearer(responder.accessToken))
      .expect(201);

    const classified = await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/classify`)
      .set(bearer(dpo.accessToken))
      .send({ classification: 'NON_MATERIAL' })
      .expect(201);
    expect((classified.body as IncidentBody).classification).toBe(
      'NON_MATERIAL',
    );

    // no senior-management SLA timer for a Non-Material incident
    const seniorMgmtTimers = await prisma.slaTimer.findMany({
      where: {
        entityType: 'IncidentReport',
        entityId: incident.id,
        workflowName: 'incident_senior_management_notification',
      },
    });
    expect(seniorMgmtTimers).toHaveLength(0);

    // Co-sign is refused outright for a Non-Material incident. Asked as the
    // EXECUTIVE, not the DPO: since Phase 2 the two halves are separate
    // permissions, so the DPO is now stopped at the guard with a 403 and never
    // reaches the business rule this line is about. Authorization first, then
    // the rule — which is the right order, and means the rule has to be probed
    // by someone authorized to invoke it.
    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/co-sign`)
      .set(bearer(exec.accessToken))
      .expect(422);

    // And the DPO, who does not hold `incident.classification.co-sign`, is
    // refused by the gate regardless of the incident's classification.
    await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/co-sign`)
      .set(bearer(dpo.accessToken))
      .expect(403);

    // regulator notification proceeds with no co-sign required
    const notified = await request(app.getHttpServer())
      .post(`/incidents/${incident.id}/notify-regulators`)
      .set(bearer(dpo.accessToken))
      .send({ regulators: ['Personal_Data_Protection_Council'] })
      .expect(201);
    expect((notified.body as IncidentBody).status).toBe('NOTIFIED');
  });

  it('gates reads/list behind incident.report and filters by status/severity', async () => {
    const app = await boot();
    const reporter = await makeUser(
      app,
      'inc-list-reporter',
      'FINANCE_COLLECTIONS_OFFICER',
    );
    const outsider = await makeUser(
      app,
      'inc-list-outsider',
      'POLICY_CHECKING_OFFICER',
    );
    // POLICY_CHECKING_OFFICER holds none of the four incident permissions
    await request(app.getHttpServer())
      .get('/incidents')
      .set(bearer(outsider.accessToken))
      .expect(403);

    const created = await request(app.getHttpServer())
      .post('/incidents')
      .set(bearer(reporter.accessToken))
      .send({
        title: 'A lost company laptop',
        description: 'An unencrypted laptop was left on a train.',
        severity: 'high',
      })
      .expect(201);
    const incident = created.body as IncidentBody;

    const got = await request(app.getHttpServer())
      .get(`/incidents/${incident.id}`)
      .set(bearer(reporter.accessToken))
      .expect(200);
    expect((got.body as IncidentBody).id).toBe(incident.id);

    await request(app.getHttpServer())
      .get('/incidents/00000000-0000-0000-0000-000000000000')
      .set(bearer(reporter.accessToken))
      .expect(404);

    const bySeverity = await request(app.getHttpServer())
      .get('/incidents?severity=high&status=REPORTED')
      .set(bearer(reporter.accessToken))
      .expect(200);
    expect((bySeverity.body as IncidentBody[]).map((b) => b.id)).toContain(
      incident.id,
    );

    const byWrongSeverity = await request(app.getHttpServer())
      .get('/incidents?severity=low&status=REPORTED')
      .set(bearer(reporter.accessToken))
      .expect(200);
    expect(
      (byWrongSeverity.body as IncidentBody[]).map((b) => b.id),
    ).not.toContain(incident.id);
  });
});

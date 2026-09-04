import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const DAY = 24 * 60 * 60 * 1000;

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

interface SlaTimerRow {
  id: string;
  entityType: string;
  entityId: string;
  workflowName: string;
  baseWorkflowName: string;
  label: string;
  drafted: boolean;
  state: string;
  dueAt: string;
  resolvedAt: string | null;
  overdueDays: number | null;
  ageDays: number;
}
interface SlaWorkflowRow {
  workflowName: string;
  label: string;
  entityType: string;
  drafted: boolean;
  configuredDuration: { value: number; unit: string } | null;
  total: number;
  onTrack: number;
  dueSoon: number;
  breached: number;
  escalated: number;
  resolvedOnTime: number;
  resolvedLate: number;
  openBreached: number;
  entityCount: number;
  oldestOverdueDays: number | null;
}
interface SlaDashboardSummary {
  generatedAt: string;
  dueSoonWindow: { value: number; unit: string };
  totals: { total: number; openBreached: number; breachRate: string };
  byWorkflow: SlaWorkflowRow[];
  byEntityType: Array<{
    entityType: string;
    total: number;
    entityCount: number;
  }>;
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
    .send({ fullName: 'SLA Dash E2E User', email, password: PASSWORD })
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

describe('SLA Management dashboard (e2e) — backlog Part C #43', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('aggregates SlaTimer rows across states, gates on sla-dashboard.view, and filters the drill-down list', async () => {
    const app = await boot();
    const compliance = await makeUser(app, 'sd-comp', 'COMPLIANCE_OFFICER');
    const sales = await makeUser(app, 'sd-sales', 'SALES_RELATIONSHIP_OFFICER');

    // A tag unique to this run so the book-wide reads can be scoped back to
    // exactly the rows this test seeded. An unregistered workflow name also
    // exercises the registry fallback (label = raw name, no configuredDuration).
    const tag = Math.random().toString(36).slice(2, 10);
    const ENTITY_TYPE = `SlaDashE2E_${tag}`;
    const WORKFLOW = `e2e_sla_dash_${tag}`;
    const now = Date.now();

    const seed = [
      { entityId: 'e-on', dueAt: now + 30 * DAY }, // on_track
      { entityId: 'e-soon', dueAt: now + 1 * DAY }, // due_soon
      { entityId: 'e-br', dueAt: now - 2 * DAY }, // breached
      {
        entityId: 'e-esc',
        dueAt: now - 10 * DAY,
        escalatedAt: now - 3 * DAY,
      }, // escalated
      {
        entityId: 'e-ot',
        dueAt: now - 5 * DAY,
        resolvedAt: now - 6 * DAY,
      }, // resolved_on_time
      {
        entityId: 'e-lt',
        dueAt: now - 5 * DAY,
        resolvedAt: now - 3 * DAY,
      }, // resolved_late (2 days late)
    ];
    for (const s of seed) {
      await prisma.slaTimer.create({
        data: {
          entityType: ENTITY_TYPE,
          entityId: s.entityId,
          workflowName: WORKFLOW,
          dueAt: new Date(s.dueAt),
          escalatedAt: s.escalatedAt ? new Date(s.escalatedAt) : null,
          escalatedTo: 'BRANCH_DEPARTMENT_MANAGER',
          resolvedAt: s.resolvedAt ? new Date(s.resolvedAt) : null,
        },
      });
    }

    // a role without sla-dashboard.view is refused both endpoints
    await request(app.getHttpServer())
      .get('/sla-dashboard/summary')
      .set(bearer(sales.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .get('/sla-dashboard/timers')
      .set(bearer(sales.accessToken))
      .expect(403);

    // summary — find this run's workflow row and assert the per-state tally
    const summaryRes = await request(app.getHttpServer())
      .get('/sla-dashboard/summary')
      .set(bearer(compliance.accessToken))
      .expect(200);
    const summary = summaryRes.body as SlaDashboardSummary;
    expect(summary.dueSoonWindow).toEqual({ value: 3, unit: 'calendarDays' });

    const wf = summary.byWorkflow.find((w) => w.workflowName === WORKFLOW);
    expect(wf).toBeDefined();
    expect(wf).toMatchObject({
      label: WORKFLOW, // registry fallback — raw name
      drafted: false,
      configuredDuration: null,
      total: 6,
      onTrack: 1,
      dueSoon: 1,
      breached: 1,
      escalated: 1,
      resolvedOnTime: 1,
      resolvedLate: 1,
      openBreached: 2,
      entityCount: 6,
    });
    expect(wf?.oldestOverdueDays).toBeGreaterThanOrEqual(9); // the escalated row

    const et = summary.byEntityType.find((e) => e.entityType === ENTITY_TYPE);
    expect(et).toMatchObject({ total: 6, entityCount: 6 });

    // drill-down: default (no ?state=) is the "open" group, worst-first
    const openRes = await request(app.getHttpServer())
      .get(`/sla-dashboard/timers?entityType=${ENTITY_TYPE}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const openRows = openRes.body as SlaTimerRow[];
    expect(openRows.map((r) => r.entityId)).toEqual([
      'e-esc',
      'e-br',
      'e-soon',
      'e-on',
    ]);
    expect(openRows.every((r) => r.workflowName === WORKFLOW)).toBe(true);

    // open_breached group → escalated + breached only
    const obRes = await request(app.getHttpServer())
      .get(
        `/sla-dashboard/timers?entityType=${ENTITY_TYPE}&state=open_breached`,
      )
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((obRes.body as SlaTimerRow[]).map((r) => r.entityId)).toEqual([
      'e-esc',
      'e-br',
    ]);

    // resolved_late leaf → the one late close, with its lateness in days
    const ltRes = await request(app.getHttpServer())
      .get(
        `/sla-dashboard/timers?entityType=${ENTITY_TYPE}&state=resolved_late`,
      )
      .set(bearer(compliance.accessToken))
      .expect(200);
    const ltRows = ltRes.body as SlaTimerRow[];
    expect(ltRows).toHaveLength(1);
    expect(ltRows[0]).toMatchObject({
      entityId: 'e-lt',
      state: 'resolved_late',
    });
    expect(ltRows[0].overdueDays).toBe(2);

    // resolved group → both closed rows
    const rRes = await request(app.getHttpServer())
      .get(`/sla-dashboard/timers?entityType=${ENTITY_TYPE}&state=resolved`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect(
      new Set((rRes.body as SlaTimerRow[]).map((r) => r.entityId)),
    ).toEqual(new Set(['e-ot', 'e-lt']));

    // an unknown state value is a 400
    await request(app.getHttpServer())
      .get(`/sla-dashboard/timers?state=not_a_state`)
      .set(bearer(compliance.accessToken))
      .expect(400);

    // a best-effort READ audit row was written for this reader
    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: 'SlaDashboard', userId: compliance.userId },
    });
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((a) => a.action === 'READ')).toBe(true);
    expect(new Set(audit.map((a) => a.entityId))).toEqual(
      new Set(['summary', 'timers']),
    );
  });
});

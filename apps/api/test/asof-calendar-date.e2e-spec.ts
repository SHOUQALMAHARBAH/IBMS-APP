import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/*
 * `asOf` MUST BE A DAY THAT EXISTS — IMPROVEMENTS § 1.64, closed 2026-09-29.
 *
 * All six point-in-time report endpoints validated `asOf` with
 * `@Matches(/^\d{4}-\d{2}-\d{2}$/)` and nothing else. That shape admits three non-dates, and MEASURING
 * them is what shrank this from three problems to one:
 *
 *   2026-04-00  ->  Invalid Date  ->  ALREADY refused, 422 from `parseHistoricalInstant`
 *   2026-13-01  ->  Invalid Date  ->  ALREADY refused, 422
 *   2026-02-30  ->  2 MARCH       ->  SILENT. A 200 answering a question nobody asked.
 *
 * The rollover is the one a NaN check structurally cannot catch, and it is the dangerous one: the loud
 * cases get reported, a wrong window gets read as a fact.
 *
 * ## Why this matters on a read-only report
 *
 * FOUR of the six write the normalised `asOf` into an `AuditLogEntry` — the claims dashboard puts it in
 * `entityId`, which is indexed — and that table is append-only, so a rolled-over date could never be
 * corrected, only explained. § 1.64's own reason said the consequence was "a silently shifted report
 * window rather than a stored fact"; that ground has been corrected in place, because it was false for
 * four of the six. `/client-accounting/ageing` and `/insurer-accounting/payables` are deliberately not
 * audit-logged, so for those two the original reason still holds.
 *
 * Measured before the fix: 64 audit rows across dev and db-test, and ZERO on any of the seven dates a
 * `Date()` rollover can possibly produce (Mar 1/2/3, May 1, Jul 1, Oct 1, Dec 1). So nothing stored is
 * wrong and no migration is owed — settled by arithmetic on the possible landing dates rather than by a
 * scan that could have missed one.
 *
 * ## What this file asserts, and the floor that stops it passing vacuously
 *
 * Every case pairs the refusal with a VALID `asOf` on the same endpoint and the same token. Without that,
 * an endpoint that 400s everything — a broken query DTO, a wrong permission, a typo'd route — would
 * satisfy every refusal here and the file would report six guards that do not exist.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

/** The rollover. Shape-valid, calendar-invalid, and `new Date()` turns it into 2 March. */
const IMPOSSIBLE_DAY = '2026-02-30';
/** The two that were ALREADY refused — at 422 from the service, now at 400 from validation. */
const ZERO_DAY = '2026-04-00';
const THIRTEENTH_MONTH = '2026-13-01';
/** A real day, safely in the past — the anchor for every refusal below. */
const REAL_DAY = '2026-02-28';

/**
 * Every endpoint taking an `asOf`, with the permission that gates it.
 * BRANCH_DEPARTMENT_MANAGER holds all six, which is why one user drives the whole file.
 */
const ENDPOINTS: { name: string; path: string }[] = [
  { name: 'financial report summary', path: '/financial-report/summary' },
  { name: 'receivables ageing', path: '/client-accounting/ageing' },
  { name: 'insurer payables', path: '/insurer-accounting/payables' },
  { name: 'claims dashboard', path: '/dashboards/claims' },
  { name: 'executive dashboard', path: '/dashboards/executive' },
  { name: 'financial dashboard', path: '/dashboards/financial' },
];

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
      fullName: 'asOf calendar-date E2E User',
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
    const role = await ensureRole(roleName);
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

describe('asOf must be a day that exists (e2e) — IMPROVEMENTS § 1.64', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('refuses an impossible day on all six point-in-time reports, and still answers a real one', async () => {
    const app = await boot();
    // One Manager: the only seeded role holding all six of these permissions.
    const manager = await makeUser(
      app,
      'asof-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );

    for (const { name, path } of ENDPOINTS) {
      // THE FLOOR, FIRST. A real date must be accepted on this exact endpoint with this exact token,
      // or every refusal below is satisfied by an endpoint that rejects everything.
      await request(app.getHttpServer())
        .get(`${path}?asOf=${REAL_DAY}`)
        .set(bearer(manager.accessToken))
        .expect(200);

      // 30 February is not a day. Before this guard it was answered as 2 MARCH.
      const refused = await request(app.getHttpServer())
        .get(`${path}?asOf=${IMPOSSIBLE_DAY}`)
        .set(bearer(manager.accessToken))
        .expect(400);
      // The message must name the DAY, not the shape — `@IsCalendarDate` is paired with the existing
      // `@Matches` precisely so the two stay distinguishable to whoever hits one.
      expect(JSON.stringify(refused.body), name).toContain(
        'must be a date that exists',
      );
    }
  }, 600_000);

  it('the two that were already refused are still refused, now at validation rather than in the service', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'asof-manager-nan',
      'BRANCH_DEPARTMENT_MANAGER',
    );

    // Both produce an Invalid Date, so `parseHistoricalInstant` already answered 422. They now fail one
    // layer earlier with a 400. Asserted so the STATUS CHANGE is a recorded decision rather than a
    // side effect nobody noticed: measured first, no consumer asserts 422 for these and no screen can
    // emit them (every web caller builds `asOf` from a native date input).
    for (const bad of [ZERO_DAY, THIRTEENTH_MONTH]) {
      await request(app.getHttpServer())
        .get(`/financial-report/summary?asOf=${bad}`)
        .set(bearer(manager.accessToken))
        .expect(400);
    }

    // And the future check is UNTOUCHED — a future date is shape-valid AND calendar-valid, so it still
    // reaches the service and still answers 422. This is the assertion that proves the new decorator did
    // not swallow a refusal that was already working.
    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await request(app.getHttpServer())
      .get(`/financial-report/summary?asOf=${future}`)
      .set(bearer(manager.accessToken))
      .expect(422);
  }, 600_000);
});

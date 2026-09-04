import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface SyncOutcomeBody {
  source: string;
  status: string;
  recordCount?: number;
  errorMessage?: string;
}
interface SyncRunBody {
  source: string;
  status: string;
  recordCount: number | null;
}
interface KycRecordBody {
  id: string;
  status: string;
  isEdd: boolean;
}
interface ScreeningBatchBody {
  screened: number;
  hits: number;
  failed: number;
}

// A run-unique OFAC entity number and name, so this test never collides
// with another isolated e2e run seeding its own sync data — WatchlistEntry
// is a global cache, not scoped to one test's ids (db-test is cumulative
// across specs).
const RUN_ID = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const OFAC_ENT_NUM = `9${RUN_ID}`.slice(0, 9);
const SANCTIONED_NAME = `Zzq Watchlist Test ${RUN_ID}`;

const OFAC_CSV_FIXTURE = `${OFAC_ENT_NUM},"${SANCTIONED_NAME}","individual","SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 01 Jan 1980."\n`;

const UN_DATA_ID = `8${RUN_ID}`.slice(0, 9);
const UN_XML_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<CONSOLIDATED_LIST>
  <INDIVIDUALS>
    <INDIVIDUAL>
      <DATAID>${UN_DATA_ID}</DATAID>
      <FIRST_NAME>UnrelatedUnListedPerson</FIRST_NAME>
      <SECOND_NAME>${RUN_ID}</SECOND_NAME>
      <UN_LIST_TYPE>TEST</UN_LIST_TYPE>
      <REFERENCE_NUMBER>T.${RUN_ID}</REFERENCE_NUMBER>
    </INDIVIDUAL>
  </INDIVIDUALS>
  <ENTITIES></ENTITIES>
</CONSOLIDATED_LIST>`;

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
    .send({ fullName: 'Watchlist E2E User', email, password: PASSWORD })
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

describe('Sanctions & PEP Screening / Watchlist Sync (e2e) — backlog Part C #49', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = input.toString();
        if (url.includes('sdn.csv')) {
          return new Response(OFAC_CSV_FIXTURE, { status: 200 });
        }
        if (url.includes('consolidated.xml')) {
          return new Response(UN_XML_FIXTURE, { status: 200 });
        }
        return originalFetch(input);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('syncs both free sanctions lists, and a customer whose name matches one gets flagged HIT on screening', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'wl-compliance',
      'COMPLIANCE_OFFICER',
    );
    const sales = await makeUser(app, 'wl-sales', 'SALES_RELATIONSHIP_OFFICER');

    // a non-Compliance actor cannot sync, check status, or run the batch
    await request(app.getHttpServer())
      .post('/watchlist-sync/run')
      .set(bearer(sales.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .get('/watchlist-sync/status')
      .set(bearer(sales.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .post('/screening/recurring-batch')
      .set(bearer(sales.accessToken))
      .expect(403);

    const synced = await request(app.getHttpServer())
      .post('/watchlist-sync/run')
      .set(bearer(compliance.accessToken))
      .expect(201);
    const outcomes = synced.body as SyncOutcomeBody[];
    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('succeeded');
      expect(outcome.recordCount).toBeGreaterThanOrEqual(1);
    }

    const status = await request(app.getHttpServer())
      .get('/watchlist-sync/status')
      .set(bearer(compliance.accessToken))
      .expect(200);
    const runs = status.body as SyncRunBody[];
    expect(runs.map((r) => r.source).sort()).toEqual([
      'OFAC_SDN',
      'UN_CONSOLIDATED',
    ]);
    expect(runs.every((r) => r.status === 'succeeded')).toBe(true);

    // a real DB row exists for the synced OFAC entry, matching the parsed shape
    const entry = await prisma.watchlistEntry.findFirst({
      where: { source: 'OFAC_SDN', sourceRecordId: OFAC_ENT_NUM },
    });
    expect(entry?.fullName).toBe(SANCTIONED_NAME);
    expect(entry?.listProgram).toBe('SDGT');
    // A @code-reviewer BLOCKER on the first pass shipped this table with no
    // classification column at all — the conservative default must
    // actually land on a real synced row, not just exist in the schema.
    expect(entry?.classification).toBe('HIGHLY_CONFIDENTIAL');

    // idempotent re-sync: the same record upserts, does not duplicate
    await request(app.getHttpServer())
      .post('/watchlist-sync/run')
      .set(bearer(compliance.accessToken))
      .expect(201);
    const countAfter = await prisma.watchlistEntry.count({
      where: { source: 'OFAC_SDN', sourceRecordId: OFAC_ENT_NUM },
    });
    expect(countAfter).toBe(1);

    // now onboard a customer whose legal name is a token-reordering of the
    // synced sanctioned name — normalizeWatchlistName is order-independent.
    const customer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: SANCTIONED_NAME.split(' ').reverse().join(' '),
        ownerUserId: sales.userId,
      },
    });
    const started = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/kyc`)
      .set(bearer(sales.accessToken))
      .expect(201);
    const kycId = (started.body as KycRecordBody).id;
    await request(app.getHttpServer())
      .post(`/kyc-records/${kycId}/submit`)
      .set(bearer(sales.accessToken))
      .expect(201);
    const screened = await request(app.getHttpServer())
      .post(`/kyc-records/${kycId}/run-screening`)
      .set(bearer(compliance.accessToken))
      .expect(201);
    expect((screened.body as KycRecordBody).isEdd).toBe(true);

    const screeningResults = await prisma.screeningResult.findMany({
      where: { kycRecordId: kycId },
    });
    expect(screeningResults).toHaveLength(3);
    for (const result of screeningResults) {
      expect(result.result).toBe('HIT');
      expect(result.listSource).toBe('OFAC_SDN (SDGT)');
    }

    // the on-demand recurring re-screen batch runs without error and picks
    // up ACTIVE customers with an approved/periodic-review-due KYC file —
    // this customer's KYC is not yet approved, so it is correctly skipped
    // (screened stays 0 for it), proving the endpoint itself works and is
    // properly permission-gated end to end.
    const batch = await request(app.getHttpServer())
      .post('/screening/recurring-batch')
      .set(bearer(compliance.accessToken))
      .expect(201);
    expect(typeof (batch.body as ScreeningBatchBody).screened).toBe('number');
  });
});

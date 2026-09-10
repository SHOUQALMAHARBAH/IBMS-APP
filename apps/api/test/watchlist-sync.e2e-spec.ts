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
interface ScreeningMatchBody {
  id: string;
  subjectName: string;
  matchType: string;
  status: string;
  listSource: string;
  listEntryName: string;
}
interface PendingCountBody {
  pending: number;
  watchlistReady: boolean;
}

// A run-unique OFAC entity number and name, so this test never collides
// with another isolated e2e run seeding its own sync data — WatchlistEntry
// is a global cache, not scoped to one test's ids (db-test is cumulative
// across specs).
const RUN_ID = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const OFAC_ENT_NUM = `9${RUN_ID}`.slice(0, 9);
const SANCTIONED_NAME = `Zzq Watchlist Test ${RUN_ID}`;

// WatchlistSyncService refuses to trust a parse of fewer than
// WATCHLIST_MIN_ABSOLUTE_RECORDS (10) records when there is no PRIOR
// successful sync for that source to compare against — a real, deliberate
// plausibility floor against a WAF/interstitial page parsing to
// near-nothing "for free" on day one. A brand-new database (exactly what
// CI's fresh db-test is, every run) always takes this branch, so the fixture
// must clear the same floor a real first sync would — 9 harmless filler
// records alongside the one record each test actually asserts against.
const OFAC_FILLER_ROWS = Array.from(
  { length: 9 },
  (_, i) =>
    `F${i}-${RUN_ID},"Filler OFAC Entry ${i} ${RUN_ID}","individual","SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"filler row to clear the no-prior-sync plausibility floor"`,
).join('\n');
const OFAC_CSV_FIXTURE = `${OFAC_FILLER_ROWS}\n${OFAC_ENT_NUM},"${SANCTIONED_NAME}","individual","SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 01 Jan 1980."\n`;

const UN_DATA_ID = `8${RUN_ID}`.slice(0, 9);
const UN_FILLER_INDIVIDUALS = Array.from(
  { length: 9 },
  (_, i) => `
    <INDIVIDUAL>
      <DATAID>F${i}-${UN_DATA_ID}</DATAID>
      <FIRST_NAME>FillerUnListedPerson</FIRST_NAME>
      <SECOND_NAME>${i}-${RUN_ID}</SECOND_NAME>
      <UN_LIST_TYPE>TEST</UN_LIST_TYPE>
      <REFERENCE_NUMBER>T.F${i}.${RUN_ID}</REFERENCE_NUMBER>
    </INDIVIDUAL>`,
).join('');
const UN_XML_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<CONSOLIDATED_LIST>
  <INDIVIDUALS>${UN_FILLER_INDIVIDUALS}
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
    // Part B §6 — the property is "a re-sync does not duplicate a record",
    // and it is now scoped to the generation a screening can actually see. A
    // bare count across every generation is legitimately >1: the previous
    // generation is RETAINED so it can be rolled back to, which is the point
    // of the retention window.
    const countInPublished = await prisma.watchlistEntry.count({
      where: {
        source: 'OFAC_SDN',
        sourceRecordId: OFAC_ENT_NUM,
        datasetVersion: { status: 'PUBLISHED' },
      },
    });
    expect(countInPublished).toBe(1);

    // And the re-sync really did publish a NEW generation, superseding rather
    // than mutating the old one — the behaviour that makes the swap atomic.
    const generations = await prisma.watchlistDatasetVersion.findMany({
      where: { source: 'OFAC_SDN' },
      orderBy: { downloadedAt: 'desc' },
      select: { status: true },
    });
    expect(generations[0].status).toBe('PUBLISHED');
    expect(generations.filter((g) => g.status === 'PUBLISHED')).toHaveLength(1);
    expect(generations.some((g) => g.status === 'SUPERSEDED')).toBe(true);

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
  it('routes a FUZZY match into the review queue and adjudicates it end to end', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'wl-queue-compliance',
      'COMPLIANCE_OFFICER',
    );
    const sales = await makeUser(
      app,
      'wl-queue-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );

    // Self-contained: the sync is idempotent, so this does not depend on the
    // test above having run first.
    await request(app.getHttpServer())
      .post('/watchlist-sync/run')
      .set(bearer(compliance.accessToken))
      .expect(201);

    // The whole point of Process 49's fuzzy rule: a Jordanian four-part name
    // carrying an EXTRA given name that the list entry does not have. Exact
    // token-set equality returned CLEAR for this shape; containment catches it.
    const [first, ...rest] = SANCTIONED_NAME.split(' ');
    const fuzzyName = [first, 'Ekhtebar', ...rest].join(' ');
    const customer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: fuzzyName,
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
    await request(app.getHttpServer())
      .post(`/kyc-records/${kycId}/run-screening`)
      .set(bearer(compliance.accessToken))
      .expect(201);

    // The queue is permission-gated on sanctions-pep.screen.
    await request(app.getHttpServer())
      .get('/screening/matches')
      .set(bearer(sales.accessToken))
      .expect(403);

    // Scoped to THIS test's own kycRecordId — db-test is cumulative across
    // specs, so a book-wide read would be answering someone else's question.
    const queued = await request(app.getHttpServer())
      .get(`/screening/matches?kycRecordId=${kycId}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const rows = queued.body as ScreeningMatchBody[];
    expect(rows).toHaveLength(1);
    expect(rows[0].matchType).toBe('fuzzy');
    expect(rows[0].subjectName).toBe(fuzzyName);
    expect(rows[0].listEntryName).toBe(SANCTIONED_NAME);
    expect(rows[0].status).toBe('pending');
    // Snapshotted from the entry, so the row survives the entry being pruned.
    expect(rows[0].listSource).toBe('OFAC_SDN (SDGT)');
    const matchId = rows[0].id;

    // An unvalidated `status` used to be passed straight into the Prisma
    // where, so a typo silently returned an EMPTY queue — which a Compliance
    // Officer reads as "nothing to review".
    await request(app.getHttpServer())
      .get('/screening/matches?status=Pending')
      .set(bearer(compliance.accessToken))
      .expect(400);

    // Part B §16 — a decision may only be recorded on a case somebody actually
    // picked up. Deciding straight from OPEN is the rubber-stamp the queue
    // exists to prevent, so the match is assigned and started first; that is
    // now part of adjudicating one end to end.
    await request(app.getHttpServer())
      .post(`/screening/matches/${matchId}/assign`)
      .set(bearer(compliance.accessToken))
      .send({ assigneeUserId: compliance.userId })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/screening/matches/${matchId}/start-review`)
      .set(bearer(compliance.accessToken))
      .expect(201);

    // A written reason is mandatory on BOTH outcomes and has a real floor:
    // "cleared" with no stated basis is indistinguishable from "ignored".
    await request(app.getHttpServer())
      .post(`/screening/matches/${matchId}/review`)
      .set(bearer(compliance.accessToken))
      .send({ decision: 'cleared', reviewReason: 'nope' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/screening/matches/${matchId}/review`)
      .set(bearer(compliance.accessToken))
      .send({ decision: 'sideways', reviewReason: 'A perfectly good reason.' })
      .expect(400);

    const reviewed = await request(app.getHttpServer())
      .post(`/screening/matches/${matchId}/review`)
      .set(bearer(compliance.accessToken))
      .send({
        decision: 'cleared',
        reviewReason:
          'Different date of birth and nationality; not the listed individual.',
      })
      .expect(201);
    expect((reviewed.body as ScreeningMatchBody).status).toBe('cleared');

    // A recorded decision is FINAL here — a second review is a 409, not a
    // silent overwrite of somebody else's adjudication.
    await request(app.getHttpServer())
      .post(`/screening/matches/${matchId}/review`)
      .set(bearer(compliance.accessToken))
      .send({
        decision: 'confirmed',
        reviewReason: 'Changing my mind after the fact.',
      })
      .expect(409);

    // Clearing a false positive does NOT unwind the EDD escalation the match
    // caused — that is a separate, deliberate Compliance decision.
    const kyc = await prisma.kYCRecord.findUniqueOrThrow({
      where: { id: kycId },
    });
    expect(kyc.isEdd).toBe(true);

    // The cache has been synced in this test, so the queue screen must not
    // warn that nothing was ever checked.
    const counted = await request(app.getHttpServer())
      .get('/screening/matches/pending-count')
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((counted.body as PendingCountBody).watchlistReady).toBe(true);
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/**
 * Part B §17 — the screening hold, end to end against a real database.
 *
 * What this proves, and why it needed proving: before §17, `decide()` asked
 * only whether `ScreeningResult` rows EXISTED. A file whose screening could
 * not be performed has rows — three of them, all `PENDING_INVESTIGATION` —
 * so it approved exactly like a file that came back clean, and nothing
 * anywhere recorded that the customer had never actually been screened.
 *
 * These tests drive that path through real HTTP against a real Postgres:
 * an un-screenable file is refused, the refusal names why, a written
 * acceptance releases it, the release is a queryable row, and the customer
 * only then activates.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface KycRecordBody {
  id: string;
  status: string;
  isEdd: boolean;
  customerId: string;
}
interface HoldBody {
  level: 'NO_HOLD' | 'REVIEW_REQUIRED' | 'BLOCKED';
  releasable: boolean;
  reasons: { condition: string; level: string; detail: string }[];
  releases: {
    id: string;
    reason: string;
    conditions: string[];
    releasedByUserId: string;
  }[];
  lastScreenedAt: string | null;
  configurationProblems: string[];
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
  return decodeURIComponent(match[1]);
}

let app: INestApplication<App> | null = null;

async function boot(): Promise<INestApplication<App>> {
  app ??= await createTestApp();
  return app;
}

afterAll(async () => {
  await app?.close();
  app = null;
});

async function makeUser(
  application: INestApplication<App>,
  label: string,
  role: RoleName,
): Promise<{ accessToken: string; id: string }> {
  const email = uniqueEmail(label);
  await request(application.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `E2E ${label}`, email, password: PASSWORD })
    .expect(201);
  const login = await request(application.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = login.body as IssuedSessionBody;

  const enroll = await request(application.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(body.accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  await request(application.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(body.accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(enrollBody.otpAuthUri)),
    })
    .expect(200);

  const roleRow = await prisma.role.upsert({
    where: { name: role },
    update: {},
    create: { name: role },
  });
  const existing = await prisma.userRoleAssignment.findFirst({
    where: { userId: body.user.id, roleId: roleRow.id, revokedAt: null },
  });
  if (!existing) {
    await prisma.userRoleAssignment.create({
      data: { userId: body.user.id, roleId: roleRow.id },
    });
  }

  return { accessToken: body.accessToken, id: body.user.id };
}

/**
 * Empty the local sanctions cache so the built-in provider genuinely cannot
 * answer — which is the real production state of any deployment whose sync
 * has never run, and the state this whole feature exists for.
 *
 * Scoped by nothing, because `WatchlistEntry` is a synced cache rather than
 * test-owned data: `WatchlistSyncService` rebuilds it from the live OFAC/UN
 * lists on demand. Deleting the dependent matches first, since a CONFIRMED
 * match deliberately outlives its entry (`onDelete: SetNull`) and would
 * otherwise be left dangling into other specs.
 */
async function emptyWatchlistCache(): Promise<void> {
  await prisma.screeningMatch.updateMany({
    where: { watchlistEntryId: { not: null } },
    data: { watchlistEntryId: null },
  });
  await prisma.watchlistEntry.deleteMany({});
}

/** One obviously fictional entry, so the provider has a populated list to
 * report NO_MATCH against honestly. */
async function seedWatchlistFixture(): Promise<void> {
  const run = await prisma.watchlistSyncRun.create({
    data: {
      source: 'OFAC_SDN',
      status: 'SUCCEEDED',
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });
  await prisma.watchlistEntry.create({
    data: {
      source: 'OFAC_SDN',
      sourceRecordId: `e2e-hold-${Date.now()}`,
      fullName: 'Zzz Fictional Screening Fixture',
      normalizedName: 'zzz fictional screening fixture',
      canonicalTokens: ['fictional', 'fixture', 'screening', 'zzz'],
      syncRunId: run.id,
    },
  });
}

async function startAndScreen(
  application: INestApplication<App>,
  sales: { accessToken: string },
  compliance: { accessToken: string },
  legalName: string,
): Promise<{ kycId: string; customerId: string }> {
  // Part F item #4: an INDIVIDUAL's `legalName` is composed server-side from
  // the national-ID name parts, not accepted directly. Splitting on the first
  // space rejoins byte-identically, so the assertions below still read the
  // name they passed in.
  const [givenName, ...rest] = legalName.split(' ');
  const customer = await request(application.getHttpServer())
    .post('/customers')
    .set(bearer(sales.accessToken))
    .send({
      customerType: 'INDIVIDUAL',
      givenName,
      familyName: rest.join(' '),
      nationalId: '9901012345',
      contactPhone: '+962-7-9000-0000',
      contactEmail: 'customer@example.test',
      languagePreference: 'AR',
    })
    .expect(201);
  const customerId = (customer.body as { id: string }).id;

  const started = await request(application.getHttpServer())
    .post(`/customers/${customerId}/kyc`)
    .set(bearer(sales.accessToken))
    .expect(201);
  const kycId = (started.body as KycRecordBody).id;

  await request(application.getHttpServer())
    .post(`/kyc-records/${kycId}/submit`)
    .set(bearer(sales.accessToken))
    .expect(201);
  await request(application.getHttpServer())
    .post(`/kyc-records/${kycId}/run-screening`)
    .set(bearer(compliance.accessToken))
    .expect(201);

  return { kycId, customerId };
}

describe('Part B §17 — a screening that did not happen holds the workflow', () => {
  beforeEach(async () => {
    await emptyWatchlistCache();
  });

  it('refuses the approval, names why, and releases only against a written reason', async () => {
    const application = await boot();
    const sales = await makeUser(
      application,
      'hold-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const compliance = await makeUser(
      application,
      'hold-compliance',
      'COMPLIANCE_OFFICER',
    );

    const { kycId, customerId } = await startAndScreen(
      application,
      sales,
      compliance,
      'Hold Path E2E Customer',
    );

    // The screening produced rows — and they say PENDING_INVESTIGATION,
    // because no populated list could be consulted. This is exactly the
    // state that used to approve silently.
    const results = await prisma.screeningResult.findMany({
      where: { kycRecordId: kycId },
    });
    expect(results).toHaveLength(3);
    expect(new Set(results.map((r) => r.result))).toEqual(
      new Set(['PENDING_INVESTIGATION']),
    );
    expect(new Set(results.map((r) => r.attemptOutcome))).toEqual(
      new Set(['UNABLE_TO_SCREEN']),
    );

    // The hold view says so BEFORE anyone tries to approve.
    const holdBefore = await request(application.getHttpServer())
      .get(`/kyc-records/${kycId}/screening-hold`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const hold = holdBefore.body as HoldBody;
    expect(hold.level).toBe('REVIEW_REQUIRED');
    expect(hold.releasable).toBe(true);
    expect(hold.reasons.map((r) => r.condition)).toContain(
      'UNRESOLVED_SCREENING',
    );
    expect(hold.reasons[0].detail).toContain('UNABLE_TO_SCREEN');
    expect(hold.releases).toEqual([]);

    // THE GATE: approving with no stated acceptance is refused.
    const refused = await request(application.getHttpServer())
      .post(`/kyc-records/${kycId}/approve`)
      .set(bearer(compliance.accessToken))
      .send({})
      .expect(400);
    expect((refused.body as { message: string }).message).toContain(
      'accepted in writing',
    );

    // The refusal is real, not cosmetic: nothing moved.
    const stillScreening = await prisma.kYCRecord.findUniqueOrThrow({
      where: { id: kycId },
    });
    expect(stillScreening.status).toBe('SCREENING');
    const customerStill = await prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
    });
    expect(customerStill.status).toBe('PENDING_KYC');
    expect(
      await prisma.screeningHoldRelease.count({
        where: { kycRecordId: kycId },
      }),
    ).toBe(0);

    // A blank reason is not a reason.
    await request(application.getHttpServer())
      .post(`/kyc-records/${kycId}/approve`)
      .set(bearer(compliance.accessToken))
      .send({ screeningHoldReason: '   ' })
      .expect(400);

    // With a written acceptance, the approval proceeds.
    const approved = await request(application.getHttpServer())
      .post(`/kyc-records/${kycId}/approve`)
      .set(bearer(compliance.accessToken))
      .send({
        screeningHoldReason:
          'Sanctions cache not yet synced in this environment; manual OFAC check performed offline and documented in the client file.',
      })
      .expect(201);
    expect((approved.body as KycRecordBody).status).toBe('APPROVED');

    // And the acceptance is a ROW — attributable, with what was accepted.
    const releases = await prisma.screeningHoldRelease.findMany({
      where: { kycRecordId: kycId },
    });
    expect(releases).toHaveLength(1);
    expect(releases[0].level).toBe('REVIEW_REQUIRED');
    expect(releases[0].conditions).toContain('UNRESOLVED_SCREENING');
    expect(releases[0].releasedByUserId).toBe(compliance.id);
    expect(releases[0].reason).toContain('manual OFAC check');
    expect(releases[0].workflow).toBe('kyc_decision');

    // The hold view shows the release to the next reader.
    const holdAfter = await request(application.getHttpServer())
      .get(`/kyc-records/${kycId}/screening-hold`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((holdAfter.body as HoldBody).releases).toHaveLength(1);
  });

  it('does NOT demand a waiver to REJECT a customer', async () => {
    // Refusing a customer never needs a screening finding waived, and
    // demanding one would be a reason not to refuse.
    const application = await boot();
    const sales = await makeUser(
      application,
      'hold-reject-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const compliance = await makeUser(
      application,
      'hold-reject-compliance',
      'COMPLIANCE_OFFICER',
    );
    const { kycId } = await startAndScreen(
      application,
      sales,
      compliance,
      'Hold Reject E2E Customer',
    );

    const rejected = await request(application.getHttpServer())
      .post(`/kyc-records/${kycId}/reject`)
      .set(bearer(compliance.accessToken))
      .send({ reason: 'Declined for reasons unrelated to screening.' })
      .expect(201);
    expect((rejected.body as KycRecordBody).status).toBe('REJECTED');
    expect(
      await prisma.screeningHoldRelease.count({
        where: { kycRecordId: kycId },
      }),
    ).toBe(0);
  });

  it('a populated list with no match is NO_HOLD — the approval needs nothing', async () => {
    const application = await boot();
    await seedWatchlistFixture();

    const sales = await makeUser(
      application,
      'hold-clean-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const compliance = await makeUser(
      application,
      'hold-clean-compliance',
      'COMPLIANCE_OFFICER',
    );
    const { kycId, customerId } = await startAndScreen(
      application,
      sales,
      compliance,
      'Entirely Unremarkable E2E Person',
    );

    const results = await prisma.screeningResult.findMany({
      where: { kycRecordId: kycId },
    });
    expect(new Set(results.map((r) => r.attemptOutcome))).toEqual(
      new Set(['NO_MATCH']),
    );
    expect(new Set(results.map((r) => r.result))).toEqual(new Set(['CLEAR']));

    const hold = await request(application.getHttpServer())
      .get(`/kyc-records/${kycId}/screening-hold`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((hold.body as HoldBody).level).toBe('NO_HOLD');
    expect((hold.body as HoldBody).reasons).toEqual([]);

    // No reason supplied, and none needed.
    await request(application.getHttpServer())
      .post(`/kyc-records/${kycId}/approve`)
      .set(bearer(compliance.accessToken))
      .send({})
      .expect(201);

    const customerAfter = await prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
    });
    expect(customerAfter.status).toBe('ACTIVE');
    expect(
      await prisma.screeningHoldRelease.count({
        where: { kycRecordId: kycId },
      }),
    ).toBe(0);
  });

  it('a CONFIRMED sanctions match BLOCKS, and no written reason releases it', async () => {
    const application = await boot();
    await seedWatchlistFixture();

    const sales = await makeUser(
      application,
      'hold-blocked-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const compliance = await makeUser(
      application,
      'hold-blocked-compliance',
      'COMPLIANCE_OFFICER',
    );
    const { kycId, customerId } = await startAndScreen(
      application,
      sales,
      compliance,
      'Blocked Path E2E Customer',
    );

    // A reviewer has already worked this candidate and recorded, in writing,
    // that it is a true sanctions match.
    await prisma.screeningMatch.create({
      data: {
        kycRecordId: kycId,
        entrySource: 'OFAC_SDN',
        entryFullName: 'Zzz Fictional Screening Fixture',
        subjectName: 'Blocked Path E2E Customer',
        subjectCanonical: 'blocked customer e2e path',
        matchType: 'exact',
        listType: 'SANCTIONS',
        status: 'confirmed',
        reviewedByUserId: compliance.id,
        reviewedAt: new Date(),
        reviewReason: 'Identity confirmed against the published list entry.',
      },
    });

    const hold = await request(application.getHttpServer())
      .get(`/kyc-records/${kycId}/screening-hold`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((hold.body as HoldBody).level).toBe('BLOCKED');
    expect((hold.body as HoldBody).releasable).toBe(false);

    // 422, not 400: this is not a missing-input problem that a better
    // request could fix.
    const blocked = await request(application.getHttpServer())
      .post(`/kyc-records/${kycId}/approve`)
      .set(bearer(compliance.accessToken))
      .send({
        screeningHoldReason:
          'Attempting to wave this through with a written reason.',
      })
      .expect(422);
    expect((blocked.body as { message: string }).message).toContain('BLOCKED');

    // Nothing moved, and no release row was minted for the attempt.
    const kyc = await prisma.kYCRecord.findUniqueOrThrow({
      where: { id: kycId },
    });
    expect(kyc.status).toBe('SCREENING');
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
    });
    expect(customer.status).toBe('PENDING_KYC');
    expect(
      await prisma.screeningHoldRelease.count({
        where: { kycRecordId: kycId },
      }),
    ).toBe(0);
  });

  it('a PENDING match holds the file until the review queue is worked', async () => {
    const application = await boot();
    await seedWatchlistFixture();

    const sales = await makeUser(
      application,
      'hold-pending-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const compliance = await makeUser(
      application,
      'hold-pending-compliance',
      'COMPLIANCE_OFFICER',
    );
    const { kycId } = await startAndScreen(
      application,
      sales,
      compliance,
      'Pending Queue E2E Customer',
    );

    const match = await prisma.screeningMatch.create({
      data: {
        kycRecordId: kycId,
        entrySource: 'OFAC_SDN',
        entryFullName: 'Zzz Fictional Screening Fixture',
        subjectName: 'Pending Queue E2E Customer',
        subjectCanonical: 'customer e2e pending queue',
        matchType: 'fuzzy',
        listType: 'SANCTIONS',
        status: 'pending',
      },
    });

    const held = await request(application.getHttpServer())
      .get(`/kyc-records/${kycId}/screening-hold`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((held.body as HoldBody).level).toBe('REVIEW_REQUIRED');
    expect((held.body as HoldBody).reasons.map((r) => r.condition)).toContain(
      'PENDING_MATCH_REVIEW',
    );

    // Clearing it as a false positive lifts the hold — that is what a
    // cleared match means.
    await request(application.getHttpServer())
      .post(`/screening/matches/${match.id}/review`)
      .set(bearer(compliance.accessToken))
      .send({
        decision: 'cleared',
        reviewReason:
          'Different date of birth and nationality; not the listed person.',
      })
      .expect(201);

    const lifted = await request(application.getHttpServer())
      .get(`/kyc-records/${kycId}/screening-hold`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((lifted.body as HoldBody).level).toBe('NO_HOLD');

    await request(application.getHttpServer())
      .post(`/kyc-records/${kycId}/approve`)
      .set(bearer(compliance.accessToken))
      .send({})
      .expect(201);
  });

  it('the hold view carries no subject PII', async () => {
    // It is read by anyone with `kyc.read`, which is a wider set than
    // `isSensitiveDataAccess`. The evaluator is given only statuses and list
    // types, so there is no name in its input to leak — this pins that.
    const application = await boot();
    const sales = await makeUser(
      application,
      'hold-pii-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const compliance = await makeUser(
      application,
      'hold-pii-compliance',
      'COMPLIANCE_OFFICER',
    );
    const legalName = 'Mnemonic Distinctive Screening Name';
    const { kycId } = await startAndScreen(
      application,
      sales,
      compliance,
      legalName,
    );
    await prisma.screeningMatch.create({
      data: {
        kycRecordId: kycId,
        entrySource: 'OFAC_SDN',
        entryFullName: 'Zzz Fictional Screening Fixture',
        subjectName: legalName,
        subjectCanonical: 'distinctive mnemonic name screening',
        matchType: 'exact',
        listType: 'PEP',
        status: 'pending',
      },
    });

    const hold = await request(application.getHttpServer())
      .get(`/kyc-records/${kycId}/screening-hold`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const serialized = JSON.stringify(hold.body);
    expect(serialized).not.toContain('Mnemonic');
    expect(serialized).not.toContain('Zzz Fictional');
  });
});

describe('Part B §12 — a subject added after screening is not a screened subject', () => {
  beforeEach(async () => {
    await emptyWatchlistCache();
  });

  it('a UBO added after run-screening holds the approval until a re-screen', async () => {
    // THE HOLE. Before §12: a CORPORATE file is screened with one UBO, comes
    // back NO_MATCH, and a second beneficial owner is then added. That person
    // has never been checked against any list — and the file's own
    // ScreeningResult rows still say CLEAR, because they are about a
    // different set of people. Nothing read the difference.
    const application = await boot();
    await seedWatchlistFixture();

    const sales = await makeUser(
      application,
      'identity-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const compliance = await makeUser(
      application,
      'identity-compliance',
      'COMPLIANCE_OFFICER',
    );

    const created = await request(application.getHttpServer())
      .post('/customers')
      .set(bearer(sales.accessToken))
      .send({
        customerType: 'CORPORATE',
        legalName: 'Identity Change E2E Trading LLC',
        registrationNumber: 'CR-IDENTITY-E2E',
        registeredAddress: 'Amman',
        natureOfBusiness: 'Trading',
        contactPhone: '+962-7-9000-0000',
        contactEmail: 'corporate@example.test',
        languagePreference: 'AR',
      })
      .expect(201);
    const customerId = (created.body as { id: string }).id;

    await request(application.getHttpServer())
      .post(`/customers/${customerId}/ubos`)
      .set(bearer(sales.accessToken))
      .send({
        givenName: 'Layla',
        familyName: 'Haddad',
        nationalId: '9901019999',
        isPep: false,
        dateOfBirth: '1979-11-02',
        nationality: 'JO',
      })
      .expect(201);

    const started = await request(application.getHttpServer())
      .post(`/customers/${customerId}/kyc`)
      .set(bearer(sales.accessToken))
      .expect(201);
    const kycId = (started.body as KycRecordBody).id;
    await request(application.getHttpServer())
      .post(`/kyc-records/${kycId}/submit`)
      .set(bearer(sales.accessToken))
      .expect(201);
    await request(application.getHttpServer())
      .post(`/kyc-records/${kycId}/run-screening`)
      .set(bearer(compliance.accessToken))
      .expect(201);

    // Screened, clean, and no hold — the file is decidable.
    const beforeChange = await request(application.getHttpServer())
      .get(`/kyc-records/${kycId}/screening-hold`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((beforeChange.body as HoldBody).level).toBe('NO_HOLD');

    // The fingerprint of what was screened was recorded.
    const firstRequest = await prisma.screeningRequest.findFirstOrThrow({
      where: { kycRecordId: kycId },
      orderBy: { startedAt: 'desc' },
    });
    expect(firstRequest.subjectFingerprint).toMatch(/^[0-9a-f]{32}$/);

    // A second beneficial owner is added. Nobody has screened this person.
    await request(application.getHttpServer())
      .post(`/customers/${customerId}/ubos`)
      .set(bearer(sales.accessToken))
      .send({
        givenName: 'Nour',
        familyName: 'Masri',
        nationalId: '9901018888',
        isPep: false,
        dateOfBirth: '1988-06-21',
        nationality: 'JO',
      })
      .expect(201);

    // The file is now held — and says exactly why.
    const afterChange = await request(application.getHttpServer())
      .get(`/kyc-records/${kycId}/screening-hold`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const held = afterChange.body as HoldBody;
    expect(held.level).toBe('REVIEW_REQUIRED');
    expect(held.reasons.map((r) => r.condition)).toContain(
      'IDENTITY_CHANGED_SINCE_SCREENING',
    );

    // And the approval is refused without a written acceptance.
    await request(application.getHttpServer())
      .post(`/kyc-records/${kycId}/approve`)
      .set(bearer(compliance.accessToken))
      .send({})
      .expect(400);

    // The remedy is to actually screen the new person. Re-running screening
    // records a fingerprint covering both UBOs, and the hold lifts on its own.
    await request(application.getHttpServer())
      .post(`/kyc-records/${kycId}/rerun-screening`)
      .set(bearer(compliance.accessToken))
      .expect(201);

    const rescreened = await prisma.screeningRequest.findFirstOrThrow({
      where: { kycRecordId: kycId },
      orderBy: { startedAt: 'desc' },
    });
    expect(rescreened.subjectFingerprint).not.toBe(
      firstRequest.subjectFingerprint,
    );

    const lifted = await request(application.getHttpServer())
      .get(`/kyc-records/${kycId}/screening-hold`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((lifted.body as HoldBody).level).toBe('NO_HOLD');

    await request(application.getHttpServer())
      .post(`/kyc-records/${kycId}/approve`)
      .set(bearer(compliance.accessToken))
      .send({})
      .expect(201);
  });

  it('rejects an invalid nationality and an impossible date of birth', async () => {
    const application = await boot();
    const sales = await makeUser(
      application,
      'identity-validation',
      'SALES_RELATIONSHIP_OFFICER',
    );

    // A control test first: the SAME payload with no bad field is accepted.
    // Without it this loop would pass just as happily if the 400 came from an
    // unrelated missing field — which is exactly what it did on first run.
    await request(application.getHttpServer())
      .post('/customers')
      .set(bearer(sales.accessToken))
      .send({
        customerType: 'INDIVIDUAL',
        givenName: 'Validation',
        familyName: 'Control',
        nationalId: '9901012345',
        contactPhone: '+962-7-9000-0000',
        contactEmail: 'customer@example.test',
        languagePreference: 'AR',
      })
      .expect(201);

    for (const bad of [
      { nationality: 'Jordan' },
      { nationality: 'jo' },
      { nationality: '962' },
      { dateOfBirth: '14-05-1990' },
      { dateOfBirth: 'yesterday' },
    ]) {
      const rejected = await request(application.getHttpServer())
        .post('/customers')
        .set(bearer(sales.accessToken))
        .send({
          customerType: 'INDIVIDUAL',
          givenName: 'Validation',
          familyName: 'Case',
          nationalId: '9901012345',
          contactPhone: '+962-7-9000-0000',
          contactEmail: 'customer@example.test',
          languagePreference: 'AR',
          ...bad,
        })
        .expect(400);
      const field = Object.keys(bad)[0];
      expect(JSON.stringify(rejected.body), JSON.stringify(bad)).toContain(
        field,
      );
    }
  });

  it('stores the discriminators and returns them on the customer', async () => {
    const application = await boot();
    const sales = await makeUser(
      application,
      'identity-store',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const created = await request(application.getHttpServer())
      .post('/customers')
      .set(bearer(sales.accessToken))
      .send({
        customerType: 'INDIVIDUAL',
        givenName: 'Stored',
        familyName: 'Discriminators',
        nationalId: '9901012345',
        contactPhone: '+962-7-9000-0000',
        contactEmail: 'customer@example.test',
        languagePreference: 'AR',
        dateOfBirth: '1985-03-17',
        nationality: 'JO',
      })
      .expect(201);

    const body = created.body as {
      id: string;
      dateOfBirth: string;
      nationality: string;
    };
    expect(body.nationality).toBe('JO');
    // Not shifted by a timezone: the column is a DATE and the value is parsed
    // at midnight UTC.
    expect(body.dateOfBirth.slice(0, 10)).toBe('1985-03-17');

    const stored = await prisma.customer.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(stored.dateOfBirth?.toISOString().slice(0, 10)).toBe('1985-03-17');
    expect(stored.nationality).toBe('JO');
  });
});

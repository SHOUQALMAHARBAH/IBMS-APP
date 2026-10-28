import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/**
 * THE OWNER'S NARROW STRIKE OF HER OWN 2026-09-28 DEFERRAL — both halves, over real HTTP.
 *
 * Her ruling of 2026-10-28: `dateOfBirth` and `nationality` become correctable through
 * `CustomerIdentifierCorrection`; the other six identifiers stay exactly as the deferral left them.
 * Then date of birth and nationality become MANDATORY before `SUBMITTED` for an individual.
 *
 * ## WHY THE TWO HALVES ARE ASSERTED IN ONE FILE
 *
 * Because they are one decision and shipping either alone is a defect. The gate without the
 * correction route makes every customer already on file permanently un-submittable — the owner's own
 * words: *"Shipping the gate alone is not an option, even as a step."* And the correction route
 * without the gate is a capability nothing requires. A file that proves one and not the other would
 * pass while half the decision was missing.
 *
 * ## WHAT IS ASSERTED AS AN ABSENCE, AND WHY THAT MATTERS MOST HERE
 *
 * The 2026-09-28 deferral's safety condition 1 is *the screening identifiers stay uneditable*, and
 * the strike opens TWO of eight. So the ABSENCE of the other six is the thing the strike's safety
 * rests on, and it is asserted one field at a time on the contact route — because a single request
 * carrying all six would pass if only ONE were still refused.
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
interface CustomerBody {
  id: string;
  customerType: string;
  legalName: string;
  dateOfBirth: string | null;
  nationality: string | null;
}
interface CorrectionBody extends CustomerBody {
  rescreened: boolean;
}
interface KycRecordBody {
  id: string;
  status: string;
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
/** A value unique to THIS RUN. db-test is cumulative, and `POST /customers` pre-checks the canonical
 *  person name and answers 409 — so a fixed name passes once and 409s for ever after. */
function runId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

let sharedApp: INestApplication<App> | undefined;
async function boot(): Promise<INestApplication<App>> {
  if (!sharedApp) sharedApp = await createTestApp();
  return sharedApp;
}

async function makeUser(
  app: INestApplication<App>,
  label: string,
  role?: RoleName,
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Identifier Correction User', email, password: PASSWORD })
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

  if (role) {
    const roleRow = await ensureRole(role);
    const active = await prisma.userRoleAssignment.findFirst({
      where: { userId: user.id, roleId: roleRow.id, revokedAt: null },
    });
    if (!active) {
      await prisma.userRoleAssignment.create({
        data: { userId: user.id, roleId: roleRow.id },
      });
    }
  }
  return { accessToken, userId: user.id };
}

/** An individual WITH both discriminators — the ordinary state. 839 of dev's 840 individuals. */
async function makeIndividual(
  app: INestApplication<App>,
  accessToken: string,
  label: string,
  identifiers: { dateOfBirth?: string; nationality?: string } = {
    dateOfBirth: '1990-01-01',
    nationality: 'JO',
  },
): Promise<CustomerBody> {
  const res = await request(app.getHttpServer())
    .post('/customers')
    .set(bearer(accessToken))
    .send({
      customerType: 'INDIVIDUAL',
      givenName: label,
      familyName: `Ident${runId()}`,
      nationalId: '9901012345',
      contactPhone: '+962-7-9000-0000',
      contactEmail: uniqueEmail('ident-customer'),
      languagePreference: 'AR',
      ...identifiers,
    })
    .expect(201);
  return res.body as CustomerBody;
}

async function startKyc(
  app: INestApplication<App>,
  accessToken: string,
  customerId: string,
): Promise<KycRecordBody> {
  const res = await request(app.getHttpServer())
    .post(`/customers/${customerId}/kyc`)
    .set(bearer(accessToken))
    .expect(201);
  return res.body as KycRecordBody;
}

describe("the owner's narrow strike: correcting a date of birth and a nationality", () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('corrects both fields, records the before and after, and re-screens', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'ident-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const customer = await makeIndividual(app, sales.accessToken, 'Corrected');
    const kyc = await startKyc(app, sales.accessToken, customer.id);

    // The screening answer this correction will supersede. `priorScreeningResultId` is
    // `onDelete: Restrict` precisely so it survives as evidence.
    await request(app.getHttpServer())
      .post(`/kyc-records/${kyc.id}/submit`)
      .set(bearer(sales.accessToken))
      .expect(201);
    const compliance = await makeUser(
      app,
      'ident-compliance',
      'COMPLIANCE_OFFICER',
    );
    await request(app.getHttpServer())
      .post(`/kyc-records/${kyc.id}/run-screening`)
      .set(bearer(compliance.accessToken))
      .expect(201);
    const priorResults = await prisma.screeningResult.count({
      where: { kycRecordId: kyc.id },
    });
    expect(
      priorResults,
      'the fixture must have a prior screening result, or the evidence half of this test is vacuous',
    ).toBeGreaterThan(0);

    const res = await request(app.getHttpServer())
      .patch(`/customers/${customer.id}/identifiers`)
      .set(bearer(sales.accessToken))
      .send({
        dateOfBirth: '1988-06-21',
        nationality: 'SY',
        reason:
          'Passport copy received; the onboarding entry transposed the year.',
      })
      .expect(200);
    const body = res.body as CorrectionBody;

    expect(body.dateOfBirth?.slice(0, 10)).toBe('1988-06-21');
    expect(body.nationality).toBe('SY');
    expect(
      body.rescreened,
      'the correction did not re-screen. That is the property the owner\'s strike of her own deferral rests on — the AMLU requires a screen "Upon ... CHANGES TO A CUSTOMER\'S INFORMATION".',
    ).toBe(true);

    // ONE ROW PER FIELD, each carrying the evidence.
    const rows = await prisma.customerIdentifierCorrection.findMany({
      where: { customerId: customer.id },
      orderBy: { field: 'asc' },
    });
    expect(rows.map((r) => r.field)).toEqual(['dateOfBirth', 'nationality']);
    for (const row of rows) {
      expect(row.reason).toContain('Passport copy received');
      expect(row.correctedByUserId).toBe(sales.userId);
      expect(
        row.kycRecordId,
        'the correction row does not name the KYC file it invalidated',
      ).toBe(kyc.id);
      expect(
        row.kycStatusBefore,
        "the correction row does not record what the file's status was",
      ).not.toBeNull();
      expect(
        row.priorScreeningResultId,
        'the correction row does not point at the screening answer it supersedes — that row is the evidence a previously-matching subject stopped matching',
      ).not.toBeNull();
      expect(
        row.newScreeningResultId,
        'the correction row does not point at the re-screen it triggered',
      ).not.toBeNull();
      // ENCRYPTED, both sides. The before value is read back here where the contact path
      // deliberately does not read it: these two are in the clear on the Customer row, so there is
      // no decrypt-and-re-encrypt round trip to avoid.
      expect(
        row.beforeValueEnc,
        'the before value was not recorded',
      ).not.toBeNull();
      expect(
        row.afterValueEnc,
        'the after value was not recorded',
      ).not.toBeNull();
      expect(
        row.afterValueEnc,
        'the corrected value is stored in the CLEAR in the correction row',
      ).not.toContain('1988-06-21');
    }

    // THE AUDIT ROW NAMES THE FIELDS AND NEVER THE VALUES. `AuditLogEntry` is immutable by trigger,
    // so a date of birth written there is personal data an ERASURE REQUEST CAN NEVER REACH.
    const audit = await prisma.auditLogEntry.findFirst({
      where: {
        entityType: 'Customer',
        entityId: customer.id,
        action: 'UPDATE',
      },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit, 'the correction wrote no audit row').not.toBeNull();
    const snapshot = JSON.stringify(audit?.afterValue ?? {});
    expect(snapshot).toContain('dateOfBirth');
    expect(
      snapshot,
      'the audit snapshot carries the corrected DATE — immutable personal data an erasure can never reach',
    ).not.toContain('1988-06-21');
    expect(
      snapshot,
      'the audit snapshot carries the corrected NATIONALITY',
    ).not.toContain('"SY"');
  });

  it('refuses a reason below the declaration floor, and whitespace does not satisfy it', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'ident-floor',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const customer = await makeIndividual(app, sales.accessToken, 'Floor');

    // NO REASON AT ALL — and this assertion exists because a plant killed NOTHING without it.
    // `the-reason-becomes-optional` adds `@IsOptional()` to the field, and that decorator only
    // skips a value that is ABSENT: a short reason and a whitespace reason are both still refused
    // by `@Length`, so neither case below could see it. SEVEN of seven passed with the mandatory
    // reason gone — which means the property the AMLU retention requirement rests on had no
    // observer anywhere in the suite.
    await request(app.getHttpServer())
      .patch(`/customers/${customer.id}/identifiers`)
      .set(bearer(sales.accessToken))
      .send({ nationality: 'SY' })
      .expect(400);

    // NINE characters, not zero. A test that only sends an empty reason cannot tell a ten-character
    // floor from a non-empty check.
    await request(app.getHttpServer())
      .patch(`/customers/${customer.id}/identifiers`)
      .set(bearer(sales.accessToken))
      .send({ nationality: 'SY', reason: 'too short' })
      .expect(400);

    // TEN SPACES. `@Transform(trimIfString)` runs BEFORE `@Length`, which is the whole point — the
    // DSR intake shipped the other order one batch ago and stored an empty request.
    await request(app.getHttpServer())
      .patch(`/customers/${customer.id}/identifiers`)
      .set(bearer(sales.accessToken))
      .send({ nationality: 'SY', reason: '          ' })
      .expect(400);

    const rows = await prisma.customerIdentifierCorrection.count({
      where: { customerId: customer.id },
    });
    expect(rows, 'a refused correction wrote a row').toBe(0);
  });

  it('refuses the other six identifiers ONE AT A TIME, on both routes', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'ident-six',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const customer = await makeIndividual(app, sales.accessToken, 'Six');

    // SAFETY CONDITION 1, still holding after the strike. One field per request: a single body
    // carrying all six would pass if only ONE were refused.
    for (const body of [
      { legalName: 'Renamed Person' },
      { givenName: 'Renamed' },
      { fatherName: 'Renamed' },
      { grandfatherName: 'Renamed' },
      { familyName: 'Renamed' },
      { nationalId: '1111111111' },
      { registrationNumber: 'REG-1' },
    ]) {
      await request(app.getHttpServer())
        .patch(`/customers/${customer.id}`)
        .set(bearer(sales.accessToken))
        .send({ ...body, contactPhone: '+962-7-9000-0001' })
        .expect(400);
      // And on the NEW route too, which is the half a reader would assume rather than check.
      await request(app.getHttpServer())
        .patch(`/customers/${customer.id}/identifiers`)
        .set(bearer(sales.accessToken))
        .send({
          ...body,
          nationality: 'SY',
          reason: 'Attempting an identifier the deferral still covers.',
        })
        .expect(400);
    }
  });

  it('refuses a corporate customer — a company has no date of birth of its own', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'ident-corp',
      'SALES_RELATIONSHIP_OFFICER',
    );

    const corporate = await request(app.getHttpServer())
      .post('/customers')
      .set(bearer(sales.accessToken))
      .send({
        customerType: 'CORPORATE',
        legalName: `Ident Corp ${runId()}`,
        registrationNumber: `REG-${runId()}`,
        natureOfBusiness: 'Trading',
        contactPhone: '+962-6-5000-000',
        contactEmail: uniqueEmail('ident-corp'),
        languagePreference: 'AR',
        registeredAddress: 'Amman',
      })
      .expect(201);
    const corporateId = (corporate.body as CustomerBody).id;
    await request(app.getHttpServer())
      .patch(`/customers/${corporateId}/identifiers`)
      .set(bearer(sales.accessToken))
      .send({
        nationality: 'JO',
        reason: 'A company has no nationality of its own.',
      })
      .expect(422);
  });

  /*
   * ITS OWN TEST, and that is a correction from the plant run rather than a preference. The
   * corporate refusal and this one shared a test, so `a-no-change-correction-is-accepted` and
   * `a-company-may-carry-a-date-of-birth` both failed it with the identical message — `expected
   * 422, got 200` — and the run could not say which refusal had been removed. One-at-a-time is
   * pointless if the failure cannot name WHICH, which is the lesson the DSR intake's three
   * refusals paid for one batch ago.
   */
  it('refuses a correction in which every value sent is already on the record', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'ident-nochange',
      'SALES_RELATIONSHIP_OFFICER',
    );

    // A row reading "corrected JO to JO" is a false record in the one table that exists to be
    // justifiable, and it would re-screen for an answer that cannot differ.
    const individual = await makeIndividual(app, sales.accessToken, 'NoChange');
    await request(app.getHttpServer())
      .patch(`/customers/${individual.id}/identifiers`)
      .set(bearer(sales.accessToken))
      .send({
        dateOfBirth: '1990-01-01',
        nationality: 'JO',
        reason: 'Re-sending exactly what is already on the record.',
      })
      .expect(422);
    expect(
      await prisma.customerIdentifierCorrection.count({
        where: { customerId: individual.id },
      }),
    ).toBe(0);
  });

  it('refuses a submit without either field, naming the one that is missing', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'ident-gate',
      'SALES_RELATIONSHIP_OFFICER',
    );

    // No date of birth, nationality present — so the refusal must name ONE field, not both. A
    // fixture missing both cannot tell a message that names what is missing from one that lists
    // everything the rule covers.
    const customer = await makeIndividual(app, sales.accessToken, 'Gated', {
      nationality: 'JO',
    });
    const kyc = await startKyc(app, sales.accessToken, customer.id);

    const refused = await request(app.getHttpServer())
      .post(`/kyc-records/${kyc.id}/submit`)
      .set(bearer(sales.accessToken))
      .expect(422);
    const message = JSON.stringify(refused.body);
    // SCOPED TO THE SLOT, not the whole body — and that correction came from the run. The
    // message names what is missing and THEN explains the rule, which mentions both fields by
    // design ("...on the name together with the date of birth and nationality"). A page-wide
    // `not.toContain('nationality')` therefore fails on a CORRECT message, which is the
    // too-broad-absence-assertion shape this repository has paid for repeatedly.
    expect(message).toContain('without dateOfBirth.');
    expect(
      message,
      'the refusal lists every field the rule covers rather than the one that is missing, so a reader cannot tell what to fix',
    ).not.toContain('without dateOfBirth and nationality');
    expect(
      message,
      'the refusal does not name the route that fixes it — the gate could not ship without that route and must say so',
    ).toContain('/identifiers');

    // THE SECOND HALF OF THE DECISION: the correction route clears the refusal. Without this
    // assertion the gate is proven and the thing that makes it survivable is not.
    await request(app.getHttpServer())
      .patch(`/customers/${customer.id}/identifiers`)
      .set(bearer(sales.accessToken))
      .send({
        dateOfBirth: '1992-02-29',
        reason: 'Date of birth taken from the passport copy on file.',
      })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/kyc-records/${kyc.id}/submit`)
      .set(bearer(sales.accessToken))
      .expect(201);
  });

  it('lets a CORPORATE file submit with neither field — the gate is individual-only', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'ident-corp-gate',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const corporate = await request(app.getHttpServer())
      .post('/customers')
      .set(bearer(sales.accessToken))
      .send({
        customerType: 'CORPORATE',
        legalName: `Ident Corp Gate ${runId()}`,
        registrationNumber: `REG-${runId()}`,
        natureOfBusiness: 'Trading',
        contactPhone: '+962-6-5000-001',
        contactEmail: uniqueEmail('ident-corp-gate'),
        languagePreference: 'AR',
        registeredAddress: 'Amman',
      })
      .expect(201);
    const kyc = await startKyc(
      app,
      sales.accessToken,
      (corporate.body as CustomerBody).id,
    );
    await request(app.getHttpServer())
      .post(`/kyc-records/${kyc.id}/submit`)
      .set(bearer(sales.accessToken))
      .expect(201);
  });

  it('answers a statutory CORRECTION request, which was unanswerable for these two fields', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'ident-dsr',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const dpo = await makeUser(app, 'ident-dpo', 'DATA_PROTECTION_OFFICER');
    const customer = await makeIndividual(app, sales.accessToken, 'Statutory');

    const logged = await request(app.getHttpServer())
      .post('/dsr')
      .set(bearer(dpo.accessToken))
      .send({
        // `type`, not `requestType` — the DTO's own field name, copied from `dsr.e2e-spec.ts`
        // rather than from the Prisma column.
        type: 'CORRECTION',
        customerId: customer.id,
        requestText: 'My date of birth is recorded wrongly; please correct it.',
        intakeChannel: 'WEBSITE_FORM',
      })
      .expect(201);
    const dsrId = (logged.body as { id: string }).id;

    await request(app.getHttpServer())
      .patch(`/customers/${customer.id}/identifiers`)
      .set(bearer(sales.accessToken))
      .send({
        dateOfBirth: '1979-11-02',
        reason: "Corrected on the data subject's own written request.",
        answersRequestType: 'dsr',
        answersRequestId: dsrId,
      })
      .expect(200);

    // `DsrService.fulfil` counts corrections against the request. Before this route, a correction
    // request about a date of birth could be neither answered nor closed.
    const linked = await prisma.customerIdentifierCorrection.count({
      where: { dsrId, field: 'dateOfBirth' },
    });
    expect(
      linked,
      'the correction is not linked to the request it answers, so the closure gate cannot see it',
    ).toBe(1);
  });
});

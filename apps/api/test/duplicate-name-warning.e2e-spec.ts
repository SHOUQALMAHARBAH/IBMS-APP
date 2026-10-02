import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/**
 * LAYER 1's RECORD, asserted on the ROW and not on the response.
 *
 * The screen's three Playwright tests prove the officer is asked and that the answer leaves the
 * browser. They cannot prove it was stored: a create returns 201 whether the warning row was written or
 * not, because writing it is best-effort by design — the customer is already committed and failing the
 * request would report a failure for work that succeeded.
 *
 * So the claim "the answer is recorded" has to be read back from the table, which is what this file
 * does. Four properties:
 *
 *   1. THE ORDERED KEY IS WHAT WARNS. Two cousins sharing three of four name parts must NOT match each
 *      other — that is the whole reason this key is separate from the insurer directory's sorted one,
 *      and it was measured before either was built (sorted: 15 individuals folded, 8 cousin pairs
 *      among them; ordered: 7 folded, 0 cousins).
 *   2. AN ANSWERED CREATE WRITES A ROW NAMING THE CUSTOMER.
 *   3. AN ABANDONED CREATE WRITES A ROW WITH NO CUSTOMER — the null that is the finding.
 *   4. AN ORDINARY CREATE WRITES NOTHING. Without this the measurement would count every create in the
 *      office, and `fired` would answer a question nobody asked.
 */
const PASSWORD = 'Correct-Horse-Battery-Staple-9';

let sharedApp: INestApplication<App> | undefined;
async function boot(): Promise<INestApplication<App>> {
  if (!sharedApp) sharedApp = await createTestApp();
  return sharedApp;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function runId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return match[1];
}

async function makeUser(
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const app = await boot();
  const email = `${label}-${runId()}@ibms.test`;
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Duplicate warning e2e', email, password: PASSWORD })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const { accessToken, user } = login.body as {
    accessToken: string;
    user: { id: string };
  };

  const enroll = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const enrollBody = enroll.body as {
    credentialId: string;
    otpAuthUri: string;
  };
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
    const active = await prisma.userRoleAssignment.findFirst({
      where: { userId: user.id, roleId: role.id, revokedAt: null },
    });
    if (!active) {
      await prisma.userRoleAssignment.create({
        data: { userId: user.id, roleId: role.id },
      });
    }
  }
  return { accessToken, userId: user.id };
}

interface DuplicateCheck {
  canonicalKey: string;
  matches: { id: string; legalName: string; status: string }[];
}

describe('Duplicate-name warning (e2e) — the answer is on the record, not just on the request', () => {
  afterAll(async () => {
    await sharedApp?.close();
    sharedApp = undefined;
  });

  it('warns on the same person, NOT on a cousin, and records both answers', async () => {
    const app = await boot();
    const sales = await makeUser('dup-warning', 'SALES_RELATIONSHIP_OFFICER');
    const id = runId();

    // A name unique to this run. db-test is cumulative, so every assertion below is scoped to these
    // names and these ids — a global count would break on run order.
    const given = `Ahmad${id}`;
    const family = `Fulani${id}`;
    const fullName = `${given} ${family}`;

    const createBody = {
      customerType: 'INDIVIDUAL',
      givenName: given,
      familyName: family,
      nationalId: `99${id}`.slice(0, 12),
      nationality: 'JO',
      dateOfBirth: '1990-01-01',
      contactPhone: '+962790000000',
      contactEmail: `dup-${id}@example.test`,
      languagePreference: 'EN',
    };

    // STEP 1 — nothing of that name yet, so no warning. The negative witness: without it every
    // assertion below passes on a route that warns about everybody.
    const first = await request(app.getHttpServer())
      .get('/customers/duplicate-name-check')
      .query({ legalName: fullName })
      .set(bearer(sales.accessToken))
      .expect(200);
    expect((first.body as DuplicateCheck).matches).toEqual([]);

    // STEP 2 — an ORDINARY create, with no answer attached.
    const created = await request(app.getHttpServer())
      .post('/customers')
      .set(bearer(sales.accessToken))
      .send(createBody)
      .expect(201);
    const firstCustomerId = (created.body as { id: string }).id;

    // 4 — AN ORDINARY CREATE RECORDS NOTHING.
    expect(
      await prisma.duplicateNameWarning.count({
        where: { createdCustomerId: firstCustomerId },
      }),
    ).toBe(0);

    // STEP 3 — the same name now warns, and NAMES the customer.
    const second = await request(app.getHttpServer())
      .get('/customers/duplicate-name-check')
      .query({ legalName: fullName })
      .set(bearer(sales.accessToken))
      .expect(200);
    const check = second.body as DuplicateCheck;
    expect(check.matches.map((m) => m.id)).toContain(firstCustomerId);

    // 1 — A COUSIN IS NOT A MATCH. Same family name, same father, different given name: the realistic
    // near-collision in this product's own seeded data, and the case the SORTED key gets wrong. If this
    // fails, the route is keyed on the sorted key and the warning will fire on people who are not the
    // person being entered — which trains an office to click past it.
    const cousin = await request(app.getHttpServer())
      .get('/customers/duplicate-name-check')
      .query({ legalName: `Omar${id} ${family}` })
      .set(bearer(sales.accessToken))
      .expect(200);
    expect((cousin.body as DuplicateCheck).matches).toEqual([]);

    // STEP 4 — a SECOND create carrying "a different person". Layer 1 does not prevent.
    const answered = await request(app.getHttpServer())
      .post('/customers')
      .set(bearer(sales.accessToken))
      .send({
        ...createBody,
        nationalId: `88${id}`.slice(0, 12),
        contactEmail: `dup2-${id}@example.test`,
        duplicateNameSamePerson: false,
        duplicateNameMatchCount: check.matches.length,
      })
      .expect(201);
    const secondCustomerId = (answered.body as { id: string }).id;

    // 2 — THE ROW EXISTS AND NAMES THE CUSTOMER. Read back from the table, because the 201 above is
    // returned whether or not the row was written.
    const row = await prisma.duplicateNameWarning.findFirst({
      where: { createdCustomerId: secondCustomerId },
    });
    if (!row)
      throw new Error('no DuplicateNameWarning row for the answered create');
    expect(row.samePerson).toBe(false);
    expect(row.matchCount).toBe(check.matches.length);
    expect(row.actorUserId).toBe(sales.userId);
    // The key is the ORDERED one, so it must not be alphabetised.
    expect(row.canonicalKey.startsWith(given.toLowerCase())).toBe(true);

    // STEP 5 — the ABANDONED create: the officer recognised the person and wrote nothing.
    await request(app.getHttpServer())
      .post('/customers/duplicate-name-abandoned')
      .set(bearer(sales.accessToken))
      .send({ legalName: fullName, matchCount: 2 })
      .expect(201);

    // 3 — THE NULL IS THE FINDING. A row with no customer behind it is the outcome the warning exists
    // to produce, and the only one a flag on `Customer` could never hold.
    const abandoned = await prisma.duplicateNameWarning.findMany({
      where: {
        actorUserId: sales.userId,
        samePerson: true,
        createdCustomerId: null,
      },
    });
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0].matchCount).toBe(2);

    // Only ever TWO rows for this officer across five steps — the ordinary create wrote none.
    expect(
      await prisma.duplicateNameWarning.count({
        where: { actorUserId: sales.userId },
      }),
    ).toBe(2);
  });

  it('refuses an empty name rather than warning about everybody', async () => {
    const app = await boot();
    const sales = await makeUser(
      'dup-warning-empty',
      'SALES_RELATIONSHIP_OFFICER',
    );
    // A whitespace-only query is the trap: `@Transform(trimIfString)` runs first, so this must fail the
    // floor rather than reach the key as a match-everything value.
    await request(app.getHttpServer())
      .get('/customers/duplicate-name-check')
      .query({ legalName: '   ' })
      .set(bearer(sales.accessToken))
      .expect(400);
  });

  it('is gated on customer.create, not on customer.read', async () => {
    // A reader who cannot create a customer has no use for an exact "is this person on the book"
    // lookup, and handing it to every holder of the read is a narrower version of the directory problem
    // the search route was built to close. EXTERNAL_AUDITOR is read-only by construction.
    const app = await boot();
    const auditor = await makeUser('dup-warning-403', 'EXTERNAL_AUDITOR');
    await request(app.getHttpServer())
      .get('/customers/duplicate-name-check')
      .query({ legalName: 'Anybody At All' })
      .set(bearer(auditor.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .post('/customers/duplicate-name-abandoned')
      .set(bearer(auditor.accessToken))
      .send({ legalName: 'Anybody At All', matchCount: 1 })
      .expect(403);
  });
});

/**
 * THE THREE INDEXES ANSWER 409, NOT 500 — and the message names the right thing.
 *
 * Migration `20261107100000` is the hard half of duplicate prevention: a company's registration number
 * per office, a beneficial owner per customer, an ACTIVE employee per office. All three work, and all
 * three arrived WITHOUT a P2002 mapping — so the first duplicate a real office creates returned
 * `500 Internal Server Error`, which tells somebody the system is broken when their only mistake was
 * entering a colleague twice.
 *
 * `POST /customers` was worse than missing: its catch reported *"Prospect <id> has already been
 * converted to a Customer"* for ANY P2002, so a duplicate registration number sent an officer to look
 * at a prospect that had nothing to do with it — and at a prospect named `undefined` when no prospect
 * was involved. A catch-all written when `prospectId` was the table's only unique constraint.
 *
 * Found by this suite's own fixtures the day the indexes landed. Asserted on the STATUS and on the
 * message, because a 409 carrying the prospect sentence is the defect with a tidier status code.
 */
describe('Duplicate-prevention indexes (e2e) — a 409 that names the right thing', () => {
  afterAll(async () => {
    await sharedApp?.close();
    sharedApp = undefined;
  });

  it('refuses a second company with the same registration number, and does NOT blame a prospect', async () => {
    const app = await boot();
    const sales = await makeUser('dup-reg', 'SALES_RELATIONSHIP_OFFICER');
    const id = runId();
    const registrationNumber = `CR-DUP-${id}`;

    const body = {
      customerType: 'CORPORATE',
      legalName: `First Co ${id}`,
      registrationNumber,
      registeredAddress: 'Amman',
      natureOfBusiness: 'Trading',
      contactPhone: '+962790000000',
      contactEmail: `first-${id}@example.test`,
      languagePreference: 'AR',
    };

    await request(app.getHttpServer())
      .post('/customers')
      .set(bearer(sales.accessToken))
      .send(body)
      .expect(201);

    // A DIFFERENT NAME, the SAME number — the realistic case, and the one the key is for: an office
    // re-enters a company whose name was retyped.
    const refused = await request(app.getHttpServer())
      .post('/customers')
      .set(bearer(sales.accessToken))
      .send({
        ...body,
        legalName: `Retyped Co ${id}`,
        contactEmail: `second-${id}@example.test`,
      })
      .expect(409);

    const message = (refused.body as { message: string }).message;
    expect(message).toContain('registration number');
    // THE OLD CATCH-ALL IS GONE. Without this the test passes on the version that answers 409 with a
    // sentence about a prospect nobody mentioned.
    expect(message).not.toContain('Prospect');
    expect(message).not.toContain('undefined');
  });

  it('refuses a second beneficial owner of the same name against one customer', async () => {
    const app = await boot();
    const sales = await makeUser('dup-ubo', 'SALES_RELATIONSHIP_OFFICER');
    const id = runId();

    const created = await request(app.getHttpServer())
      .post('/customers')
      .set(bearer(sales.accessToken))
      .send({
        customerType: 'CORPORATE',
        legalName: `UBO Holder ${id}`,
        registrationNumber: `CR-UBO-${id}`,
        registeredAddress: 'Amman',
        natureOfBusiness: 'Trading',
        contactPhone: '+962790000000',
        contactEmail: `ubo-${id}@example.test`,
        languagePreference: 'AR',
      })
      .expect(201);
    const customerId = (created.body as { id: string }).id;

    const ubo = {
      givenName: `Layla${id}`,
      familyName: `Haddad${id}`,
      nationalId: `77${id}`.slice(0, 12),
      nationality: 'JO',
      dateOfBirth: '1985-05-05',
      ownershipPercent: 40,
      isPep: false,
    };
    await request(app.getHttpServer())
      .post(`/customers/${customerId}/ubos`)
      .set(bearer(sales.accessToken))
      .send(ubo)
      .expect(201);

    // The same person again — a different national ID, so only the NAME key can catch it. That is the
    // point: the number is encrypted with a random IV per value and cannot be compared.
    const refused = await request(app.getHttpServer())
      .post(`/customers/${customerId}/ubos`)
      .set(bearer(sales.accessToken))
      .send({ ...ubo, nationalId: `66${id}`.slice(0, 12) })
      .expect(409);
    expect((refused.body as { message: string }).message).toContain(
      'beneficial owner',
    );
  });
});

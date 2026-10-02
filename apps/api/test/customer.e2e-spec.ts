import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

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
  status: string;
  nationalId: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}
interface KycRecordBody {
  id: string;
  status: string;
  isEdd: boolean;
  customerId: string;
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

async function signupAndLogin(
  app: INestApplication<App>,
  email: string,
): Promise<{ accessToken: string; userId: string }> {
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Customer Test User', email, password: PASSWORD })
    .expect(201);
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = res.body as IssuedSessionBody;
  return { accessToken: body.accessToken, userId: body.user.id };
}

async function enrollMfa(
  app: INestApplication<App>,
  accessToken: string,
): Promise<void> {
  const enroll = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  const secret = secretFromOtpAuthUri(enrollBody.otpAuthUri);
  await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secret),
    })
    .expect(200);
}

async function grantRole(userId: string, roleName: RoleName): Promise<void> {
  const role = await ensureRole(roleName);
  const activeGrant = await prisma.userRoleAssignment.findFirst({
    where: { userId, roleId: role.id, revokedAt: null },
  });
  if (!activeGrant) {
    await prisma.userRoleAssignment.create({
      data: { userId, roleId: role.id },
    });
  }
}

/**
 * A value unique to THIS RUN, for any fixture a unique index now constrains.
 *
 * `REG-001` and `REG-002` were fixed literals against a CUMULATIVE database, so every run added another
 * row holding the same number — ten of each by 2026-10-01, which is what blocked migration
 * 20261107100000's pre-flight check locally. The index is correct and the fixture was wrong: a fixed
 * value plus a new unique constraint is a test that passes exactly once.
 *
 * Identical lesson to the holiday fixture, which created holidays on fixed DATES and hit the
 * one-per-date constraint on its second local run — a test-hygiene failure wearing the costume of a
 * permission defect.
 */
function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function makeUser(
  app: INestApplication<App>,
  label: string,
  role?: RoleName,
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  const { accessToken, userId } = await signupAndLogin(app, email);
  await enrollMfa(app, accessToken);
  if (role) await grantRole(userId, role);
  return { accessToken, userId };
}

/** Part F item #4 — an INDIVIDUAL customer's `legalName` is now computed
 * server-side from 4 national-ID-convention parts, not accepted directly
 * (see CustomerTypeFieldCoherence). This helper keeps every existing
 * caller's single display-name string working unchanged by splitting it on
 * the first space into givenName/familyName — `composeFullName()` rejoins
 * them with a single space, so the resulting `legalName` is byte-identical
 * to the string passed in, which every caller's own assertions (including
 * the EDD watchlist-match test's exact-string match) still depend on. */
async function createIndividualCustomer(
  app: INestApplication<App>,
  accessToken: string,
  legalName: string,
): Promise<CustomerBody> {
  const [givenName, ...rest] = legalName.split(' ');
  const familyName = rest.join(' ');
  const res = await request(app.getHttpServer())
    .post('/customers')
    .set(bearer(accessToken))
    .send({
      customerType: 'INDIVIDUAL',
      givenName,
      familyName,
      nationalId: '9901012345',
      contactPhone: '+962-7-9000-0000',
      contactEmail: 'customer@example.test',
      languagePreference: 'AR',
    })
    .expect(201);
  return res.body as CustomerBody;
}

/**
 * One obviously fictional `WatchlistEntry`, so the built-in screening provider
 * has a POPULATED list to report "no match" against.
 *
 * Added when Part B §17 (workflow holds) landed. Before it, this file's
 * "standard (no hit)" test passed only when db-test happened to carry entries
 * from some earlier run: with an empty cache the provider correctly answers
 * UNABLE_TO_SCREEN, which is now a REVIEW_REQUIRED hold and refuses the
 * approval. The test's own premise is "screened, and nothing was found", so
 * the fix is to make that premise true rather than to weaken the control —
 * and the test stops depending on ambient database state either way.
 */
async function seedWatchlistFixtureEntry(): Promise<void> {
  // Part B §6 — at most ONE generation per source may be PUBLISHED (a partial
  // unique index enforces it). A fixture that assumed an empty slate would hit
  // that constraint against any generation db-test already holds, so clear the
  // source first. Deleting the generation cascades to its rows.
  await prisma.watchlistDatasetVersion.deleteMany({
    where: { source: 'OFAC_SDN' },
  });
  await prisma.watchlistEntry.deleteMany({ where: { source: 'OFAC_SDN' } });
  const run = await prisma.watchlistSyncRun.create({
    data: {
      source: 'OFAC_SDN',
      status: 'succeeded',
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });
  // Part B §6 — an entry belongs to a GENERATION, and only a PUBLISHED
  // generation is visible to a screening. A fixture that skipped this would
  // insert rows no screening can see, and the test would silently assert
  // nothing.
  const version = await prisma.watchlistDatasetVersion.create({
    data: {
      source: 'OFAC_SDN',
      status: 'PUBLISHED',
      version: `OFAC_SDN@fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      recordCount: 1,
      downloadedAt: new Date(),
      validatedAt: new Date(),
      publishedAt: new Date(),
      syncRunId: run.id,
    },
  });
  await prisma.watchlistEntry.create({
    data: {
      source: 'OFAC_SDN',
      sourceRecordId: `e2e-customer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fullName: 'Zzz Fictional Screening Fixture',
      normalizedName: 'zzz fictional screening fixture',
      canonicalTokens: ['fictional', 'fixture', 'screening', 'zzz'],
      syncRunId: run.id,
      datasetVersionId: version.id,
    },
  });
}

describe('Customer Acquisition / Onboarding (e2e) — backlog Part C #3-4', () => {
  let app: INestApplication<App>;

  async function boot(): Promise<INestApplication<App>> {
    if (!app) app = await createTestApp();
    return app;
  }

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('PATCH /customers/:id — correcting contact details', () => {
    it('corrects a phone number, and REFUSES every screening identifier by construction', async () => {
      // IMPROVEMENTS § 3.14. A customer record had no update path at all, which is also why a PDPL
      // CORRECTION request could only be closed by a staff member attesting to a change the system gave
      // them no way to make.
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-correct-a',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customer = await createIndividualCustomer(
        app,
        sales.accessToken,
        'Correctable Customer',
      );

      // The half that works: three fields with no screening consequence.
      await request(app.getHttpServer())
        .patch(`/customers/${customer.id}`)
        .set(bearer(sales.accessToken))
        .send({ contactPhone: '+962-7-9111-1111' })
        .expect(200);

      // THE HALF THAT MATTERS MORE. Jordan's AMLU requires screening "upon KYC reviews or changes to a
      // customer's information", so a name or a date of birth is a screening event, not an edit:
      // https://amlu.gov.jo/EN/Pages/Frequently_Asked_Questions
      //
      // The DTO omits those fields, so `forbidNonWhitelisted` refuses them with a 400 naming the field.
      // Asserted one at a time rather than as a set, because a single request carrying all of them would
      // pass if only ONE were still rejected — and the refusal must hold for each.
      for (const forbidden of [
        { givenName: 'Renamed' },
        { familyName: 'Renamed' },
        { dateOfBirth: '1990-01-01' },
        { nationality: 'JO' },
        { nationalId: '9901019999' },
        { legalName: 'Renamed Entirely' },
      ]) {
        await request(app.getHttpServer())
          .patch(`/customers/${customer.id}`)
          .set(bearer(sales.accessToken))
          .send(forbidden)
          .expect(400);
      }

      // An empty correction is a 422, not a silent 200: "nothing to correct" and "corrected" must not look
      // the same to a caller answering a data subject.
      await request(app.getHttpServer())
        .patch(`/customers/${customer.id}`)
        .set(bearer(sales.accessToken))
        .send({})
        .expect(422);

      // An individual has no registered-address column, so accepting it and dropping it would be a field
      // that looks saved and is not.
      await request(app.getHttpServer())
        .patch(`/customers/${customer.id}`)
        .set(bearer(sales.accessToken))
        .send({ registeredAddress: 'Somewhere' })
        .expect(422);
    }, 180_000);

    it('is refused without customer.update, and 404s across owners', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-correct-b',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const claims = await makeUser(app, 'cust-correct-c', 'CLAIMS_OFFICER');
      const customer = await createIndividualCustomer(
        app,
        sales.accessToken,
        'Owned Customer',
      );

      // No `customer.update`.
      await request(app.getHttpServer())
        .patch(`/customers/${customer.id}`)
        .set(bearer(claims.accessToken))
        .send({ contactPhone: '+962-7-9222-2222' })
        .expect(403);

      // Another Sales officer HOLDS the permission and does not own this customer: 404, not 403, so the
      // refusal does not confirm the record exists.
      const other = await makeUser(
        app,
        'cust-correct-d',
        'SALES_RELATIONSHIP_OFFICER',
      );
      await request(app.getHttpServer())
        .patch(`/customers/${customer.id}`)
        .set(bearer(other.accessToken))
        .send({ contactPhone: '+962-7-9333-3333' })
        .expect(404);
    }, 180_000);
  });

  /** What `GET /customers/search` returns. Declared so `res.body` is not read as `any` — an untyped
   *  body is how a response-shape change stops being checked, which is what the file's other casts
   *  exist to prevent. */
  interface SearchRow {
    id: string;
    legalName: string;
    customerType: string;
    status: string;
    registrationNumber: string | null;
    taxRegistrationNumber: string | null;
  }

  describe('GET /customers/search — the one field that finds a named customer', () => {
    /**
     * The owner's four anti-browsing conditions, through real HTTP. Every one is asserted on the SERVER
     * rather than on the screen: a condition only the client enforces is a condition the next client
     * forgets, and this field's whole risk is that it becomes a customer directory by increments.
     */
    it('refuses an empty term and anything below three characters, with no "list everyone" mode', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-search-floor',
        'SALES_RELATIONSHIP_OFFICER',
      );

      // Condition 3 — nothing at all on an empty query. `q` is MANDATORY, so this is a 400 rather than
      // an unfiltered page, which is the whole difference from `GET /customers`.
      await request(app.getHttpServer())
        .get('/customers/search')
        .set(bearer(sales.accessToken))
        .expect(400);

      await request(app.getHttpServer())
        .get('/customers/search?q=')
        .set(bearer(sales.accessToken))
        .expect(400);

      // Condition 1 — below the floor.
      await request(app.getHttpServer())
        .get('/customers/search?q=ab')
        .set(bearer(sales.accessToken))
        .expect(400);

      // AND WHITESPACE IS THE TRAP: a bare `@IsString()` accepts three spaces, which then match
      // everything. `@Transform(trimIfString)` runs BEFORE validation, so this is a 400 and not a wide
      // scan of the book. Asserted separately from the empty case because they reach the floor by
      // different routes, and only one of them is obvious.
      await request(app.getHttpServer())
        .get('/customers/search?q=%20%20%20')
        .set(bearer(sales.accessToken))
        .expect(400);
    });

    it('finds a company by NAME and by REGISTRATION NUMBER, and records every search', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-search-find',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const reg = `RSRCH-${Date.now()}`;
      const name = `Yarmouk Search Test ${Date.now()}`;

      const created = await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(sales.accessToken))
        .send({
          customerType: 'CORPORATE',
          legalName: name,
          registrationNumber: reg,
          registeredAddress: 'Amman',
          natureOfBusiness: 'Trading',
          contactPhone: '+962-7-9999999',
          contactEmail: `search-${Date.now()}@example.test`,
          languagePreference: 'AR',
        })
        .expect(201);

      const byName = await request(app.getHttpServer())
        .get(`/customers/search?q=${encodeURIComponent('Yarmouk Search Test')}`)
        .set(bearer(sales.accessToken))
        .expect(200);
      expect((byName.body as SearchRow[]).map((r) => r.id)).toContain(
        (created.body as SearchRow).id,
      );

      // BY NUMBER — the clerk holding a document knows the number and not the spelling, which is the
      // owner's stated reason for this half of the field.
      const byNumber = await request(app.getHttpServer())
        .get(`/customers/search?q=${encodeURIComponent(reg)}`)
        .set(bearer(sales.accessToken))
        .expect(200);
      expect((byNumber.body as SearchRow[]).map((r) => r.id)).toContain(
        (created.body as SearchRow).id,
      );

      // The row is NARROWER than a list row: no contact fields, no screening discriminators, no owner.
      // Asserted as an absence of each ONE AT A TIME, because a single comparison of the whole object
      // would pass on a row carrying an extra field the moment the expected shape was widened.
      const row = (byNumber.body as SearchRow[]).find(
        (r) => r.id === (created.body as SearchRow).id,
      );
      // THROWN, not `row!`. A non-null assertion would silence the compiler and leave the six absence
      // assertions below running against `undefined` — where every one of them PASSES, because
      // `undefined` has no `contactPhone` either. That is the whole of this block proving nothing.
      if (row === undefined) {
        throw new Error(
          'the customer just created was not in its own search results — the assertions below would pass on undefined',
        );
      }
      expect(row.legalName).toBe(name);
      expect(row.registrationNumber).toBe(reg);
      expect(row).not.toHaveProperty('contactPhone');
      expect(row).not.toHaveProperty('contactEmail');
      expect(row).not.toHaveProperty('nationalId');
      expect(row).not.toHaveProperty('nationalIdEnc');
      expect(row).not.toHaveProperty('ownerUserId');
      expect(row).not.toHaveProperty('dateOfBirth');

      // CONDITION 4 — every search recorded, naming the term and what it matched. Scoped to this
      // actor rather than counted globally: db-test is cumulative.
      const compliance = await makeUser(
        app,
        'cust-search-audit',
        'COMPLIANCE_OFFICER',
      );
      const audit = await request(app.getHttpServer())
        .get(`/audit-trail?entityType=CustomerSearch&userId=${sales.userId}`)
        .set(bearer(compliance.accessToken))
        .expect(200);
      const auditBody = audit.body as {
        items: {
          afterValue: { term?: string } | null;
          isSensitiveDataAccess: boolean;
        }[];
      };
      const terms = auditBody.items.map((e) => e.afterValue?.term);
      expect(terms).toContain(reg);
      expect(auditBody.items.every((e) => e.isSensitiveDataAccess)).toBe(true);
    });

    it('CANNOT find a customer by national ID or phone — both carry a random IV per value', async () => {
      // THIS ASSERTS A DECISION, not a pending gap. The owner asked for an identity-number search and
      // then WITHDREW the requirement: making those columns searchable means a guessable encoding of a
      // Highly Confidential field, which is what the masked national ID exists to refuse — and the
      // document in a clerk's hand carries the NAME too, so nobody was blocked. A convenience does not
      // buy a weakening of that field's protection.
      //
      // So this test is the thing that stops a future reader "fixing" it. If it ever starts matching,
      // the encryption posture changed, and that has to be a decision rather than a side effect.
      //
      // What it does NOT settle is duplicate prevention, which needs the same equality test for DATA
      // INTEGRITY rather than for search comfort — a different question, measured in
      // `docs/customer-duplicate-prevention-measured.md`.
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-search-nid',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const nationalId = `9${Date.now()}`.slice(0, 10);
      const phone = '+962-7-7654321';

      const created = await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(sales.accessToken))
        .send({
          customerType: 'INDIVIDUAL',
          givenName: 'Searchable',
          familyName: 'Person',
          nationalId,
          contactPhone: phone,
          contactEmail: `nid-${Date.now()}@example.test`,
          languagePreference: 'AR',
        })
        .expect(201);

      const byNationalId = await request(app.getHttpServer())
        .get(`/customers/search?q=${encodeURIComponent(nationalId)}`)
        .set(bearer(sales.accessToken))
        .expect(200);
      expect((byNationalId.body as SearchRow[]).map((r) => r.id)).not.toContain(
        (created.body as SearchRow).id,
      );

      const byPhone = await request(app.getHttpServer())
        .get(`/customers/search?q=${encodeURIComponent(phone)}`)
        .set(bearer(sales.accessToken))
        .expect(200);
      expect((byPhone.body as SearchRow[]).map((r) => r.id)).not.toContain(
        (created.body as SearchRow).id,
      );

      // ANCHORED: the same customer IS findable by name, so the two absences above are the encryption
      // and not a search that returns nothing for an unrelated reason.
      const byName = await request(app.getHttpServer())
        .get('/customers/search?q=Searchable')
        .set(bearer(sales.accessToken))
        .expect(200);
      expect((byName.body as SearchRow[]).map((r) => r.id)).toContain(
        (created.body as SearchRow).id,
      );
    });

    it('discloses no more than the list: one officer cannot find another officer customer', async () => {
      // A search is a shortcut to the list, so it must disclose no more than the list. The owner filter
      // sits OUTSIDE the OR in the repository for exactly this: inside it, a registration-number match
      // would ignore it and hand over a colleague's record.
      const app = await boot();
      const mine = await makeUser(
        app,
        'cust-search-mine',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const theirs = await makeUser(
        app,
        'cust-search-theirs',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const reg = `XSRCH-${Date.now()}`;

      const created = await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(theirs.accessToken))
        .send({
          customerType: 'CORPORATE',
          legalName: `Colleague Only ${Date.now()}`,
          registrationNumber: reg,
          registeredAddress: 'Irbid',
          natureOfBusiness: 'Trading',
          contactPhone: '+962-7-1112222',
          contactEmail: `xs-${Date.now()}@example.test`,
          languagePreference: 'AR',
        })
        .expect(201);

      const byName = await request(app.getHttpServer())
        .get('/customers/search?q=Colleague')
        .set(bearer(mine.accessToken))
        .expect(200);
      expect((byName.body as SearchRow[]).map((r) => r.id)).not.toContain(
        (created.body as SearchRow).id,
      );

      const byNumber = await request(app.getHttpServer())
        .get(`/customers/search?q=${encodeURIComponent(reg)}`)
        .set(bearer(mine.accessToken))
        .expect(200);
      expect((byNumber.body as SearchRow[]).map((r) => r.id)).not.toContain(
        (created.body as SearchRow).id,
      );

      // ANCHORED on the OWNER finding it, so the two absences are the visibility rule rather than an
      // empty index. Without this, a search broken for everybody would satisfy both assertions above.
      const owner = await request(app.getHttpServer())
        .get(`/customers/search?q=${encodeURIComponent(reg)}`)
        .set(bearer(theirs.accessToken))
        .expect(200);
      expect((owner.body as SearchRow[]).map((r) => r.id)).toContain(
        (created.body as SearchRow).id,
      );

      // AND a holder of the all-owners read does find it, which is the other half of the same proof.
      const compliance = await makeUser(
        app,
        'cust-search-all',
        'COMPLIANCE_OFFICER',
      );
      const wide = await request(app.getHttpServer())
        .get(`/customers/search?q=${encodeURIComponent(reg)}`)
        .set(bearer(compliance.accessToken))
        .expect(200);
      expect((wide.body as SearchRow[]).map((r) => r.id)).toContain(
        (created.body as SearchRow).id,
      );
    });
  });

  describe('POST /customers', () => {
    it('is forbidden without customer.create (e.g. a Claims Officer)', async () => {
      const app = await boot();
      const claims = await makeUser(app, 'cust-claims', 'CLAIMS_OFFICER');
      await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(claims.accessToken))
        .send({
          customerType: 'INDIVIDUAL',
          legalName: 'Rejected',
          nationalId: '123',
          contactPhone: '+962-7-0000000',
          contactEmail: 'x@example.test',
          languagePreference: 'AR',
        })
        .expect(403);
    });

    it('rejects a CORPORATE customer with no registrationNumber (two distinct forms, validated)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-owner-a',
        'SALES_RELATIONSHIP_OFFICER',
      );
      await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(sales.accessToken))
        .send({
          customerType: 'CORPORATE',
          legalName: 'Missing Reg Co.',
          contactPhone: '+962-7-0000000',
          contactEmail: 'corp@example.test',
          languagePreference: 'EN',
        })
        .expect(400);
    });

    it('rejects a CORPORATE customer that carries a personal nationalId (the two forms stay mutually exclusive)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-owner-mix',
        'SALES_RELATIONSHIP_OFFICER',
      );
      await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(sales.accessToken))
        .send({
          customerType: 'CORPORATE',
          legalName: 'Mixed Form Co.',
          registrationNumber: 'REG-999',
          registeredAddress: 'Amman, Jordan',
          natureOfBusiness: 'Trading',
          nationalId: '9901012345',
          contactPhone: '+962-7-0000000',
          contactEmail: 'mixed@example.test',
          languagePreference: 'EN',
        })
        .expect(400);
    });

    it('creates an INDIVIDUAL customer and never returns the raw encrypted field — only a masked one', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-owner-b',
        'SALES_RELATIONSHIP_OFFICER',
      );

      const customer = await createIndividualCustomer(
        app,
        sales.accessToken,
        'Ahmad E2E Test',
      );

      expect(customer.status).toBe('PENDING_KYC');
      expect(customer).not.toHaveProperty('nationalIdEnc');
      // Masked: last 4 digits visible, rest starred — never the raw value.
      expect(customer.nationalId).not.toBe('9901012345');
      expect(customer.nationalId).toMatch(/\*+2345$/);
    });

    // Part F item #4 — Jordanian national-ID-convention name splitting.
    it('computes legalName from the 4 Jordanian national-ID-convention name parts on an INDIVIDUAL customer', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-owner-name-parts',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const res = await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(sales.accessToken))
        .send({
          customerType: 'INDIVIDUAL',
          givenName: 'Ahmad',
          fatherName: 'Mohammad',
          grandfatherName: 'Ali',
          familyName: 'Al-Sharif',
          nationalId: '9901012345',
          contactPhone: '+962-7-9000-0000',
          contactEmail: 'name-parts@example.test',
          languagePreference: 'AR',
        })
        .expect(201);
      const customer = res.body as CustomerBody & {
        givenName: string;
        fatherName: string;
        grandfatherName: string;
        familyName: string;
      };
      expect(customer.legalName).toBe('Ahmad Mohammad Ali Al-Sharif');
      expect(customer.givenName).toBe('Ahmad');
      expect(customer.fatherName).toBe('Mohammad');
      expect(customer.grandfatherName).toBe('Ali');
      expect(customer.familyName).toBe('Al-Sharif');
    });

    it("omits father's/grandfather's name from the computed legalName when they are not supplied", async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-owner-name-parts-min',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const res = await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(sales.accessToken))
        .send({
          customerType: 'INDIVIDUAL',
          givenName: 'Layla',
          familyName: 'Nassar',
          nationalId: '9901012399',
          contactPhone: '+962-7-9000-1111',
          contactEmail: 'name-parts-min@example.test',
          languagePreference: 'AR',
        })
        .expect(201);
      const customer = res.body as CustomerBody;
      expect(customer.legalName).toBe('Layla Nassar');
    });

    it('rejects an INDIVIDUAL customer that sends legalName directly (it is computed server-side from the 4 name parts)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-owner-individual-legalname',
        'SALES_RELATIONSHIP_OFFICER',
      );
      await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(sales.accessToken))
        .send({
          customerType: 'INDIVIDUAL',
          legalName: 'Should Be Rejected',
          nationalId: '9901012345',
          contactPhone: '+962-7-0000000',
          contactEmail: 'individual-legalname@example.test',
          languagePreference: 'AR',
        })
        .expect(400);
    });

    it('rejects a CORPORATE customer that carries the individual name-part fields', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-owner-corp-name-parts',
        'SALES_RELATIONSHIP_OFFICER',
      );
      await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(sales.accessToken))
        .send({
          customerType: 'CORPORATE',
          legalName: 'Should Be Rejected Co.',
          givenName: 'Should',
          familyName: 'Not Be Here',
          registrationNumber: 'REG-777',
          registeredAddress: 'Amman, Jordan',
          natureOfBusiness: 'Trading',
          contactPhone: '+962-7-0000000',
          contactEmail: 'corp-name-parts@example.test',
          languagePreference: 'EN',
        })
        .expect(400);
    });
  });

  // Part F item #6 — bilingual full-text search (Arabic + English) over
  // legalName. Each test proves REAL linguistic stemming, not substring
  // luck: the search term is never a literal substring of the stored
  // value (an English word stemmed by Postgres's 'english' config, an
  // Arabic singular form stemmed from a stored plural) — verified
  // directly against this Postgres build before writing these assertions.
  describe('GET /customers (search)', () => {
    it('finds a customer via a stemmed English search term ("trade" -> "Trading")', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-search-en',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const created = await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(sales.accessToken))
        .send({
          customerType: 'CORPORATE',
          legalName: `Al-Ufuq Trading Co. ${unique}`,
          registrationNumber: `REG-${unique}`,
          registeredAddress: 'Amman, Jordan',
          natureOfBusiness: 'Trading',
          contactPhone: '+962-7-0000001',
          contactEmail: `search-en-${unique}@example.test`,
          languagePreference: 'EN',
        })
        .expect(201);
      const customerId = (created.body as CustomerBody).id;

      const res = await request(app.getHttpServer())
        .get('/customers?search=trade')
        .set(bearer(sales.accessToken))
        .expect(200);
      const ids = (res.body as { items: CustomerBody[] }).items.map(
        (c) => c.id,
      );
      expect(ids).toContain(customerId);
    });

    it('finds a customer via a stemmed Arabic search term (singular matches a stored plural)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-search-ar',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const created = await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(sales.accessToken))
        .send({
          customerType: 'CORPORATE',
          legalName: `شركة الأفق للسيارات ${unique}`,
          registrationNumber: `REG-AR-${unique}`,
          registeredAddress: 'Amman, Jordan',
          natureOfBusiness: 'Motor trading',
          contactPhone: '+962-7-0000002',
          contactEmail: `search-ar-${unique}@example.test`,
          languagePreference: 'AR',
        })
        .expect(201);
      const customerId = (created.body as CustomerBody).id;

      const res = await request(app.getHttpServer())
        .get(`/customers?search=${encodeURIComponent('سيارة')}`)
        .set(bearer(sales.accessToken))
        .expect(200);
      const ids = (res.body as { items: CustomerBody[] }).items.map(
        (c) => c.id,
      );
      expect(ids).toContain(customerId);
    });

    // Part F item #6 remainder — curated synonym-table fuzzy
    // transliteration matching (name-transliteration.config.ts). Proves a
    // Latin search term finds a customer whose legalName contains ONLY the
    // Arabic spelling (never "Ahmad" in Latin anywhere in the document),
    // and vice versa — the base bilingual tsvector query alone could not
    // find either (the two scripts share no tokens); only the
    // known-variant expansion can.
    it('finds a customer via a known Arabic name variant when searching its Latin spelling', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-search-translit-latin',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const created = await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(sales.accessToken))
        .send({
          customerType: 'CORPORATE',
          legalName: `شركة أحمد للتجارة ${unique}`,
          registrationNumber: `REG-TL-${unique}`,
          registeredAddress: 'Amman, Jordan',
          natureOfBusiness: 'Trading',
          contactPhone: '+962-7-0000003',
          contactEmail: `search-translit-latin-${unique}@example.test`,
          languagePreference: 'AR',
        })
        .expect(201);
      const customerId = (created.body as CustomerBody).id;

      const res = await request(app.getHttpServer())
        .get('/customers?search=Ahmad')
        .set(bearer(sales.accessToken))
        .expect(200);
      const ids = (res.body as { items: CustomerBody[] }).items.map(
        (c) => c.id,
      );
      expect(ids).toContain(customerId);
    });

    it('finds a customer via a known Latin name variant when searching its Arabic spelling', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-search-translit-arabic',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const created = await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(sales.accessToken))
        .send({
          customerType: 'CORPORATE',
          legalName: `Khaled Trading Co. ${unique}`,
          registrationNumber: `REG-TA-${unique}`,
          registeredAddress: 'Amman, Jordan',
          natureOfBusiness: 'Trading',
          contactPhone: '+962-7-0000004',
          contactEmail: `search-translit-arabic-${unique}@example.test`,
          languagePreference: 'EN',
        })
        .expect(201);
      const customerId = (created.body as CustomerBody).id;

      const res = await request(app.getHttpServer())
        .get(`/customers?search=${encodeURIComponent('خالد')}`)
        .set(bearer(sales.accessToken))
        .expect(200);
      const ids = (res.body as { items: CustomerBody[] }).items.map(
        (c) => c.id,
      );
      expect(ids).toContain(customerId);
    });

    it('an empty search param behaves like no search param at all (shows everything, matches nothing)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-search-empty',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customer = await createIndividualCustomer(
        app,
        sales.accessToken,
        'Empty Search Subject',
      );

      const res = await request(app.getHttpServer())
        .get('/customers?search=')
        .set(bearer(sales.accessToken))
        .expect(200);
      const ids = (res.body as { items: CustomerBody[] }).items.map(
        (c) => c.id,
      );
      expect(ids).toContain(customer.id);
    });

    it('pages the list: two pages, disjoint rows, a stable total', async () => {
      const app = await boot();
      // A fresh owner, so this caller's whole book is exactly the three rows
      // created below and the assertions are about a known set rather than
      // whatever db-test has accumulated.
      const sales = await makeUser(
        app,
        'cust-paging',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await createIndividualCustomer(app, sales.accessToken, `Awwal ${unique}`);
      await createIndividualCustomer(app, sales.accessToken, `Thani ${unique}`);
      await createIndividualCustomer(
        app,
        sales.accessToken,
        `Thalith ${unique}`,
      );

      const pageOf = async (qs: string) => {
        const res = await request(app.getHttpServer())
          .get(`/customers?${qs}`)
          .set(bearer(sales.accessToken))
          .expect(200);
        return res.body as {
          items: CustomerBody[];
          total: number;
          page: number;
          pageSize: number;
        };
      };

      const first = await pageOf('pageSize=2');
      expect(first.items).toHaveLength(2);
      expect(first.page).toBe(0);
      expect(first.pageSize).toBe(2);
      // `total` is the whole matching set, not this page — it is what the page
      // control renders "of N" from and how it knows when to stop.
      expect(first.total).toBe(3);

      const second = await pageOf('page=1&pageSize=2');
      expect(second.items).toHaveLength(1);
      expect(second.page).toBe(1);
      expect(second.total).toBe(3);

      // The two pages must not overlap, or paging through the list would show
      // the same customer twice and skip another.
      const firstIds = first.items.map((c) => c.id);
      const secondIds = second.items.map((c) => c.id);
      expect(firstIds).toHaveLength(new Set(firstIds).size);
      expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
      expect(new Set([...firstIds, ...secondIds]).size).toBe(3);

      // Past the end is an empty page, not an error: the client may hold a
      // stale page number after rows are deleted.
      const past = await pageOf('page=9&pageSize=2');
      expect(past.items).toHaveLength(0);
      expect(past.total).toBe(3);
    });

    it('clamps a hostile page size instead of running the unbounded query', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-paging-clamp',
        'SALES_RELATIONSHIP_OFFICER',
      );

      // The whole point of MAX_PAGE_SIZE: `?pageSize=100000` is the unbounded
      // read this work exists to remove, so it is clamped rather than obeyed.
      const res = await request(app.getHttpServer())
        .get('/customers?pageSize=100000')
        .set(bearer(sales.accessToken))
        .expect(200);
      const body = res.body as { pageSize: number; items: CustomerBody[] };
      expect(body.pageSize).toBe(200);
      expect(body.items.length).toBeLessThanOrEqual(200);

      // A negative page is clamped to the first one rather than producing a
      // negative OFFSET, which Postgres would reject outright.
      const negative = await request(app.getHttpServer())
        .get('/customers?page=-5')
        .set(bearer(sales.accessToken))
        .expect(200);
      expect((negative.body as { page: number }).page).toBe(0);
    });

    it('a nonsense search term matches nothing', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-search-nomatch',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const nonsense = `zzznomatch${Date.now()}${Math.random().toString(36).slice(2)}`;

      const res = await request(app.getHttpServer())
        .get(`/customers?search=${nonsense}`)
        .set(bearer(sales.accessToken))
        .expect(200);
      const page = res.body as { items: CustomerBody[]; total: number };
      expect(page.items).toHaveLength(0);
      // `total` counts the whole matching set, so an empty page here is a
      // genuinely empty result rather than a page past the end of one.
      expect(page.total).toBe(0);
    });
  });

  describe('POST /customers/:id/ubos', () => {
    it('rejects a UBO on an INDIVIDUAL customer', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-owner-c',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customer = await createIndividualCustomer(
        app,
        sales.accessToken,
        'No UBO Here',
      );

      await request(app.getHttpServer())
        .post(`/customers/${customer.id}/ubos`)
        .set(bearer(sales.accessToken))
        .send({
          givenName: 'Someone',
          familyName: 'Person',
          nationalId: '1112223334',
          isPep: false,
        })
        .expect(422);
    });

    it('records a UBO on a CORPORATE customer with ownership % and PEP flag', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-owner-d',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const corp = await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(sales.accessToken))
        .send({
          customerType: 'CORPORATE',
          legalName: `UBO Trading Co. ${uniqueSuffix()}`,
          registrationNumber: `REG-UBO-${uniqueSuffix()}`,
          registeredAddress: 'Amman, Jordan',
          natureOfBusiness: 'Trading',
          contactPhone: '+962-7-1111111',
          contactEmail: 'ubo-corp@example.test',
          languagePreference: 'AR',
        })
        .expect(201);
      const customerId = (corp.body as CustomerBody).id;

      await request(app.getHttpServer())
        .post(`/customers/${customerId}/ubos`)
        .set(bearer(sales.accessToken))
        .send({
          givenName: 'Owner',
          familyName: 'One',
          nationalId: '5556667778',
          ownershipPercent: 60,
          isPep: true,
        })
        .expect(201);

      const ubos = await request(app.getHttpServer())
        .get(`/customers/${customerId}/ubos`)
        .set(bearer(sales.accessToken))
        .expect(200);
      const list = ubos.body as Array<{ fullName: string; isPep: boolean }>;
      expect(list).toHaveLength(1);
      expect(list[0].fullName).toBe('Owner One');
      expect(list[0].isPep).toBe(true);
    });

    // Part F item #4 — Jordanian national-ID-convention name splitting. A
    // UBO is always a real individual, so all 4 parts always apply (unlike
    // Customer, which branches on customerType).
    it('computes a UBO fullName from all 4 Jordanian national-ID-convention name parts', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-owner-ubo-name-parts',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const corp = await request(app.getHttpServer())
        .post('/customers')
        .set(bearer(sales.accessToken))
        .send({
          customerType: 'CORPORATE',
          legalName: `UBO Name Parts Co. ${uniqueSuffix()}`,
          registrationNumber: `REG-PARTS-${uniqueSuffix()}`,
          registeredAddress: 'Amman, Jordan',
          natureOfBusiness: 'Trading',
          contactPhone: '+962-7-2222222',
          contactEmail: 'ubo-name-parts@example.test',
          languagePreference: 'AR',
        })
        .expect(201);
      const customerId = (corp.body as CustomerBody).id;

      const res = await request(app.getHttpServer())
        .post(`/customers/${customerId}/ubos`)
        .set(bearer(sales.accessToken))
        .send({
          givenName: 'Nour',
          fatherName: 'Khaled',
          grandfatherName: 'Yousef',
          familyName: 'Al-Masri',
          nationalId: '9998887776',
          isPep: false,
        })
        .expect(201);
      const ubo = res.body as {
        fullName: string;
        givenName: string;
        fatherName: string;
        grandfatherName: string;
        familyName: string;
      };
      expect(ubo.fullName).toBe('Nour Khaled Yousef Al-Masri');
      expect(ubo.givenName).toBe('Nour');
      expect(ubo.fatherName).toBe('Khaled');
      expect(ubo.grandfatherName).toBe('Yousef');
      expect(ubo.familyName).toBe('Al-Masri');
    });
  });

  describe('full KYC lifecycle — standard (no hit)', () => {
    it('submit -> run-screening -> approve activates the Customer, and a self-approval is rejected', async () => {
      const app = await boot();
      // The premise of this test is "screened, and nothing was found" — which
      // needs a list to have been searched. See the helper.
      await seedWatchlistFixtureEntry();
      const sales = await makeUser(
        app,
        'kyc-owner-a',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const compliance = await makeUser(
        app,
        'kyc-compliance-a',
        'COMPLIANCE_OFFICER',
      );

      const customer = await createIndividualCustomer(
        app,
        sales.accessToken,
        'Perfectly Ordinary E2E Customer',
      );

      const started = await request(app.getHttpServer())
        .post(`/customers/${customer.id}/kyc`)
        .set(bearer(sales.accessToken))
        .expect(201);
      const kycId = (started.body as KycRecordBody).id;
      expect((started.body as KycRecordBody).status).toBe('DRAFT');

      await request(app.getHttpServer())
        .post(`/kyc-records/${kycId}/submit`)
        .set(bearer(sales.accessToken))
        .expect(201);

      const screened = await request(app.getHttpServer())
        .post(`/kyc-records/${kycId}/run-screening`)
        .set(bearer(compliance.accessToken))
        .expect(201);
      expect((screened.body as KycRecordBody).status).toBe('SCREENING');
      expect((screened.body as KycRecordBody).isEdd).toBe(false);

      // Maker/checker: the Compliance Officer approving must differ from
      // the Sales Officer who captured the KYC — but here the CAPTURER is
      // the Sales Officer, so a same-actor decision attempt would have to
      // come from that Sales Officer, who doesn't hold kyc.approve at all
      // (403, not the maker/checker 403) — the meaningful self-approval
      // check is exercised in kyc.service.spec.ts at the unit level since
      // it requires the maker and checker to be the SAME role. Here we
      // confirm the real permission gate instead.
      await request(app.getHttpServer())
        .post(`/kyc-records/${kycId}/approve`)
        .set(bearer(sales.accessToken))
        .expect(403);

      const approved = await request(app.getHttpServer())
        .post(`/kyc-records/${kycId}/approve`)
        .set(bearer(compliance.accessToken))
        .expect(201);
      expect((approved.body as KycRecordBody).status).toBe('APPROVED');

      const customerAfter = await request(app.getHttpServer())
        .get(`/customers/${customer.id}`)
        .set(bearer(sales.accessToken))
        .expect(200);
      expect((customerAfter.body as CustomerBody).status).toBe('ACTIVE');
    });
  });

  describe('full KYC lifecycle — EDD (sample watchlist hit)', () => {
    it('a watchlist-matching name routes through EDD before it can be decided', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'kyc-owner-b',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const compliance = await makeUser(
        app,
        'kyc-compliance-b',
        'COMPLIANCE_OFFICER',
      );

      const customer = await createIndividualCustomer(
        app,
        sales.accessToken,
        'Sample Sanctioned Trading Co.',
      );
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

      // Deciding before the EDD path is entered is rejected.
      await request(app.getHttpServer())
        .post(`/kyc-records/${kycId}/approve`)
        .set(bearer(compliance.accessToken))
        .expect(422);

      const edd = await request(app.getHttpServer())
        .post(`/kyc-records/${kycId}/trigger-edd`)
        .set(bearer(compliance.accessToken))
        .expect(201);
      expect((edd.body as KycRecordBody).status).toBe('EDD');

      const rejected = await request(app.getHttpServer())
        .post(`/kyc-records/${kycId}/reject`)
        .set(bearer(compliance.accessToken))
        .send({ reason: 'Confirmed sanctions list match on enhanced review' })
        .expect(201);
      expect((rejected.body as KycRecordBody).status).toBe('REJECTED');

      const customerAfter = await request(app.getHttpServer())
        .get(`/customers/${customer.id}`)
        .set(bearer(sales.accessToken))
        .expect(200);
      // A rejected KYC never activates the Customer.
      expect((customerAfter.body as CustomerBody).status).toBe('PENDING_KYC');
    });
  });

  describe('POST /customers/:id/reveal-field', () => {
    it('requires a real written justification, then returns the true unmasked value', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'cust-owner-e',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customer = await createIndividualCustomer(
        app,
        sales.accessToken,
        'Reveal Field Customer',
      );

      // Phase 3 split `customer.national-id.reveal` out of
      // `customer.360-view.read`, so the owning Sales Officer no longer reveals
      // this field — Compliance does. The full gate matrix lives in
      // `national-id-reveal-split.e2e-spec.ts`; what this test is about is the
      // justification and the true decrypted value, so it uses a holder.
      const compliance = await makeUser(
        app,
        'cust-reveal-compliance',
        'COMPLIANCE_OFFICER',
      );

      await request(app.getHttpServer())
        .post(`/customers/${customer.id}/reveal-field`)
        .set(bearer(compliance.accessToken))
        .send({ field: 'nationalId', reason: 'short' })
        .expect(400);

      const res = await request(app.getHttpServer())
        .post(`/customers/${customer.id}/reveal-field`)
        .set(bearer(compliance.accessToken))
        .send({
          field: 'nationalId',
          reason: 'Verifying against a photo ID during an onboarding call',
        })
        .expect(201);
      expect((res.body as { value: string }).value).toBe('9901012345');

      // The owner keeps the contact fields on the same endpoint — the reason the
      // customer split is per field rather than per route.
      const phone = await request(app.getHttpServer())
        .post(`/customers/${customer.id}/reveal-field`)
        .set(bearer(sales.accessToken))
        .send({
          field: 'contactPhone',
          reason: 'Returning the client a missed call about their quote',
        })
        .expect(201);
      expect((phone.body as { value: string }).value.length).toBeGreaterThan(0);
    });
  });
});

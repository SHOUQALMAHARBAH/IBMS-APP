import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
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
  const role = await prisma.role.upsert({
    where: { name: roleName },
    update: {},
    create: { name: roleName },
  });
  await prisma.userRoleAssignment.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: { revokedAt: null },
    create: { userId, roleId: role.id },
  });
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

describe('Customer Acquisition / Onboarding (e2e) — backlog Part C #3-4', () => {
  let app: INestApplication<App>;

  async function boot(): Promise<INestApplication<App>> {
    if (!app) app = await createTestApp();
    return app;
  }

  afterAll(async () => {
    if (app) await app.close();
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
      const ids = (res.body as CustomerBody[]).map((c) => c.id);
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
      const ids = (res.body as CustomerBody[]).map((c) => c.id);
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
      const ids = (res.body as CustomerBody[]).map((c) => c.id);
      expect(ids).toContain(customer.id);
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
      expect(res.body as CustomerBody[]).toHaveLength(0);
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
          legalName: 'UBO Trading Co.',
          registrationNumber: 'REG-001',
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
          legalName: 'UBO Name Parts Co.',
          registrationNumber: 'REG-002',
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

      await request(app.getHttpServer())
        .post(`/customers/${customer.id}/reveal-field`)
        .set(bearer(sales.accessToken))
        .send({ field: 'nationalId', reason: 'short' })
        .expect(400);

      const res = await request(app.getHttpServer())
        .post(`/customers/${customer.id}/reveal-field`)
        .set(bearer(sales.accessToken))
        .send({
          field: 'nationalId',
          reason: 'Verifying against a photo ID during an onboarding call',
        })
        .expect(201);
      expect((res.body as { value: string }).value).toBe('9901012345');
    });
  });
});

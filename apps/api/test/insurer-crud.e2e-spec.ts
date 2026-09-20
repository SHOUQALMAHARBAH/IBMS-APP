import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * Insurer management, commit 8 — an office can finally register an insurer.
 *
 * Until this there was no write path at all: every `Insurer` row in every database
 * came from the seed, a demo script or a test fixture. That is why `isActive` was
 * inert for as long as it was, and why the nullable master link added in commit 1
 * had nothing exercising it end to end.
 *
 * ## What this file is really asserting
 *
 *  1. **One endpoint, two registration paths.** A company in the shared catalogue
 *     and a company in no catalogue are both ordinary registrations to the person
 *     doing them, and the body decides which. The three ways a body can fail to
 *     describe either one each get their own message.
 *  2. **One record per company per office.** Two different uniqueness rules can
 *     refuse a registration, and they mean different things — a name this office
 *     already uses (possibly on a record it deactivated) versus a relationship it
 *     already holds. Both are scoped to the organization, which is what makes the
 *     refusal safe to phrase at all.
 *  3. **A catalogue-linked name is not the office's to edit**, but a name the
 *     office typed itself is — otherwise a typo would be permanent, since there is
 *     no delete and deactivation is not a fix for a typo.
 *  4. **`isActive` is not a field in an edit form.** Deactivating an insurer has
 *     consequences the administrator should see first, so the DTO refuses it
 *     outright rather than accepting it in passing.
 *
 * Cross-office invisibility is proven in `tenant-isolation.e2e-spec.ts`, which is
 * the only file with a second Organization and the teardown to match.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const tag = Math.random().toString(36).slice(2, 8);

/**
 * FIXED prefixes, swept at BOTH ends.
 *
 * Cleaning up at the end of a test body does not run when the body fails, and this
 * file's rows are exactly the kind another spec would trip over: `InsurerMaster.legalName`
 * is unique PLATFORM-wide, so one master left behind makes a rerun collide on a name
 * this file chose. db-test is cumulative, so every query below is scoped to these
 * prefixes or to an id this file created — never a global count.
 */
const FIXTURE_PREFIX = `CRUD Fixture ${tag}`;
const MASTER_PREFIX = `CRUD Fixture Master ${tag}`;

async function removeFixtures(): Promise<void> {
  const insurers = await prisma.insurer.findMany({
    where: {
      OR: [
        { legalName: { startsWith: 'CRUD Fixture' } },
        { insurerMaster: { legalName: { startsWith: 'CRUD Fixture Master' } } },
      ],
    },
    select: { id: true },
  });
  const ids = insurers.map((i) => i.id);
  if (ids.length > 0) {
    await prisma.insurerProduct.deleteMany({
      where: { insurerId: { in: ids } },
    });
    await prisma.insurer.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.insurerMaster.deleteMany({
    where: { legalName: { startsWith: 'CRUD Fixture Master' } },
  });
}

interface InsurerView {
  id: string;
  name: string;
  nameAr: string | null;
  isOfficeLocal: boolean;
  insurerMasterId: string | null;
  isActive: boolean;
  companyPhone: string | null;
  companyEmail: string | null;
  companyWebsite: string | null;
  companyCorrespondenceAddress: string | null;
  creditTermsDays: number | null;
  rfqContactEmail: string | null;
  financialStrengthRating: string | null;
}

interface InsurerPage {
  items: InsurerView[];
  total: number;
  page: number;
  pageSize: number;
}

let app: INestApplication<App> | null = null;
/** Holds both codes — the office administrator. */
let admin: { accessToken: string; userId: string };
/** Holds `insurer.read` and not the write. */
let reader: { accessToken: string; userId: string };
/** Holds neither. */
let outsider: { accessToken: string; userId: string };

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function makeUser(
  label: string,
  roleName: string,
): Promise<{ accessToken: string; userId: string }> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Insurer CRUD ${label}`, email, password: PASSWORD })
    .expect(201);
  const login = await request(app!.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = login.body as { accessToken: string; user: { id: string } };

  const enroll = await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(body.accessToken))
    .expect(201);
  const enrollBody = enroll.body as {
    credentialId: string;
    otpAuthUri: string;
  };
  const secret = /[?&]secret=([^&]+)/.exec(enrollBody.otpAuthUri)![1];
  await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(body.accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secret),
    })
    .expect(200);

  const role = await ensureRole(roleName);
  await prisma.userRoleAssignment.create({
    data: { userId: body.user.id, roleId: role.id },
  });
  return { accessToken: body.accessToken, userId: body.user.id };
}

/** A company in the shared catalogue with no office registered against it yet —
 *  the starting state for the MASTER registration path. */
async function catalogueCompany(label: string): Promise<{
  id: string;
  legalName: string;
  legalNameAr: string;
}> {
  const legalName = `${MASTER_PREFIX} ${label}`;
  const legalNameAr = `شركة ${label} للتأمين`;
  const master = await prisma.insurerMaster.create({
    data: { legalName, legalNameAr, linesOffered: [] },
  });
  return { id: master.id, legalName, legalNameAr };
}

/**
 * Registers an insurer through the real endpoint.
 *
 * `companyPhone` and `companyEmail` are REQUIRED on both paths, so the helper
 * supplies them and every earlier test keeps testing what it was written to test: a
 * body missing them is a 400 from the DTO, which would mask the 422s and 409s below.
 * A test specifically about the contact fields passes its own values, or `null` to
 * omit one.
 */
function register(body: Record<string, unknown>, token = admin.accessToken) {
  const withContacts: Record<string, unknown> = {
    companyPhone: '+962 6 400 0000',
    companyEmail: `switchboard-${Math.random().toString(36).slice(2, 8)}@example.test`,
    ...body,
  };
  for (const key of Object.keys(withContacts)) {
    if (withContacts[key] === null) delete withContacts[key];
  }
  return request(app!.getHttpServer())
    .post('/insurers')
    .set(bearer(token))
    .send(withContacts);
}

beforeAll(async () => {
  app = await createTestApp();
  await removeFixtures();
  admin = await makeUser(`crud-admin-${tag}`, 'OFFICE_ADMINISTRATOR');
  reader = await makeUser(`crud-reader-${tag}`, 'SALES_RELATIONSHIP_OFFICER');
  outsider = await makeUser(
    `crud-outsider-${tag}`,
    'FINANCE_COLLECTIONS_OFFICER',
  );
}, 600_000);

afterAll(async () => {
  await removeFixtures();
  await app?.close();
  app = null;
});

describe('registering an insurer — both paths through one endpoint', () => {
  it('registers a company the shared catalogue has never heard of', async () => {
    // The case the whole feature exists for. Nothing creates an `InsurerMaster`
    // here, deliberately: that table's legal name is unique platform-wide, so an
    // auto-created master would turn a name collision into an oracle for what
    // other offices deal with.
    const response = await register({
      legalName: `${FIXTURE_PREFIX} Wadi Rum Mutual`,
      legalNameAr: `${FIXTURE_PREFIX} وادي رم التعاونية`,
      rfqContactName: 'Dana Qasem',
      rfqContactEmail: 'dana@wadirum.test',
      rfqContactPhone: '+962 6 500 1000',
      creditTermsDays: 45,
      financialStrengthRating: 'BBB+',
    }).expect(201);

    const view = response.body as InsurerView;
    expect(view.isOfficeLocal).toBe(true);
    expect(view.insurerMasterId).toBeNull();
    expect(view.name).toBe(`${FIXTURE_PREFIX} Wadi Rum Mutual`);
    expect(view.nameAr).toBe(`${FIXTURE_PREFIX} وادي رم التعاونية`);
    expect(view.isActive).toBe(true);
    expect(view.creditTermsDays).toBe(45);

    // Readable straight back, as itself.
    const fetched = await request(app!.getHttpServer())
      .get(`/insurers/${view.id}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect((fetched.body as InsurerView).name).toBe(view.name);

    // The audit row says WHICH path, so a reader of the trail does not have to
    // infer it from a null.
    const entries = await prisma.auditLogEntry.findMany({
      where: { entityType: 'Insurer', entityId: view.id, action: 'CREATE' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].afterValue).toMatchObject({
      registrationPath: 'LOCAL',
      legalName: `${FIXTURE_PREFIX} Wadi Rum Mutual`,
      creditTermsDays: 45,
    });
    expect(entries[0].userId).toBe(admin.userId);
  }, 300_000);

  it('registers a company already in the shared catalogue, taking its name from there', async () => {
    const company = await catalogueCompany('Petra');
    const response = await register({
      insurerMasterId: company.id,
      creditTermsDays: 30,
    }).expect(201);

    const view = response.body as InsurerView;
    expect(view.isOfficeLocal).toBe(false);
    expect(view.insurerMasterId).toBe(company.id);
    // The name comes from the catalogue, in both scripts, and the office never
    // stored a copy of it.
    expect(view.name).toBe(company.legalName);
    expect(view.nameAr).toBe(company.legalNameAr);

    const row = await prisma.insurer.findUniqueOrThrow({
      where: { id: view.id },
      select: { legalName: true, legalNameAr: true },
    });
    expect(row.legalName).toBeNull();
    expect(row.legalNameAr).toBeNull();

    const entries = await prisma.auditLogEntry.findMany({
      where: { entityType: 'Insurer', entityId: view.id, action: 'CREATE' },
    });
    expect(entries[0].afterValue).toMatchObject({
      registrationPath: 'MASTER',
      insurerMasterId: company.id,
    });
  }, 300_000);

  it('refuses a body that describes both paths, or neither, or half of one', async () => {
    const company = await catalogueCompany('Ambiguous');

    // Both. Accepting it would silently discard the typed name, because
    // `insurerIdentity` resolves master-first.
    const both = await register({
      insurerMasterId: company.id,
      legalName: `${FIXTURE_PREFIX} Conflicting Name`,
      legalNameAr: `${FIXTURE_PREFIX} اسم متعارض`,
    }).expect(422);
    expect((both.body as { message: string }).message).toContain('not both');

    // Neither.
    const neither = await register({ creditTermsDays: 30 }).expect(422);
    expect((neither.body as { message: string }).message).toContain(
      'insurerMasterId',
    );

    // Half of the local path, in each direction. Arabic is this system's primary
    // language, so a company named only in Latin script is not registrable.
    const latinOnly = await register({
      legalName: `${FIXTURE_PREFIX} Latin Only`,
    }).expect(422);
    expect((latinOnly.body as { message: string }).message).toContain(
      'legalNameAr',
    );
    await register({
      legalNameAr: `${FIXTURE_PREFIX} عربي فقط`,
    }).expect(422);
  }, 300_000);

  it('refuses a catalogue id that is not in the catalogue', async () => {
    // 422 rather than a 500 from the foreign key. The catalogue is global, so
    // refusing an unknown id discloses nothing about any office.
    const response = await register({
      insurerMasterId: '00000000-0000-4000-8000-000000000000',
    }).expect(422);
    expect((response.body as { message: string }).message).toContain(
      'not in the shared catalogue',
    );
  }, 120_000);
});

describe('the company-level contact details', () => {
  it('records all four, and returns them as company data', async () => {
    const created = await register({
      legalName: `${FIXTURE_PREFIX} Contactable Mutual`,
      legalNameAr: `${FIXTURE_PREFIX} التعاونية للاتصال`,
      companyPhone: '+962 6 555 1234',
      companyEmail: 'info@contactable.test',
      companyWebsite: 'contactable.test',
      companyCorrespondenceAddress: 'PO Box 140, Amman 11118, Jordan',
    }).expect(201);

    const view = created.body as InsurerView;
    expect(view.companyPhone).toBe('+962 6 555 1234');
    expect(view.companyEmail).toBe('info@contactable.test');
    // Stored as entered, with a scheme or without one. A renderer prepends a scheme;
    // the API does not rewrite what somebody typed.
    expect(view.companyWebsite).toBe('contactable.test');
    expect(view.companyCorrespondenceAddress).toBe(
      'PO Box 140, Amman 11118, Jordan',
    );

    // In the audit trail as part of the registration, like every other field the
    // caller supplied.
    const entries = await prisma.auditLogEntry.findMany({
      where: { entityType: 'Insurer', entityId: view.id, action: 'CREATE' },
    });
    expect(entries[0].afterValue).toMatchObject({
      companyPhone: '+962 6 555 1234',
      companyEmail: 'info@contactable.test',
    });
  }, 300_000);

  it('requires a phone and an email on BOTH registration paths', async () => {
    // Required because they are what make a company findable by an office that has
    // never dealt with it: a brokerage agreement has to be sent somewhere, and a
    // directory entry nobody can act on is not a lead.
    await register({
      legalName: `${FIXTURE_PREFIX} No Phone`,
      legalNameAr: `${FIXTURE_PREFIX} بلا هاتف`,
      companyPhone: null,
    }).expect(400);
    await register({
      legalName: `${FIXTURE_PREFIX} No Email`,
      legalNameAr: `${FIXTURE_PREFIX} بلا بريد`,
      companyEmail: null,
    }).expect(400);

    // The catalogue path is not exempt. A company whose NAME we already know still
    // needs a way to be contacted.
    const company = await catalogueCompany('NeedsContacts');
    await register({ insurerMasterId: company.id, companyPhone: null }).expect(
      400,
    );
    await register({ insurerMasterId: company.id }).expect(201);
  }, 300_000);

  it('leaves website and correspondence address optional, and validates them when given', async () => {
    // Optional on purpose: neither should add friction at registration.
    const minimal = await register({
      legalName: `${FIXTURE_PREFIX} Minimal Contacts`,
      legalNameAr: `${FIXTURE_PREFIX} اتصال أدنى`,
    }).expect(201);
    expect((minimal.body as InsurerView).companyWebsite).toBeNull();
    expect(
      (minimal.body as InsurerView).companyCorrespondenceAddress,
    ).toBeNull();

    // Optional does not mean unchecked.
    await register({
      legalName: `${FIXTURE_PREFIX} Bad Site`,
      legalNameAr: `${FIXTURE_PREFIX} موقع خطأ`,
      companyWebsite: 'not a url at all',
    }).expect(400);
    await register({
      legalName: `${FIXTURE_PREFIX} Bad Email`,
      legalNameAr: `${FIXTURE_PREFIX} بريد خطأ`,
      companyEmail: 'not-an-email',
    }).expect(400);
  }, 300_000);

  it('accepts a MULTI-LINE correspondence address, unlike every other free-text field', async () => {
    // A postal address genuinely spans lines, so this one field deliberately has no
    // control-character guard — the `Customer.registeredAddress` precedent.
    const created = await register({
      legalName: `${FIXTURE_PREFIX} Multiline Address`,
      legalNameAr: `${FIXTURE_PREFIX} عنوان متعدد`,
      companyCorrespondenceAddress: 'Flat 3, Building 12\nAl Shmeisani\nAmman',
    }).expect(201);
    expect(
      (created.body as InsurerView).companyCorrespondenceAddress,
    ).toContain('\n');

    // Whereas a relationship contact NAME still refuses one.
    await register({
      legalName: `${FIXTURE_PREFIX} Multiline Name`,
      legalNameAr: `${FIXTURE_PREFIX} اسم متعدد`,
      rfqContactName: 'Dana\nQasem',
    }).expect(400);
  }, 300_000);

  it('lets a company field be corrected on a CATALOGUE-linked insurer, where the name cannot be', async () => {
    // The asymmetry is the point. The catalogue owns the company's NAME; it does not
    // own this office's record of how to reach them, which lives on the office's own
    // row and is the office's to fix.
    const company = await catalogueCompany('Correctable');
    const linked = await register({
      insurerMasterId: company.id,
      companyPhone: '+962 6 111 0000',
    }).expect(201);
    const id = (linked.body as InsurerView).id;

    const patched = await request(app!.getHttpServer())
      .patch(`/insurers/${id}`)
      .set(bearer(admin.accessToken))
      .send({ companyPhone: '+962 6 222 9999' })
      .expect(200);
    expect((patched.body as InsurerView).companyPhone).toBe('+962 6 222 9999');

    // Recorded as a change, with what it changed from.
    const updates = await prisma.auditLogEntry.findMany({
      where: { entityType: 'Insurer', entityId: id, action: 'UPDATE' },
    });
    expect(updates[0].beforeValue).toEqual({
      companyPhone: '+962 6 111 0000',
    });
    expect(updates[0].afterValue).toEqual({ companyPhone: '+962 6 222 9999' });

    // The name is still not ours to change.
    await request(app!.getHttpServer())
      .patch(`/insurers/${id}`)
      .set(bearer(admin.accessToken))
      .send({ legalName: `${FIXTURE_PREFIX} Renamed` })
      .expect(422);
  }, 300_000);
});

describe('one record per company per office', () => {
  it('refuses a second local registration of the same name, whatever the case', async () => {
    // The partial unique index is on `lower(legalName)`, so this is the same
    // company as far as the office is concerned.
    const legalName = `${FIXTURE_PREFIX} Yarmouk Takaful`;
    await register({
      legalName,
      legalNameAr: `${FIXTURE_PREFIX} اليرموك التكافلي`,
    }).expect(201);

    const again = await register({
      legalName: legalName.toUpperCase(),
      legalNameAr: `${FIXTURE_PREFIX} اليرموك التكافلي ٢`,
    }).expect(409);
    const message = (again.body as { message: string }).message;
    // Points at reactivation, because there is no delete and the existing record
    // may be one the office deactivated.
    expect(message).toContain('reactivate');
    expect(message).toContain(legalName.toUpperCase());
  }, 300_000);

  it('refuses a second relationship with the same catalogued company', async () => {
    const company = await catalogueCompany('Twice');
    await register({ insurerMasterId: company.id }).expect(201);
    const again = await register({ insurerMasterId: company.id }).expect(409);
    expect((again.body as { message: string }).message).toContain(
      'already has a relationship',
    );
  }, 300_000);
});

describe('the list is a management list, not a picker', () => {
  it('shows what the office deactivated — which is exactly what the picker hides', async () => {
    const active = await register({
      legalName: `${FIXTURE_PREFIX} Dealing Still`,
      legalNameAr: `${FIXTURE_PREFIX} ما زال متعاملا`,
    }).expect(201);
    const retired = await register({
      legalName: `${FIXTURE_PREFIX} Dealing No Longer`,
      legalNameAr: `${FIXTURE_PREFIX} لم يعد متعاملا`,
    }).expect(201);
    const retiredId = (retired.body as InsurerView).id;
    const activeId = (active.body as InsurerView).id;
    // Deactivated directly: the endpoint that does this with an impact summary is
    // its own act and arrives in a later commit. What is under test here is the
    // LIST, which has to show a deactivated record or the office can never offer
    // to reactivate it.
    await prisma.insurer.update({
      where: { id: retiredId },
      data: { isActive: false },
    });

    // Searched rather than paged through: db-test is cumulative and holds
    // thousands of insurers for this office, so a global page would be a
    // meaningless assertion.
    const all = await request(app!.getHttpServer())
      .get(
        `/insurers?search=${encodeURIComponent(`${FIXTURE_PREFIX} Dealing`)}`,
      )
      .set(bearer(admin.accessToken))
      .expect(200);
    const page = all.body as InsurerPage;
    expect(page.items.map((i) => i.id).sort()).toEqual(
      [activeId, retiredId].sort(),
    );
    expect(page.items.find((i) => i.id === retiredId)?.isActive).toBe(false);

    // `?isActive=` narrows it, in both directions.
    const onlyRetired = await request(app!.getHttpServer())
      .get(
        `/insurers?isActive=false&search=${encodeURIComponent(`${FIXTURE_PREFIX} Dealing`)}`,
      )
      .set(bearer(admin.accessToken))
      .expect(200);
    expect((onlyRetired.body as InsurerPage).items.map((i) => i.id)).toEqual([
      retiredId,
    ]);

    const onlyActive = await request(app!.getHttpServer())
      .get(
        `/insurers?isActive=true&search=${encodeURIComponent(`${FIXTURE_PREFIX} Dealing`)}`,
      )
      .set(bearer(admin.accessToken))
      .expect(200);
    expect((onlyActive.body as InsurerPage).items.map((i) => i.id)).toEqual([
      activeId,
    ]);

    // And the contrast that makes this a management list: the RFQ picker refuses
    // the same row, because you cannot solicit anything new from a company the
    // office has stopped dealing with.
    const picker = await request(app!.getHttpServer())
      .get('/rfqs/selectable-insurers')
      .set(bearer(admin.accessToken))
      .expect(200);
    const pickerIds = (picker.body as { id: string }[]).map((i) => i.id);
    expect(pickerIds).toContain(activeId);
    expect(pickerIds).not.toContain(retiredId);
  }, 300_000);

  it('finds a company by its ARABIC name, and returns the standard page envelope', async () => {
    const arabic = `${FIXTURE_PREFIX} الشرق الأوسط للتأمين`;
    const created = await register({
      legalName: `${FIXTURE_PREFIX} Middle East Insurance`,
      legalNameAr: arabic,
    }).expect(201);

    const response = await request(app!.getHttpServer())
      .get(`/insurers?search=${encodeURIComponent('الشرق الأوسط')}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    const page = response.body as InsurerPage;
    expect(page.items.map((i) => i.id)).toContain(
      (created.body as InsurerView).id,
    );
    // The same envelope every paged list here returns, so the frontend has one
    // control rather than one per endpoint.
    expect(page).toMatchObject({ page: 0, pageSize: 50 });
    expect(page.total).toBeGreaterThanOrEqual(page.items.length);
  }, 300_000);

  it('honours the page window rather than returning the whole back book', async () => {
    const response = await request(app!.getHttpServer())
      .get('/insurers?pageSize=3')
      .set(bearer(admin.accessToken))
      .expect(200);
    const page = response.body as InsurerPage;
    expect(page.items).toHaveLength(3);
    expect(page.pageSize).toBe(3);
    // This office has thousands of insurer rows on db-test, which is precisely why
    // the endpoint is paged: an unbounded list is the thing `pagination.ts` exists
    // to remove.
    expect(page.total).toBeGreaterThan(3);
  }, 120_000);
});

describe('correcting a record', () => {
  it('records only what changed, and treats a redundant body as a no-op', async () => {
    const created = await register({
      legalName: `${FIXTURE_PREFIX} Amman Mutual`,
      legalNameAr: `${FIXTURE_PREFIX} عمان التعاونية`,
      creditTermsDays: 30,
      rfqContactEmail: 'rfq@amman.test',
    }).expect(201);
    const id = (created.body as InsurerView).id;

    const patched = await request(app!.getHttpServer())
      .patch(`/insurers/${id}`)
      .set(bearer(admin.accessToken))
      .send({ creditTermsDays: 60, rfqContactEmail: 'rfq@amman.test' })
      .expect(200);
    expect((patched.body as InsurerView).creditTermsDays).toBe(60);

    const updates = await prisma.auditLogEntry.findMany({
      where: { entityType: 'Insurer', entityId: id, action: 'UPDATE' },
    });
    expect(updates).toHaveLength(1);
    // The resent, unchanged email is absent from both halves: a trail claiming it
    // was edited would be false.
    expect(updates[0].beforeValue).toEqual({ creditTermsDays: 30 });
    expect(updates[0].afterValue).toEqual({ creditTermsDays: 60 });

    // An empty body is accepted and writes nothing. "Somebody pressed save" is not
    // a change.
    await request(app!.getHttpServer())
      .patch(`/insurers/${id}`)
      .set(bearer(admin.accessToken))
      .send({})
      .expect(200);
    expect(
      await prisma.auditLogEntry.count({
        where: { entityType: 'Insurer', entityId: id, action: 'UPDATE' },
      }),
    ).toBe(1);
  }, 300_000);

  it('lets the office correct a name it typed itself, and refuses a catalogue name', async () => {
    const typo = await register({
      legalName: `${FIXTURE_PREFIX} Jerash Insurnace`,
      legalNameAr: `${FIXTURE_PREFIX} جرش للتأمين`,
    }).expect(201);
    const localId = (typo.body as InsurerView).id;

    // Without this a typo would be permanent: there is no delete, and deactivating
    // the record does not fix its name.
    const fixed = await request(app!.getHttpServer())
      .patch(`/insurers/${localId}`)
      .set(bearer(admin.accessToken))
      .send({ legalName: `${FIXTURE_PREFIX} Jerash Insurance` })
      .expect(200);
    expect((fixed.body as InsurerView).name).toBe(
      `${FIXTURE_PREFIX} Jerash Insurance`,
    );

    // A catalogue-linked row is a different matter — that name is not ours.
    const company = await catalogueCompany('Immutable');
    const linked = await register({ insurerMasterId: company.id }).expect(201);
    const refused = await request(app!.getHttpServer())
      .patch(`/insurers/${(linked.body as InsurerView).id}`)
      .set(bearer(admin.accessToken))
      .send({ legalName: `${FIXTURE_PREFIX} Renamed Catalogue Company` })
      .expect(422);
    expect((refused.body as { message: string }).message).toContain(
      'shared catalogue',
    );
  }, 300_000);

  it('refuses a rename onto a name the office already uses', async () => {
    const first = `${FIXTURE_PREFIX} Irbid First`;
    await register({
      legalName: first,
      legalNameAr: `${FIXTURE_PREFIX} إربد الأولى`,
    }).expect(201);
    const second = await register({
      legalName: `${FIXTURE_PREFIX} Irbid Second`,
      legalNameAr: `${FIXTURE_PREFIX} إربد الثانية`,
    }).expect(201);

    const response = await request(app!.getHttpServer())
      .patch(`/insurers/${(second.body as InsurerView).id}`)
      .set(bearer(admin.accessToken))
      .send({ legalName: first })
      .expect(409);
    expect((response.body as { message: string }).message).toContain(
      'reactivate',
    );
  }, 300_000);

  it('refuses isActive in an edit body outright', async () => {
    // Not stripped and silently ignored — refused. Deactivating an insurer stops
    // the office soliciting anything new from that company, which is a decision
    // with an impact summary attached, not a checkbox you pass while editing a
    // phone number. `forbidNonWhitelisted` is what makes this a 400.
    const created = await register({
      legalName: `${FIXTURE_PREFIX} Not Via Patch`,
      legalNameAr: `${FIXTURE_PREFIX} ليس عبر التعديل`,
    }).expect(201);

    await request(app!.getHttpServer())
      .patch(`/insurers/${(created.body as InsurerView).id}`)
      .set(bearer(admin.accessToken))
      .send({ isActive: false })
      .expect(400);

    // And it is still active.
    const row = await prisma.insurer.findUniqueOrThrow({
      where: { id: (created.body as InsurerView).id },
      select: { isActive: true },
    });
    expect(row.isActive).toBe(true);
  }, 300_000);
});

describe('the permission split, and what absence looks like', () => {
  it('lets insurer.read list and read, and refuses it both writes', async () => {
    const created = await register({
      legalName: `${FIXTURE_PREFIX} Read Only Target`,
      legalNameAr: `${FIXTURE_PREFIX} هدف القراءة فقط`,
    }).expect(201);
    const id = (created.body as InsurerView).id;

    await request(app!.getHttpServer())
      .get('/insurers?pageSize=1')
      .set(bearer(reader.accessToken))
      .expect(200);
    await request(app!.getHttpServer())
      .get(`/insurers/${id}`)
      .set(bearer(reader.accessToken))
      .expect(200);

    await register(
      {
        legalName: `${FIXTURE_PREFIX} Refused Registration`,
        legalNameAr: `${FIXTURE_PREFIX} تسجيل مرفوض`,
      },
      reader.accessToken,
    ).expect(403);
    await request(app!.getHttpServer())
      .patch(`/insurers/${id}`)
      .set(bearer(reader.accessToken))
      .send({ creditTermsDays: 90 })
      .expect(403);
  }, 300_000);

  it('refuses every route to a role holding neither code', async () => {
    const created = await register({
      legalName: `${FIXTURE_PREFIX} Invisible To Finance`,
      legalNameAr: `${FIXTURE_PREFIX} غير مرئي للمالية`,
    }).expect(201);
    const id = (created.body as InsurerView).id;

    // Each request is BUILT when it is sent, not collected in an array first:
    // supertest binds an ephemeral server per request and closes it when that
    // request settles, so four requests built up front and awaited one at a time
    // give ECONNREFUSED on the second — which is exactly what happened.
    for (const send of [
      () => request(app!.getHttpServer()).get('/insurers'),
      () => request(app!.getHttpServer()).get(`/insurers/${id}`),
      () => request(app!.getHttpServer()).post('/insurers').send({}),
      () => request(app!.getHttpServer()).patch(`/insurers/${id}`).send({}),
    ]) {
      await send().set(bearer(outsider.accessToken)).expect(403);
    }
  }, 300_000);

  it('reports an unknown id absent and a malformed one invalid', async () => {
    // 404 rather than 403: another office's id has to be indistinguishable from an
    // id that never existed, or the status code is the disclosure.
    await request(app!.getHttpServer())
      .get('/insurers/00000000-0000-4000-8000-000000000000')
      .set(bearer(admin.accessToken))
      .expect(404);
    await request(app!.getHttpServer())
      .get('/insurers/not-a-uuid')
      .set(bearer(admin.accessToken))
      .expect(400);
  }, 120_000);
});

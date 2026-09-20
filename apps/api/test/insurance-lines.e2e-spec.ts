import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * Insurer management — the managed insurance-line vocabulary.
 *
 * A managed list with office-side additions, which is neither free text nor a closed
 * list. What this file proves, in order of how much it matters:
 *
 *  1. **An addition cannot duplicate a standard line**, including under a different
 *     spelling. A managed list whose duplicate detection can be walked around by
 *     dropping the definite article is a free-text field with extra steps.
 *  2. **An addition cannot duplicate one this office already made** — and that guard
 *     is the DATABASE's, on a stored canonical key, not a check the service
 *     remembers.
 *  3. **Nothing can write a standard line.** There is no route, so the test is that
 *     the 32 are all present and identical to the seed after every other test in this
 *     file has run.
 *  4. An insurer's offered lines come from this vocabulary by id, in market order,
 *     with the whole set replaced rather than merged.
 *
 * The cross-office half — an office's addition being invisible to another office — is
 * in `tenant-isolation.e2e-spec.ts`, the only file with a second Organization.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const tag = Math.random().toString(36).slice(2, 8);

/** FIXED prefix, swept at BOTH ends: a body that fails mid-test does not reach its own
 *  cleanup, and a leftover addition would break this file's own duplicate tests on the
 *  next run. */
const FIXTURE_PREFIX = 'Line Fixture';

async function removeFixtures(): Promise<void> {
  const lines = await prisma.officeInsuranceLine.findMany({
    where: { nameEn: { startsWith: FIXTURE_PREFIX } },
    select: { id: true },
  });
  const insurers = await prisma.insurer.findMany({
    where: { legalName: { startsWith: FIXTURE_PREFIX } },
    select: { id: true },
  });
  const lineIds = lines.map((l) => l.id);
  const insurerIds = insurers.map((i) => i.id);
  // Children first: `InsurerOfferedLine`'s foreign keys are RESTRICT, so an offered
  // line pins both its insurer and the office line it points at.
  if (lineIds.length > 0 || insurerIds.length > 0) {
    await prisma.insurerOfferedLine.deleteMany({
      where: {
        OR: [
          { officeInsuranceLineId: { in: lineIds } },
          { insurerId: { in: insurerIds } },
        ],
      },
    });
  }
  if (insurerIds.length > 0) {
    await prisma.insurer.deleteMany({ where: { id: { in: insurerIds } } });
  }
  if (lineIds.length > 0) {
    await prisma.officeInsuranceLine.deleteMany({
      where: { id: { in: lineIds } },
    });
  }
}

interface LineView {
  id: string;
  code: string | null;
  nameEn: string;
  nameAr: string;
  category: 'GENERAL' | 'LIFE';
  isStandard: boolean;
}

interface InsurerView {
  id: string;
  name: string;
  structure: string | null;
  linesOffered: LineView[];
}

let app: INestApplication<App> | null = null;
let admin: { accessToken: string; userId: string };
let reader: { accessToken: string; userId: string };
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
    .send({ fullName: `Line Vocab ${label}`, email, password: PASSWORD })
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

function listLines(token = admin.accessToken) {
  return request(app!.getHttpServer())
    .get('/insurance-lines')
    .set(bearer(token));
}

function addLine(body: Record<string, unknown>, token = admin.accessToken) {
  return request(app!.getHttpServer())
    .post('/insurance-lines')
    .set(bearer(token))
    .send(body);
}

/** Registers an insurer, supplying everything the DTO requires so a test can say only
 *  what it is about. */
function registerInsurer(body: Record<string, unknown>) {
  return request(app!.getHttpServer())
    .post('/insurers')
    .set(bearer(admin.accessToken))
    .send({
      legalName: `${FIXTURE_PREFIX} Insurer ${Math.random().toString(36).slice(2, 8)}`,
      legalNameAr: `${FIXTURE_PREFIX} شركة`,
      companyPhone: '+962 6 400 0000',
      companyEmail: `lines-${Math.random().toString(36).slice(2, 8)}@example.test`,
      structure: 'CONVENTIONAL',
      ...body,
    });
}

beforeAll(async () => {
  app = await createTestApp();
  await removeFixtures();
  admin = await makeUser(`line-admin-${tag}`, 'OFFICE_ADMINISTRATOR');
  reader = await makeUser(`line-reader-${tag}`, 'SALES_RELATIONSHIP_OFFICER');
  outsider = await makeUser(
    `line-outsider-${tag}`,
    'FINANCE_COLLECTIONS_OFFICER',
  );
}, 600_000);

afterAll(async () => {
  await removeFixtures();
  await app?.close();
  app = null;
});

describe('the standard list', () => {
  it('serves all 32 lines, general before life, in market order', async () => {
    const response = await listLines().expect(200);
    const lines = response.body as LineView[];
    const standard = lines.filter((l) => l.isStandard);
    expect(standard).toHaveLength(32);
    expect(standard.filter((l) => l.category === 'GENERAL')).toHaveLength(27);
    expect(standard.filter((l) => l.category === 'LIFE')).toHaveLength(5);

    // Market order, which is neither alphabetical nor by code: the compulsory motor
    // cover comes first because that is how the products are named.
    expect(standard[0].code).toBe('MOTOR_TPL_COMPULSORY');
    expect(standard[1].code).toBe('MOTOR_COMPREHENSIVE');
    // Every entry carries both scripts. A vocabulary that exists in one language is
    // unusable on the other language's page.
    for (const line of standard) {
      expect(line.nameEn.length, line.code!).toBeGreaterThan(1);
      expect(line.nameAr.length, line.code!).toBeGreaterThan(1);
      expect(line.code).toBeTruthy();
    }
  }, 300_000);

  it('keeps engineering as FOUR separate lines', async () => {
    // Different products for different clients, and an insurer may write one and not
    // another — so merging them would make a directory search return wrong answers.
    const lines = (await listLines().expect(200)).body as LineView[];
    const engineering = lines.filter((l) => l.code?.startsWith('ENGINEERING_'));
    expect(engineering.map((l) => l.code)).toEqual([
      'ENGINEERING_CAR',
      'ENGINEERING_EAR',
      'ENGINEERING_MACHINERY_BREAKDOWN',
      'ENGINEERING_ELECTRONIC_EQUIPMENT',
    ]);
    // They sit together, which is the visual grouping the shared prefix gives —
    // adjacency, not a data hierarchy.
    const positions = engineering.map((l) => lines.indexOf(l));
    expect(positions[3] - positions[0]).toBe(3);
  }, 300_000);

  it('has no takaful lines at all — takaful is a company attribute', async () => {
    // Doubling 32 entries to 64 would break vocabulary search for no gain: a client
    // needing Sharia-compliant motor cover wants Motor Comprehensive from a takaful
    // company, not a different product.
    const lines = (await listLines().expect(200)).body as LineView[];
    expect(
      lines.filter((l) => /takaful|تكافل/i.test(`${l.nameEn} ${l.nameAr}`)),
    ).toEqual([]);

    // The attribute is on the company instead, and it carries the window case.
    const created = await registerInsurer({
      structure: 'TAKAFUL_WINDOW',
    }).expect(201);
    expect((created.body as InsurerView).structure).toBe('TAKAFUL_WINDOW');
  }, 300_000);

  it('is readable by a role that picks insurers, and refused to one that does not', async () => {
    await listLines(reader.accessToken).expect(200);
    await listLines(outsider.accessToken).expect(403);
  }, 300_000);
});

describe('an office adds a type the standard list does not have', () => {
  it('adds it, marks it non-standard, and audits who added it', async () => {
    const response = await addLine({
      nameEn: `${FIXTURE_PREFIX} Pet`,
      nameAr: `${FIXTURE_PREFIX} تأمين الحيوانات الأليفة`,
      category: 'GENERAL',
    }).expect(201);
    const added = response.body as LineView;
    expect(added.isStandard).toBe(false);
    // No code: a code is a platform-wide identifier and an office cannot mint one.
    expect(added.code).toBeNull();

    // It appears in the picker, after the standard list.
    const lines = (await listLines().expect(200)).body as LineView[];
    expect(lines.at(-1)!.id).toBe(added.id);
    expect(lines.filter((l) => l.isStandard)).toHaveLength(32);

    const entries = await prisma.auditLogEntry.findMany({
      where: {
        entityType: 'OfficeInsuranceLine',
        entityId: added.id,
        action: 'CREATE',
      },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].userId).toBe(admin.userId);
  }, 300_000);

  it('refuses a standard line under a different SPELLING', async () => {
    // The check that decides whether this is a managed list at all. Dropped definite
    // article, missing hamza, reordered words — each is the same line.
    for (const nameAr of [
      'تأمين مركبات شامل',
      'تامين المركبات الشامل',
      'الشامل المركبات تأمين',
    ]) {
      const response = await addLine({
        nameEn: `${FIXTURE_PREFIX} Variant ${Math.random().toString(36).slice(2, 6)}`,
        nameAr,
        category: 'GENERAL',
      }).expect(409);
      expect((response.body as { message: string }).message).toContain(
        'standard insurance line',
      );
    }

    // And in the other script.
    await addLine({
      nameEn: 'motor comprehensive',
      nameAr: `${FIXTURE_PREFIX} شيء آخر`,
      category: 'GENERAL',
    }).expect(409);
  }, 300_000);

  it('refuses a second addition of the same thing, on the DATABASE constraint', async () => {
    const nameEn = `${FIXTURE_PREFIX} Drone`;
    await addLine({
      nameEn,
      nameAr: `${FIXTURE_PREFIX} تأمين الطائرات المسيرة`,
      category: 'GENERAL',
    }).expect(201);

    // A different spelling of the same thing is the same thing: the stored canonical
    // key is what carries the unique index, so word order and the article do not
    // create a second entry.
    const response = await addLine({
      nameEn: `${FIXTURE_PREFIX.toUpperCase()}   drone`,
      nameAr: `${FIXTURE_PREFIX} تامين طائرات مسيره`,
      category: 'GENERAL',
    }).expect(409);
    expect((response.body as { message: string }).message).toContain(
      'already has an insurance line',
    );
  }, 300_000);

  it('requires both scripts and a category', async () => {
    await addLine({
      nameEn: `${FIXTURE_PREFIX} No Arabic`,
      category: 'GENERAL',
    }).expect(400);
    await addLine({
      nameAr: `${FIXTURE_PREFIX} بلا إنجليزية`,
      category: 'GENERAL',
    }).expect(400);
    await addLine({
      nameEn: `${FIXTURE_PREFIX} No Category`,
      nameAr: `${FIXTURE_PREFIX} بلا تصنيف`,
    }).expect(400);
    // The general/life split is the one level of this classification that is
    // regulatory, so an addition has to declare which half it is in.
    await addLine({
      nameEn: `${FIXTURE_PREFIX} Bad Category`,
      nameAr: `${FIXTURE_PREFIX} تصنيف خطأ`,
      category: 'MOTOR',
    }).expect(400);
  }, 300_000);

  it('is an administrative act — a reader cannot add or rename', async () => {
    // A deliberate control: an addition changes the vocabulary the whole office then
    // reports against.
    await addLine(
      {
        nameEn: `${FIXTURE_PREFIX} Refused`,
        nameAr: `${FIXTURE_PREFIX} مرفوض`,
        category: 'GENERAL',
      },
      reader.accessToken,
    ).expect(403);
  }, 300_000);
});

describe('correcting an addition', () => {
  it('renames the office own line and records how many insurers it moved under', async () => {
    const added = (
      await addLine({
        nameEn: `${FIXTURE_PREFIX} Cyber Liabilty`,
        nameAr: `${FIXTURE_PREFIX} المسؤولية السيبرانية`,
        category: 'GENERAL',
      }).expect(201)
    ).body as LineView;

    // Attach it to an insurer first, so the rename has something to move under.
    await registerInsurer({ lineIds: [added.id] }).expect(201);

    const renamed = await request(app!.getHttpServer())
      .patch(`/insurance-lines/${added.id}`)
      .set(bearer(admin.accessToken))
      .send({ nameEn: `${FIXTURE_PREFIX} Cyber Liability` })
      .expect(200);
    expect((renamed.body as LineView).nameEn).toBe(
      `${FIXTURE_PREFIX} Cyber Liability`,
    );

    const updates = await prisma.auditLogEntry.findMany({
      where: {
        entityType: 'OfficeInsuranceLine',
        entityId: added.id,
        action: 'UPDATE',
      },
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].afterValue).toMatchObject({ insurersOffering: 1 });
  }, 300_000);

  it('cannot reach a STANDARD line, and cannot rename onto one', async () => {
    const standard = (await listLines().expect(200)).body as LineView[];
    const motor = standard.find((l) => l.code === 'MOTOR_COMPREHENSIVE')!;

    // A standard line is not this office to rename. Its id reads as absent, which is
    // what it is here: not an office addition.
    await request(app!.getHttpServer())
      .patch(`/insurance-lines/${motor.id}`)
      .set(bearer(admin.accessToken))
      .send({ nameEn: 'Renamed By An Office' })
      .expect(404);

    // And an addition cannot be renamed INTO a standard line either.
    const added = (
      await addLine({
        nameEn: `${FIXTURE_PREFIX} Nearly`,
        nameAr: `${FIXTURE_PREFIX} تقريبا`,
        category: 'GENERAL',
      }).expect(201)
    ).body as LineView;
    await request(app!.getHttpServer())
      .patch(`/insurance-lines/${added.id}`)
      .set(bearer(admin.accessToken))
      .send({ nameAr: 'تأمين المركبات الشامل' })
      .expect(409);
  }, 300_000);
});

describe('what an insurer offers', () => {
  it('takes standard and office lines in ONE array and returns them in market order', async () => {
    const lines = (await listLines().expect(200)).body as LineView[];
    const comprehensive = lines.find((l) => l.code === 'MOTOR_COMPREHENSIVE')!;
    const tpl = lines.find((l) => l.code === 'MOTOR_TPL_COMPULSORY')!;
    const office = (
      await addLine({
        nameEn: `${FIXTURE_PREFIX} Marine Delay`,
        nameAr: `${FIXTURE_PREFIX} تأخير بحري`,
        category: 'GENERAL',
      }).expect(201)
    ).body as LineView;

    // Submitted office-first and comprehensive-before-compulsory, so an
    // implementation that echoed the input order fails here.
    const created = await registerInsurer({
      lineIds: [office.id, comprehensive.id, tpl.id],
    }).expect(201);
    const view = created.body as InsurerView;
    expect(view.linesOffered.map((l) => l.code)).toEqual([
      'MOTOR_TPL_COMPULSORY',
      'MOTOR_COMPREHENSIVE',
      null,
    ]);
    expect(view.linesOffered.at(-1)!.nameEn).toBe(
      `${FIXTURE_PREFIX} Marine Delay`,
    );

    // The audit row records CODES, not ids: an id means nothing in another database.
    const entries = await prisma.auditLogEntry.findMany({
      where: { entityType: 'Insurer', entityId: view.id, action: 'CREATE' },
    });
    expect(entries[0].afterValue).toMatchObject({
      linesOffered: [
        'MOTOR_TPL_COMPULSORY',
        'MOTOR_COMPREHENSIVE',
        `${FIXTURE_PREFIX} Marine Delay`,
      ],
    });
  }, 300_000);

  it('REPLACES the set on a patch, and an empty array clears it', async () => {
    const lines = (await listLines().expect(200)).body as LineView[];
    const tpl = lines.find((l) => l.code === 'MOTOR_TPL_COMPULSORY')!;
    const travel = lines.find((l) => l.code === 'TRAVEL')!;
    const created = (
      await registerInsurer({ lineIds: [tpl.id, travel.id] }).expect(201)
    ).body as InsurerView;
    expect(created.linesOffered).toHaveLength(2);

    // Replace, not merge: the screen submits the set it wants, so a merge would leave
    // a company advertising a line the office just unticked.
    const patched = await request(app!.getHttpServer())
      .patch(`/insurers/${created.id}`)
      .set(bearer(admin.accessToken))
      .send({ lineIds: [travel.id] })
      .expect(200);
    expect(
      (patched.body as InsurerView).linesOffered.map((l) => l.code),
    ).toEqual(['TRAVEL']);

    // An absent key leaves the set alone; an explicit [] clears it. Both are needed,
    // which is why this cannot be a falsiness check.
    const untouched = await request(app!.getHttpServer())
      .patch(`/insurers/${created.id}`)
      .set(bearer(admin.accessToken))
      .send({ creditTermsDays: 30 })
      .expect(200);
    expect((untouched.body as InsurerView).linesOffered).toHaveLength(1);

    const cleared = await request(app!.getHttpServer())
      .patch(`/insurers/${created.id}`)
      .set(bearer(admin.accessToken))
      .send({ lineIds: [] })
      .expect(200);
    expect((cleared.body as InsurerView).linesOffered).toEqual([]);
  }, 300_000);

  it('refuses an unknown line id, naming it', async () => {
    const response = await registerInsurer({
      lineIds: ['00000000-0000-4000-8000-000000000000'],
    }).expect(422);
    expect((response.body as { message: string }).message).toContain(
      '00000000-0000-4000-8000-000000000000',
    );
  }, 300_000);

  it('accepts an insurer that offers nothing yet', async () => {
    // An office often registers a company before it knows the product list. Forcing a
    // pick would produce a chosen-to-get-past-the-form value, which is worse than an
    // absent one.
    const created = await registerInsurer({}).expect(201);
    expect((created.body as InsurerView).linesOffered).toEqual([]);
  }, 300_000);
});

describe('the standard list is unwritable', () => {
  it('still holds exactly the seeded 32 after everything above', async () => {
    // There is no route that writes `InsuranceLine` — not one behind a permission, but
    // none at all, and no repository method either. This is the assertion that the
    // absence held: every test above has run, including ones that tried to add
    // duplicates of standard lines.
    const rows = await prisma.insuranceLine.findMany({
      select: { code: true },
    });
    expect(rows).toHaveLength(32);
    expect(new Set(rows.map((r) => r.code)).size).toBe(32);
  }, 120_000);
});

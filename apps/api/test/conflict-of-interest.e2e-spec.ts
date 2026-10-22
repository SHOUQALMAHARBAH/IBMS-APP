import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, rawPrisma, TEST_ORGANIZATION_ID } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * MODULE 0-ب — THE DPO ASSIGNMENT DECLARATION (1a) AND THE DISCLOSURE REGISTER (1b).
 *
 * ## WHAT 1a REVERSES
 *
 * The repository recorded a HARD BLOCK: the holder of the data-protection-officer assignment may not
 * be the holder of the office-manager assignment. The owner struck it. One person MAY hold both, and
 * what the system does is say so once and record that it was known.
 *
 * So the assertions here are in two halves, and the SECOND is the one a careless version loses: the
 * 422 refuses the MISSING ACKNOWLEDGEMENT, and its own sentence says the arrangement is permitted.
 * A message that read as a refusal would send an office of one person hunting a second person who
 * does not exist, which is the thing the block was struck to prevent.
 *
 * ## WHY THE DECLARING ACTOR IS NEVER TORN DOWN
 *
 * `ConflictOfInterestRegisterEntry` is immutable by a trigger pair, so a user who has declared a
 * conflict can never be deleted — `declaredByUserId` is RESTRICT — and neither can the organization
 * holding them. The `AuditLogEntry` treatment, met in a third table. These specs therefore run in the
 * DEFAULT test organization, which is never torn down, and every register assertion is SET
 * MEMBERSHIP on the ids this run created: db-test is cumulative, and leftover rows must not be able
 * to make an assertion pass or fail.
 */
const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = Math.random().toString(36).slice(2, 8);

/** A name nobody else uses, so the sameness test is about this run and not about seeded data. */
const MANAGER_NAME = `Mira Al-Qudah ${RUN}`;
const OTHER_NAME = `Yousef Haddad ${RUN}`;

/**
 * THE SENTENCE THE OFFICE WAS SHOWN. In production it is the owner's own four paragraphs, carried
 * from the client — decision 28's rule. Here it only has to be a real sentence over the DTO's floor,
 * because what is under test is that the server STORES WHAT IT WAS SENT rather than re-deriving it.
 */
const NOTICE =
  'The two assignments are on one person, and the system records that rather than preventing it.';

let app: INestApplication<App> | null = null;
const createdRoleIds: string[] = [];
const createdEntryIds: string[] = [];

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface DesignationBody {
  dataProtectionOfficerName: string | null;
  generalManagerName: string | null;
  combinedWithManager: boolean;
  declarationRequired: boolean;
  acknowledgedAt: string | null;
  acknowledgedByUserId: string | null;
  acknowledgedByName: string | null;
  noticeShown: string | null;
}
interface RegisterEntryBody {
  id: string;
  declaredByUserId: string;
  declaredByName: string;
  disclosure: string;
  declaredAt: string;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** A signed-in user holding a role with EXACTLY these codes — an empty list is a real case here. */
async function actorHolding(
  label: string,
  codes: string[],
): Promise<{ accessToken: string; userId: string }> {
  const server = (app as INestApplication<App>).getHttpServer();
  const org = await prisma.organization.findFirstOrThrow({
    orderBy: { id: 'asc' },
  });
  const permissions = await prisma.permission.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  // A mistyped code grants nothing and would make every refusal below pass for the wrong reason.
  expect(permissions.map((p) => p.code).sort()).toEqual([...codes].sort());

  const role = await prisma.role.create({
    data: {
      organizationId: org.id,
      name: `${label.toUpperCase()}_${RUN}`,
      nameEn: label,
      nameAr: label,
      requiresMfaAlways: false,
      requiresHardwareToken: false,
      permissions: {
        create: permissions.map((p) => ({
          organizationId: org.id,
          permissionId: p.id,
        })),
      },
    },
    select: { id: true },
  });
  createdRoleIds.push(role.id);

  const email = `${label}-${RUN}@coi.test`;
  await request(server)
    .post('/auth/signup')
    .send({ fullName: `COI ${label}`, email, password: PASSWORD })
    .expect(201);
  const login = await request(server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const { accessToken, user } = login.body as IssuedSessionBody;

  const enroll = await request(server)
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const eb = enroll.body as MfaEnrollBody;
  await request(server)
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: eb.credentialId,
      code: authenticator.generate(
        /[?&]secret=([^&]+)/.exec(eb.otpAuthUri)![1],
      ),
    })
    .expect(200);

  await prisma.userRoleAssignment.create({
    data: { userId: user.id, roleId: role.id },
  });
  return { accessToken, userId: user.id };
}

/**
 * The office's designation columns, back to how a never-asked office reads — whatever a killed run
 * left behind. Called at BOTH ends, the sibling mode spec's own discipline: a declaration left
 * standing would make the "it asks" tests pass for the wrong reason on the next run.
 *
 * The manager name is SET here rather than nulled, because the whole sameness test needs the other
 * half of the comparison to exist, and the registration form is the only path that writes it.
 */
async function resetOffice(managerName: string | null): Promise<void> {
  await rawPrisma.organization.update({
    where: { id: TEST_ORGANIZATION_ID },
    data: {
      generalManagerName: managerName,
      dataProtectionOfficerName: null,
      dpoManagerCombinedNoticeShown: null,
      dpoManagerCombinedAcknowledgedAt: null,
      dpoManagerCombinedAcknowledgedByUserId: null,
      dpoManagerCombinedAcknowledgedPerson: null,
    },
  });
}

let originalManagerName: string | null = null;

beforeAll(async () => {
  const office = await rawPrisma.organization.findUniqueOrThrow({
    where: { id: TEST_ORGANIZATION_ID },
    select: { generalManagerName: true },
  });
  originalManagerName = office.generalManagerName;
  await resetOffice(MANAGER_NAME);
  app = await createTestApp();
}, 300_000);

afterAll(async () => {
  await app?.close();
  // Back to what was found, not to null: another spec may assert about this office's registration.
  await resetOffice(originalManagerName);
  if (createdRoleIds.length > 0) {
    await prisma.userRoleAssignment.deleteMany({
      where: { roleId: { in: createdRoleIds } },
    });
    await prisma.rolePermission.deleteMany({
      where: { roleId: { in: createdRoleIds } },
    });
    await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
  }
  // The register entries are NOT deleted and must not be: the trigger pair refuses, and a correction
  // is a new entry. Every assertion above is set membership on `createdEntryIds` for that reason.
});

describe('1a — the DPO assignment, and the declaration when one person holds both (e2e)', () => {
  it('records a designation that differs from the manager, asking nothing', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const admin = await actorHolding('dpo-recorder', [
      'duty-segregation.mode.declare',
    ]);

    const saved = await request(server)
      .patch('/duty-segregation/dpo-designation')
      .set(bearer(admin.accessToken))
      .send({ dataProtectionOfficerName: OTHER_NAME })
      .expect(200);

    const body = saved.body as DesignationBody;
    expect(body.dataProtectionOfficerName).toBe(OTHER_NAME);
    expect(body.generalManagerName).toBe(MANAGER_NAME);
    expect(body.combinedWithManager).toBe(false);
    expect(body.declarationRequired).toBe(false);
    expect(body.acknowledgedAt).toBeNull();

    /*
     * THE WIRE SHAPE, asserted as an EXACT KEY SET.
     *
     * The screen reads these eight fields through a hand-copied interface that TypeScript cannot
     * check, so a field removed server-side reads as `undefined` and throws during render with
     * nothing failing at compile time — the import-panel defect. And an exact set rather than eight
     * `toHaveProperty` calls, because a LEAK ARRIVES AS AN ADDITION and every `toHaveProperty` keeps
     * passing while one appears: `dpoManagerCombinedAcknowledgedPerson` is a canonical name fold and
     * has no business on the wire.
     */
    expect(Object.keys(body).sort()).toEqual([
      'acknowledgedAt',
      'acknowledgedByName',
      'acknowledgedByUserId',
      'combinedWithManager',
      'dataProtectionOfficerName',
      'declarationRequired',
      'generalManagerName',
      'noticeShown',
    ]);
  });

  it('refuses a combined assignment with no acknowledgement — and says the arrangement is permitted', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const admin = await actorHolding('dpo-asker', [
      'duty-segregation.mode.declare',
    ]);

    const refused = await request(server)
      .patch('/duty-segregation/dpo-designation')
      .set(bearer(admin.accessToken))
      .send({ dataProtectionOfficerName: MANAGER_NAME })
      .expect(422);

    const body = refused.body as { code: string; message: string };
    expect(body.code).toBe('DPO_MANAGER_COMBINED_DECLARATION_REQUIRED');
    // THE HALF A CARELESS VERSION LOSES. Both directions, because this is the clause a reword drops.
    expect(body.message).toContain('permitted');
    expect(body.message).toMatch(/nothing here refuses the arrangement/i);
    expect(body.message).not.toMatch(/not allowed|forbidden|may not/i);
    // AND IT ASKS FOR NO REASON — lighter than decision 28, deliberately.
    expect(body.message).not.toMatch(/write a reason|reason of at least/i);

    // NOTHING WAS WRITTEN. A refusal that half-saved would leave the designation combined and
    // unacknowledged, which is the state the notice exists to prevent.
    const office = await rawPrisma.organization.findUniqueOrThrow({
      where: { id: TEST_ORGANIZATION_ID },
      select: { dataProtectionOfficerName: true },
    });
    expect(office.dataProtectionOfficerName).not.toBe(MANAGER_NAME);
  });

  it('accepts it with the acknowledgement, and stores the sentence that was SHOWN', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const admin = await actorHolding('dpo-acknowledger', [
      'duty-segregation.mode.declare',
    ]);

    const saved = await request(server)
      .patch('/duty-segregation/dpo-designation')
      .set(bearer(admin.accessToken))
      .send({
        dataProtectionOfficerName: MANAGER_NAME,
        combinedAssignmentDeclaration: {
          noticeShown: NOTICE,
          acknowledged: true,
        },
      })
      .expect(200);

    const body = saved.body as DesignationBody;
    expect(body.combinedWithManager).toBe(true);
    // ASKED ONCE: it does not ask again for this person.
    expect(body.declarationRequired).toBe(false);
    expect(body.acknowledgedByUserId).toBe(admin.userId);
    expect(body.acknowledgedAt).not.toBeNull();
    // VERBATIM, not re-derived. The question a year from now is what they saw.
    expect(body.noticeShown).toBe(NOTICE);

    /*
     * THE AUDIT ROW CARRIES THE SENTENCE AND NOT THE WORD — decision 28's rule, asserted in BOTH
     * directions. A row saying "acknowledged" records that a box was ticked; a row carrying the
     * sentence records what the office was told. The absence is the half that can fail.
     */
    const audit = await rawPrisma.auditLogEntry.findFirstOrThrow({
      where: {
        organizationId: TEST_ORGANIZATION_ID,
        entityType: 'Organization',
        userId: admin.userId,
      },
      orderBy: { occurredAt: 'desc' },
      select: { afterValue: true },
    });
    const snapshot = JSON.stringify(audit.afterValue);
    expect(snapshot).toContain(NOTICE);
    expect(snapshot).not.toContain('acknowledged');
  });

  it('asks again when both assignments move to a DIFFERENT person', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const admin = await actorHolding('dpo-mover', [
      'duty-segregation.mode.declare',
    ]);

    // The office is acknowledged for MANAGER_NAME by the test above. Move BOTH assignments to
    // somebody else: the exposure is about a different person, so the acknowledgement must not carry
    // over. If it did, nobody at the office would ever be told about the new combination.
    await rawPrisma.organization.update({
      where: { id: TEST_ORGANIZATION_ID },
      data: { generalManagerName: OTHER_NAME },
    });

    const refused = await request(server)
      .patch('/duty-segregation/dpo-designation')
      .set(bearer(admin.accessToken))
      .send({ dataProtectionOfficerName: OTHER_NAME })
      .expect(422);
    expect((refused.body as { code: string }).code).toBe(
      'DPO_MANAGER_COMBINED_DECLARATION_REQUIRED',
    );

    await rawPrisma.organization.update({
      where: { id: TEST_ORGANIZATION_ID },
      data: { generalManagerName: MANAGER_NAME },
    });
  });

  it('is readable by whoever reviews the acts, and writable only by whoever declares', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const reviewer = await actorHolding('dpo-reviewer', [
      'internal-controls.view',
    ]);

    // THE SAME OR AS THE MODE'S READ: a reviewer sees the office's posture.
    await request(server)
      .get('/duty-segregation/dpo-designation')
      .set(bearer(reviewer.accessToken))
      .expect(200);

    // AND CANNOT WRITE IT. Whoever declares is not whoever reviews.
    await request(server)
      .patch('/duty-segregation/dpo-designation')
      .set(bearer(reviewer.accessToken))
      .send({ dataProtectionOfficerName: OTHER_NAME })
      .expect(403);
  });
});

describe('1b — the conflict-of-interest disclosure register (e2e)', () => {
  const DISCLOSURE = `My brother-in-law is a director of an insurer this office places with (${RUN}).`;

  it('lets a user with NO permissions at all declare their own conflict', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    // THE POINT OF THE TEST IS THE EMPTY LIST. The discloser is the subject, so there is no code for
    // this and there cannot be one: a code an office could withhold would leave the person who HAS
    // the conflict as the one person unable to say so.
    const anybody = await actorHolding('coi-declarer', []);

    const created = await request(server)
      .post('/conflict-of-interest/disclosures')
      .set(bearer(anybody.accessToken))
      .send({ disclosure: DISCLOSURE })
      .expect(201);

    const body = created.body as RegisterEntryBody;
    createdEntryIds.push(body.id);
    expect(body.declaredByUserId).toBe(anybody.userId);
    expect(body.disclosure).toBe(DISCLOSURE);
    // THE NAME, not the uuid — what the manager reading the register sees.
    expect(body.declaredByName).toBe(`COI coi-declarer`);

    expect(Object.keys(body).sort()).toEqual([
      'declaredAt',
      'declaredByName',
      'declaredByUserId',
      'disclosure',
      'id',
    ]);
  });

  it('refuses a disclosure below the shared declaration minimum', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const anybody = await actorHolding('coi-terse', []);

    // NINE CHARACTERS, not zero: a test that only sends nothing cannot tell a ten-character floor
    // from a non-empty check.
    await request(server)
      .post('/conflict-of-interest/disclosures')
      .set(bearer(anybody.accessToken))
      .send({ disclosure: 'a conflic' })
      .expect(400);
  });

  it('refuses the body naming somebody else as the declarer', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const anybody = await actorHolding('coi-impostor', []);

    // The DTO has no `declaredByUserId` field, so `forbidNonWhitelisted` refuses it by name. The
    // `ProvisionUserDto` precedent: the ABSENCE of the field is the control, and in a register of
    // SELF-declarations filing in a colleague's name is the one thing that must not be possible.
    await request(server)
      .post('/conflict-of-interest/disclosures')
      .set(bearer(anybody.accessToken))
      .send({
        disclosure: DISCLOSURE,
        declaredByUserId: '00000000-0000-0000-0000-000000000001',
      })
      .expect(400);
  });

  it('is readable only with the code, and the entry is in it', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const blind = await actorHolding('coi-blind', []);
    const reader = await actorHolding('coi-reader', [
      'conflict-of-interest.register.read',
    ]);

    await request(server)
      .get('/conflict-of-interest/disclosures')
      .set(bearer(blind.accessToken))
      .expect(403);

    const list = await request(server)
      .get('/conflict-of-interest/disclosures')
      .set(bearer(reader.accessToken))
      .expect(200);

    const rows = list.body as RegisterEntryBody[];
    expect(Array.isArray(rows)).toBe(true);
    // SET MEMBERSHIP on the ids this run created — db-test is cumulative and these rows can never be
    // deleted, so a count would be a cross-run coupling.
    const ids = rows.map((r) => r.id);
    for (const id of createdEntryIds) expect(ids).toContain(id);
    // Every row carries a NAME, which is what the register is read for.
    for (const row of rows) expect(row.declaredByName).not.toBe('');
  });

  it('cannot be edited or deleted — a correction is a new entry', async () => {
    const [id] = createdEntryIds;
    expect(id).toBeTruthy();

    // PROVEN FROM BOTH DIRECTIONS, as the raw owner — a BEFORE trigger does not care who the caller
    // is, which is the whole reason append-only here is a trigger and not a narrower GRANT.
    await expect(
      rawPrisma.conflictOfInterestRegisterEntry.update({
        where: { id },
        data: { disclosure: 'rewritten' },
      }),
    ).rejects.toThrow(/immutable/i);

    await expect(
      rawPrisma.conflictOfInterestRegisterEntry.delete({ where: { id } }),
    ).rejects.toThrow(/immutable/i);
  });

  it('audits the read with a COUNT and never the contents', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const reader = await actorHolding('coi-audited', [
      'conflict-of-interest.register.read',
    ]);

    await request(server)
      .get('/conflict-of-interest/disclosures')
      .set(bearer(reader.accessToken))
      .expect(200);

    const audit = await rawPrisma.auditLogEntry.findFirstOrThrow({
      where: {
        organizationId: TEST_ORGANIZATION_ID,
        entityType: 'ConflictOfInterestRegisterEntry',
        userId: reader.userId,
        action: 'READ',
      },
      orderBy: { occurredAt: 'desc' },
      select: { afterValue: true },
    });
    const snapshot = JSON.stringify(audit.afterValue);
    expect(snapshot).toMatch(/entryCount/);
    // AND NOT WHAT WAS READ. Copying the register's contents into the log would pollute the very
    // thing a later search is over — the `combined-duty-acts` precedent.
    expect(snapshot).not.toContain(DISCLOSURE);
  });
});

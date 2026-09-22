import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma, rawPrisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';
import { makeInsurer, makeLocalInsurer } from './insurer-fixture';

/**
 * Q9 — an office's OWN insurer form mappings, and the two properties that make them a separate
 * model rather than a column on the shared one.
 *
 * The file is ordered by what would be worst if it broke:
 *
 *  1. **§5's sharing still works.** The whole risk of this change was withdrawing the promise
 *     that a mapping made once is readable by every office. So the global endpoint's behaviour
 *     is asserted here too, beside the new one, rather than trusted to its own file.
 *  2. **An office's own LINE is legitimate here and refused there.** That inversion is the
 *     § 1.26 prediction that survived re-derivation, and it is only meaningful if both halves
 *     hold at once — so both are asserted in one test.
 *  3. **Resolution precedence**, with the source named. A screen that cannot tell a shared
 *     mapping from its own would offer "edit" on a row that belongs to every office.
 *  4. **Tenancy**: another office's insurer is a 404, and its templates are invisible.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const tag = Math.random().toString(36).slice(2, 8);
const FIXTURE_PREFIX = 'Q9 Fixture';

/** A second Organization, so "invisible to another office" is measured rather than assumed.
 *  Fixed id and swept at BOTH ends: a leaked Organization makes `signup` refuse in every later
 *  spec file, which this suite has learned three times. */
const ORG_B_ID = '00000000-0000-0000-0000-0000000005e1';

let app: INestApplication<App> | null = null;
let placement: { accessToken: string; userId: string };
/** Holds `insurer.read` but NOT `insurer.office-form.map` — the role that proves the new code
 *  gates something. Compliance reads insurers and has no business mapping submission forms. */
let readOnly: { accessToken: string; userId: string };

let masterLinked: { id: string; insurerMasterId: string; name: string };
let localOnly: { id: string; insurerMasterId: null; name: string };
let motorLineId: string;
let travelLineId: string;
let officeLineId: string;

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` } as Record<string, string>;
}

async function makeUser(prefix: string, roleName: string) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Q9 ${prefix}`, email, password: PASSWORD })
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

/** A minimal but valid field list. Two fields, so `displayOrder` has something to order. */
function fields() {
  return [
    {
      fieldKey: 'plate_number',
      labelEn: 'Plate number',
      labelAr: 'رقم اللوحة',
      dataType: 'TEXT',
      isRequired: true,
      displayOrder: 0,
    },
    {
      fieldKey: 'cover_type',
      labelEn: 'Cover type',
      dataType: 'ENUM',
      options: ['Comprehensive', 'Third party'],
      displayOrder: 1,
    },
  ];
}

async function removeFixtures(): Promise<void> {
  // Children before parents, every FK here being RESTRICT except the fields' CASCADE.
  await rawPrisma.officeInsurerFormField.deleteMany({
    where: {
      OR: [
        { organizationId: ORG_B_ID },
        {
          template: { insurer: { legalName: { startsWith: FIXTURE_PREFIX } } },
        },
      ],
    },
  });
  await rawPrisma.officeInsurerFormTemplate.deleteMany({
    where: {
      OR: [
        { organizationId: ORG_B_ID },
        { insurer: { legalName: { startsWith: FIXTURE_PREFIX } } },
        {
          insurer: {
            insurerMaster: { legalName: { startsWith: FIXTURE_PREFIX } },
          },
        },
      ],
    },
  });
  await rawPrisma.insurerFormField.deleteMany({
    where: {
      template: {
        insurerMaster: { legalName: { startsWith: FIXTURE_PREFIX } },
      },
    },
  });
  await rawPrisma.insurerFormTemplate.deleteMany({
    where: { insurerMaster: { legalName: { startsWith: FIXTURE_PREFIX } } },
  });
  await rawPrisma.insurerOfferedLine.deleteMany({
    where: {
      OR: [
        { organizationId: ORG_B_ID },
        { insurer: { legalName: { startsWith: FIXTURE_PREFIX } } },
      ],
    },
  });
  await rawPrisma.insurer.deleteMany({
    where: {
      OR: [
        { organizationId: ORG_B_ID },
        { legalName: { startsWith: FIXTURE_PREFIX } },
        { insurerMaster: { legalName: { startsWith: FIXTURE_PREFIX } } },
      ],
    },
  });
  await rawPrisma.insurerMaster.deleteMany({
    where: { legalName: { startsWith: FIXTURE_PREFIX } },
  });
  // This office's own added line, and Org B's. db-test is cumulative, so a leaked office line
  // makes the next run collide on `OfficeInsuranceLine_organizationId_canonicalEn_key`.
  await rawPrisma.officeInsuranceLine.deleteMany({
    where: {
      OR: [
        { organizationId: ORG_B_ID },
        { nameEn: { startsWith: FIXTURE_PREFIX } },
      ],
    },
  });
  await rawPrisma.userRoleAssignment.deleteMany({
    where: { organizationId: ORG_B_ID },
  });
  await rawPrisma.rolePermission.deleteMany({
    where: { organizationId: ORG_B_ID },
  });
  await rawPrisma.role.deleteMany({ where: { organizationId: ORG_B_ID } });
  await rawPrisma.user.deleteMany({ where: { organizationId: ORG_B_ID } });
  await rawPrisma.organization.deleteMany({ where: { id: ORG_B_ID } });
}

beforeAll(async () => {
  await removeFixtures();
  app = await createTestApp();
  // PLACEMENT_TECHNICAL_OFFICER, spelled exactly: `ensureRole` UPSERTS, so a role name that is
  // not in the catalogue is CREATED with no grants and every request then 403s. A typo cost a
  // full run here and left a permissionless `PLACEMENT_OFFICER` row in the cumulative test
  // database. Measured grants for this role: insurer.read, insurer.form.map,
  // insurer.office-form.map, insurer.directory.read, insurer.master.read — the set this file needs.
  placement = await makeUser(`q9-place-${tag}`, 'PLACEMENT_TECHNICAL_OFFICER');
  readOnly = await makeUser(`q9-read-${tag}`, 'COMPLIANCE_OFFICER');

  const motor = await rawPrisma.insuranceLine.findFirstOrThrow({
    where: { code: 'MOTOR_COMPREHENSIVE' },
  });
  const travel = await rawPrisma.insuranceLine.findFirstOrThrow({
    where: { code: 'TRAVEL' },
  });
  motorLineId = motor.id;
  travelLineId = travel.id;

  masterLinked = await makeInsurer(`${FIXTURE_PREFIX} Catalogue Co ${tag}`);
  localOnly = await makeLocalInsurer(`${FIXTURE_PREFIX} Local Co ${tag}`);

  // This office's OWN line type — the referent the GLOBAL mapping endpoint must refuse and this
  // one must accept. Named distinctly from every catalogue line so it does not trip the
  // standard-collision guard that `insurer-schema-constraints.e2e-spec.ts` asserts is empty.
  const officeLine = await prisma.officeInsuranceLine.create({
    data: {
      nameEn: `${FIXTURE_PREFIX} Drone Hull ${tag}`,
      nameAr: `${FIXTURE_PREFIX} أجسام الطائرات المسيرة ${tag}`,
      canonicalEn: `q9 fixture drone hull ${tag}`,
      canonicalAr: `q9 fixture درون ${tag}`,
      category: 'GENERAL',
      createdByUserId: placement.userId,
    },
  });
  officeLineId = officeLine.id;
}, 600_000);

afterAll(async () => {
  await removeFixtures();
  await app?.close();
  app = null;
});

describe('§5 sharing survives, which was the whole risk of this change', () => {
  it('still serves a globally mapped form to an office that never mapped it', async () => {
    // Mapped through the GLOBAL endpoint, then read back from the master registry. If Q9 had
    // been built by adding `organizationId` to `InsurerFormTemplate`, `applyTenantScope` would
    // filter this read and the answer would depend on which office asked.
    await request(app!.getHttpServer())
      .post(`/insurer-masters/${masterLinked.insurerMasterId}/form-templates`)
      .set(bearer(placement.accessToken))
      .send({ insuranceLineId: motorLineId, fields: fields() })
      .expect(201);

    const listed = await request(app!.getHttpServer())
      .get(`/insurer-masters/${masterLinked.insurerMasterId}/form-templates`)
      .set(bearer(placement.accessToken))
      .expect(200);
    const rows = listed.body as { insuranceLine: { code: string } }[];
    expect(rows.map((r) => r.insuranceLine.code)).toContain(
      'MOTOR_COMPREHENSIVE',
    );

    // And the row carries no office column at all — there is nothing to filter, which is the
    // structural form of the promise rather than a query that remembers not to.
    const raw = await rawPrisma.insurerFormTemplate.findFirstOrThrow({
      where: { insurerMasterId: masterLinked.insurerMasterId },
    });
    expect(Object.keys(raw)).not.toContain('organizationId');
  }, 300_000);
});

describe("an office's own LINE — legitimate here, refused there", () => {
  it('accepts it on the office endpoint and refuses it on the global one, naming why', async () => {
    // Both halves in one test on purpose: the inversion is the point, and either assertion
    // alone would pass against a system that had simply stopped checking.
    const refused = await request(app!.getHttpServer())
      .post(`/insurer-masters/${masterLinked.insurerMasterId}/form-templates`)
      .set(bearer(placement.accessToken))
      .send({ insuranceLineId: officeLineId, fields: fields() })
      .expect(422);
    expect((refused.body as { message: string }).message).toContain(
      'your office',
    );

    const accepted = await request(app!.getHttpServer())
      .post(`/insurers/${masterLinked.id}/form-templates`)
      .set(bearer(placement.accessToken))
      .send({ lineId: officeLineId, fields: fields() })
      .expect(201);
    const view = accepted.body as {
      version: number;
      insuranceLine: { id: string; code: string | null };
      fields: { fieldKey: string }[];
    };
    expect(view.version).toBe(1);
    expect(view.insuranceLine.id).toBe(officeLineId);
    // `code: null` IS the statement that this line is the office's own — the same convention
    // the directory uses, so a caller needs no second field to tell the catalogues apart.
    expect(view.insuranceLine.code).toBeNull();
    expect(view.fields.map((f) => f.fieldKey)).toEqual([
      'plate_number',
      'cover_type',
    ]);
  }, 300_000);

  it('works the same for a LOCALLY registered company, which the global table cannot represent at all', async () => {
    // The gap Q9 exists to close: `InsurerFormTemplate.insurerMasterId` is NOT NULL, so for a
    // company in no catalogue a form template was not unmapped — it was unrepresentable.
    const created = await request(app!.getHttpServer())
      .post(`/insurers/${localOnly.id}/form-templates`)
      .set(bearer(placement.accessToken))
      .send({ lineId: travelLineId, fields: fields() })
      .expect(201);
    expect((created.body as { insurerId: string }).insurerId).toBe(
      localOnly.id,
    );
  }, 300_000);

  it('records a re-map as a NEW version and keeps the old one', async () => {
    const first = await request(app!.getHttpServer())
      .post(`/insurers/${localOnly.id}/form-templates`)
      .set(bearer(placement.accessToken))
      .send({ lineId: motorLineId, fields: fields() })
      .expect(201);
    const second = await request(app!.getHttpServer())
      .post(`/insurers/${localOnly.id}/form-templates`)
      .set(bearer(placement.accessToken))
      .send({ lineId: motorLineId, fields: fields() })
      .expect(201);
    expect((first.body as { version: number }).version).toBe(1);
    expect((second.body as { version: number }).version).toBe(2);

    const listed = await request(app!.getHttpServer())
      .get(`/insurers/${localOnly.id}/form-templates?lineId=${motorLineId}`)
      .set(bearer(placement.accessToken))
      .expect(200);
    const versions = (listed.body as { version: number }[]).map(
      (t) => t.version,
    );
    // Newest first, and version 1 is still there: a re-map never edits the mapping this office
    // is already submitting against.
    expect(versions).toEqual([2, 1]);
  }, 300_000);
});

describe('which mapping to submit against', () => {
  it('falls back to the SHARED mapping and says so', async () => {
    // The master-linked insurer has a global motor mapping (first test) and no office mapping
    // for motor. So the only available answer is the shared one, and the caller is told.
    const resolved = await request(app!.getHttpServer())
      .get(
        `/insurers/${masterLinked.id}/form-templates/resolved?lineId=${motorLineId}`,
      )
      .set(bearer(placement.accessToken))
      .expect(200);
    const body = resolved.body as {
      source: string;
      template: { insurerMasterId?: string; insurerId?: string };
    };
    expect(body.source).toBe('SHARED');
    expect(body.template.insurerMasterId).toBe(masterLinked.insurerMasterId);
  }, 300_000);

  it("prefers this office's OWN mapping once it exists, without touching the shared one", async () => {
    await request(app!.getHttpServer())
      .post(`/insurers/${masterLinked.id}/form-templates`)
      .set(bearer(placement.accessToken))
      .send({ lineId: motorLineId, fields: fields() })
      .expect(201);

    const resolved = await request(app!.getHttpServer())
      .get(
        `/insurers/${masterLinked.id}/form-templates/resolved?lineId=${motorLineId}`,
      )
      .set(bearer(placement.accessToken))
      .expect(200);
    const body = resolved.body as {
      source: string;
      template: { insurerId?: string };
    };
    expect(body.source).toBe('OFFICE');
    expect(body.template.insurerId).toBe(masterLinked.id);

    // And the SHARED row is untouched and still version 1 — an office override is not an edit.
    const shared = await rawPrisma.insurerFormTemplate.findMany({
      where: {
        insurerMasterId: masterLinked.insurerMasterId,
        insuranceLineId: motorLineId,
      },
    });
    expect(shared.map((t) => t.version)).toEqual([1]);
  }, 300_000);

  it('answers null when nobody has mapped it, which §5 says is a real answer', async () => {
    // A locally registered company on a line nothing has mapped: there is no master, so there
    // is no shared row to fall back to either. §5 is explicit that the submission then falls
    // back to the generic structured fields, so null is an answer and not an error.
    const resolved = await request(app!.getHttpServer())
      .get(
        `/insurers/${localOnly.id}/form-templates/resolved?lineId=${officeLineId}`,
      )
      .set(bearer(placement.accessToken))
      .expect(200);
    expect(resolved.body).toEqual({});
  }, 300_000);
});

describe('the office boundary', () => {
  it("404s another office's insurer rather than 403", async () => {
    // A 404 and not a 403: "not yours" and "does not exist" must be indistinguishable to
    // someone probing ids, or the error code itself confirms which companies another office
    // deals with.
    await rawPrisma.organization.create({
      data: {
        id: ORG_B_ID,
        legalName: 'Q9 Office B',
        legalNameAr: 'مكتب ب',
        subdomain: `q9-office-b-${tag}`,
      },
    });
    const otherOfficeInsurer = await rawPrisma.insurer.create({
      data: {
        organizationId: ORG_B_ID,
        legalName: `${FIXTURE_PREFIX} Office B Co ${tag}`,
        legalNameAr: `${FIXTURE_PREFIX} شركة ب ${tag}`,
      },
    });

    await request(app!.getHttpServer())
      .get(`/insurers/${otherOfficeInsurer.id}/form-templates`)
      .set(bearer(placement.accessToken))
      .expect(404);
    await request(app!.getHttpServer())
      .post(`/insurers/${otherOfficeInsurer.id}/form-templates`)
      .set(bearer(placement.accessToken))
      .send({ lineId: motorLineId, fields: fields() })
      .expect(404);
  }, 300_000);

  it('refuses a cross-office template at the DATABASE, not only in the service', async () => {
    // The composite FK, planted inside a rolled-back transaction. The simple `insurerId` FK is
    // satisfied — the insurer exists — so only the composite can refuse this, which is what
    // makes the boundary structural rather than a filter somebody has to remember.
    const otherOfficeInsurer = await rawPrisma.insurer.findFirstOrThrow({
      where: { organizationId: ORG_B_ID },
    });
    await expect(
      rawPrisma.$transaction(async (tx) => {
        await tx.officeInsurerFormTemplate.create({
          data: {
            organizationId: '00000000-0000-0000-0000-000000000001',
            insurerId: otherOfficeInsurer.id,
            insuranceLineId: motorLineId,
            createdByUserId: placement.userId,
          },
        });
      }),
    ).rejects.toThrow(/same_org_fkey|foreign key/i);
  }, 300_000);
});

describe('the new permission gates something', () => {
  it('lets a reader LIST and refuses to let them MAP', async () => {
    // `insurer.read` without `insurer.office-form.map`. The pair exists because the global
    // `insurer.form.map` is withheld from the office administrator for crossing offices — a
    // reason that does not apply here — so collapsing them would either deny an administrator
    // their own forms or hand them a platform-wide write.
    await request(app!.getHttpServer())
      .get(`/insurers/${localOnly.id}/form-templates`)
      .set(bearer(readOnly.accessToken))
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/insurers/${localOnly.id}/form-templates`)
      .set(bearer(readOnly.accessToken))
      .send({ lineId: travelLineId, fields: fields() })
      .expect(403);
  }, 300_000);
});

describe('what a bad request gets told', () => {
  it('422s a line id nothing answers to, rather than an empty list', async () => {
    // A WELL-FORMED uuid that no line has, deliberately: a malformed one is a 400 from the DTO
    // and never reaches the lookup, so it would prove the wrong guard. The first draft used
    // `...00000000dead`, which is not a valid uuid, and the test went red against correct code.
    const response = await request(app!.getHttpServer())
      .get(
        `/insurers/${localOnly.id}/form-templates?lineId=11111111-1111-4111-8111-111111111111`,
      )
      .set(bearer(placement.accessToken))
      .expect(422);
    expect((response.body as { message: string }).message).toContain(
      '/insurance-lines',
    );
  }, 300_000);

  it('400s a line NAME where an id belongs', async () => {
    await request(app!.getHttpServer())
      .post(`/insurers/${localOnly.id}/form-templates`)
      .set(bearer(placement.accessToken))
      .send({ lineId: 'Motor Comprehensive', fields: fields() })
      .expect(400);
  }, 300_000);

  it('422s a duplicate field key and an ENUM with no options', async () => {
    const duplicate = await request(app!.getHttpServer())
      .post(`/insurers/${localOnly.id}/form-templates`)
      .set(bearer(placement.accessToken))
      .send({
        lineId: travelLineId,
        fields: [
          { fieldKey: 'same', labelEn: 'A', dataType: 'TEXT', displayOrder: 0 },
          { fieldKey: 'SAME', labelEn: 'B', dataType: 'TEXT', displayOrder: 1 },
        ],
      })
      .expect(422);
    expect((duplicate.body as { message: string }).message).toContain('same');

    await request(app!.getHttpServer())
      .post(`/insurers/${localOnly.id}/form-templates`)
      .set(bearer(placement.accessToken))
      .send({
        lineId: travelLineId,
        fields: [
          {
            fieldKey: 'pick_one',
            labelEn: 'Pick one',
            dataType: 'ENUM',
            displayOrder: 0,
          },
        ],
      })
      .expect(422);
  }, 300_000);
});

describe('the act is attributable', () => {
  it('writes an audit entry naming the template and which catalogue the line came from', async () => {
    const created = await request(app!.getHttpServer())
      .post(`/insurers/${localOnly.id}/form-templates`)
      .set(bearer(placement.accessToken))
      .send({ lineId: officeLineId, fields: fields() })
      .expect(201);
    const templateId = (created.body as { id: string }).id;

    const entry = await rawPrisma.auditLogEntry.findFirstOrThrow({
      where: { entityType: 'OfficeInsurerFormTemplate', entityId: templateId },
    });
    expect(entry.userId).toBe(placement.userId);
    expect(entry.action).toBe('CREATE');
    const after = entry.afterValue as Record<string, unknown>;
    // BOTH line columns, so the entry says which catalogue without the reader joining to two
    // tables to find out.
    expect(after.officeInsuranceLineId).toBe(officeLineId);
    expect(after.insuranceLineId).toBeNull();
    // And the role the actor HELD, which the audit work added and which cannot be backfilled.
    expect(entry.actorRoleNames).toContain('PLACEMENT_TECHNICAL_OFFICER');
  }, 300_000);
});

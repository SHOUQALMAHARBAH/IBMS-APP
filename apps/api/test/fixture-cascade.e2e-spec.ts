import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deleteOrganizationCascade,
  rawPrisma,
  TEST_ORGANIZATION_ID,
} from './tenant-prisma';

/**
 * THE FIXTURE CASCADE, PROVEN AGAINST WHAT THE SEED'S PER-ORGANIZATION SWEEPS ACTUALLY ATTACH.
 *
 * ## Why this file exists, and it is the second instance of one defect
 *
 * The seed has THREE functions that walk `organization.findMany()` and write a row into every
 * organization. A disposable fixture organization is one of those rows, so one `db:test:seed` run
 * after a leak attaches rows to it — and every FK involved is RESTRICT, which makes that fixture
 * PERMANENTLY undeletable and takes down every later spec in the run at `createTestApp` with a
 * fault that looks like its own.
 *
 *   * 2026-10-20 — decision 25's `PasswordResetToken` broke two teardowns. CI went red with eleven
 *     leaked organizations. Fixed, and the rule written as a COMMENT.
 *   * That comment then listed the sweeps as "branches, departments and holidays" — two sweeps
 *     counted as three models. `ensureBrokerLicenseTerms` is a third, writing a licence plus its
 *     certificate `Document`, and the cascade cleared neither. It had not fired only because eleven
 *     of the twelve leaks were `INSURANCE_COMPANY` and that sweep filters on `BROKERAGE_OFFICE`.
 *     The TYPE spared us, not the code.
 *
 * So the rule is now DERIVED in CI (`scripts/measurements/seed-sweeps-vs-cascade.py --check`), and
 * this file proves the helper against the rows rather than against the derivation — a script that
 * reads `seed.ts` can be fooled by a write it cannot see; a row in the database cannot.
 *
 * ## THE REFUSAL IS ASSERTED FIRST, and that is the point
 *
 * The first test attempts a bare `organization.delete` with every sweep's rows attached and asserts
 * it is REFUSED. Without that half, the second test passes against a database where none of those
 * FKs restrict anything, and the guard would be reporting a property it never exercised.
 */

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let officeId = '';
let uploaderUserId = '';

/** Exactly what the three sweeps attach, by name, so a reader can check the set against `seed.ts`. */
async function attachWhatTheSweepsAttach(organizationId: string) {
  // ensureDefaultOrgUnitsForEveryOrganization -> Branch, Department
  await rawPrisma.branch.create({
    data: { organizationId, name: `Head office ${RUN}` },
  });
  await rawPrisma.department.create({
    data: { organizationId, name: `Operations ${RUN}` },
  });
  // ensureJordanFixedHolidays -> SlaHoliday
  await rawPrisma.slaHoliday.create({
    data: {
      organizationId,
      observedOn: new Date(Date.UTC(2031, 0, 1)),
      name: `Fixture holiday ${RUN}`,
    },
  });
  // ensureBrokerLicenseTerms -> Document (the certificate) then BrokerLicense, both rows or neither
  const certificate = await rawPrisma.document.create({
    data: {
      organizationId,
      category: 'BROKER_LICENSE_CERTIFICATE',
      classification: 'INTERNAL',
      fileName: `fixture-cascade-certificate-${RUN}.pdf`,
      storageRef: `fixture:cascade:${RUN}`,
      uploadedByUserId: uploaderUserId,
    },
    select: { id: true },
  });
  const licence = await rawPrisma.brokerLicense.create({
    data: {
      organizationId,
      licenseNumber: `CBJ-FIXTURE-${RUN}`,
      issuedAt: new Date(Date.UTC(2030, 0, 1)),
      expiresAt: new Date(Date.UTC(2032, 11, 31)),
      certificateDocumentId: certificate.id,
    },
    select: { id: true },
  });
  /*
   * And a scope line, because `BrokerLicenseScopeLine_brokerLicenseId_fkey` is RESTRICT too — a
   * chain three deep (Document <- BrokerLicense <- Organization, plus the scope line under the
   * licence). A test that attached only the licence would pass against a cascade that forgot this.
   */
  const line = await rawPrisma.insuranceLine.findFirstOrThrow({
    select: { id: true },
    orderBy: { displayOrder: 'asc' },
  });
  await rawPrisma.brokerLicenseScopeLine.create({
    data: {
      organizationId,
      brokerLicenseId: licence.id,
      insuranceLineId: line.id,
    },
  });
  return { certificateId: certificate.id, licenceId: licence.id };
}

/**
 * SWEEP ON ENTRY, BY HAND RATHER THAN THROUGH THE HELPER UNDER TEST.
 *
 * This file's FIRST version created a second BROKERAGE_OFFICE, and `createTestApp` asserts there is
 * exactly one — so it failed every concurrently-running spec for as long as its fixture existed.
 * Measured: `brokerage-office-registration` and `company-administrator-invitation` both refused at
 * `createTestApp` naming `fx-cascade-…` while this file itself passed. The harness was right and
 * this file was the leak. The fixture is an `INSURANCE_COMPANY` now (see `beforeAll`), so the
 * coexistence hazard is gone — and this sweep stays, because a leftover of any type is still a row
 * nobody decided to keep.
 *
 * The removal here is spelled out rather than calling `deleteOrganizationCascade`, deliberately: a
 * spec whose self-healing runs through the very helper it is testing cannot heal itself on the one
 * run where that helper is broken, which is exactly the run that needs it.
 */
async function sweepOwnLeftovers() {
  const leftovers = await rawPrisma.organization.findMany({
    where: { subdomain: { startsWith: 'fx-cascade-' } },
    select: { id: true },
  });
  for (const { id } of leftovers) {
    const licences = await rawPrisma.brokerLicense.findMany({
      where: { organizationId: id },
      select: { id: true, certificateDocumentId: true },
    });
    await rawPrisma.brokerLicenseScopeLine.deleteMany({
      where: { organizationId: id },
    });
    await rawPrisma.brokerLicense.deleteMany({ where: { organizationId: id } });
    await rawPrisma.document.deleteMany({
      where: { id: { in: licences.map((l) => l.certificateDocumentId) } },
    });
    await rawPrisma.document.deleteMany({ where: { organizationId: id } });
    await rawPrisma.slaHoliday.deleteMany({ where: { organizationId: id } });
    await rawPrisma.branch.deleteMany({ where: { organizationId: id } });
    await rawPrisma.department.deleteMany({ where: { organizationId: id } });
    await rawPrisma.organization.deleteMany({ where: { id } });
  }
}

beforeAll(async () => {
  // On ENTRY as well as on exit, because an `afterAll` is exactly what cannot be relied on.
  await sweepOwnLeftovers();

  const uploader = await rawPrisma.user.findFirstOrThrow({
    where: { organizationId: TEST_ORGANIZATION_ID },
    select: { id: true },
  });
  uploaderUserId = uploader.id;

  const office = await rawPrisma.organization.create({
    data: {
      legalName: `Fixture Cascade Office ${RUN}`,
      legalNameAr: `مكتب اختبار التنظيف ${RUN}`,
      /*
       * AN INSURANCE_COMPANY, NOT A BROKERAGE OFFICE, AND THE REASON IS A REAL CONSTRAINT.
       *
       * `createTestApp` asserts there is exactly ONE brokerage office, so a fixture of that type
       * fails every concurrently-running spec for as long as it exists — measured: this file's
       * first version created one and `brokerage-office-registration` and
       * `company-administrator-invitation` both refused at `createTestApp` naming it, while this
       * file itself passed. The harness was right.
       *
       * It costs nothing here. The licence chain is attached BY HAND below, and
       * `BrokerLicense_organizationId_fkey` points at `Organization` with no type condition — so
       * the rows, the RESTRICTs and the cascade behave identically. What this file does NOT cover
       * is the real sweep's `where: { type: 'BROKERAGE_OFFICE' }` filter, and that is covered
       * elsewhere: by the derivation gate, and by the live leak-and-reseed run which showed the
       * branch/department/holiday rows attaching to a leaked OFFICE.
       */
      type: 'INSURANCE_COMPANY',
      subdomain: `fx-cascade-${RUN}`,
      updatedAt: new Date(),
    },
    select: { id: true },
  });
  officeId = office.id;
}, 120_000);

afterAll(async () => {
  /*
   * Belt and braces: if either test below failed part-way, this leaves nothing behind. It is the
   * same helper under test, which is acceptable here and ONLY here — the tests assert its effect,
   * so a broken helper fails them loudly before this line is reached.
   */
  if (officeId) {
    await deleteOrganizationCascade(officeId).catch(() => undefined);
  }
  /*
   * And then by hand, unconditionally. The line above is the helper under test and may be the
   * thing that is broken; this one is what guarantees the file leaves nothing behind either way,
   * because `createTestApp` asserts exactly one brokerage office and this file creates a second.
   */
  await sweepOwnLeftovers();
}, 120_000);

describe('the fixture cascade against the seed per-organization sweeps', () => {
  it('REFUSES a bare organization delete once the sweeps rows are attached — so the test below is not vacuous', async () => {
    await attachWhatTheSweepsAttach(officeId);

    let refusal: string | null = null;
    try {
      await rawPrisma.organization.delete({ where: { id: officeId } });
    } catch (error) {
      refusal = (error as Error).message.replace(/\s+/g, ' ');
    }

    expect(
      refusal,
      'a bare organization delete SUCCEEDED with a branch, a department, a holiday, a licence, its ' +
        'certificate and a scope line attached. Then none of those FKs restricts anything on this ' +
        'database, and the cascade test below proves nothing.',
    ).not.toBeNull();
    // It names the first FK it hits. Which one is not the assertion — that it is refused at all is.
    expect(refusal).toMatch(/violates|constraint/i);
  }, 120_000);

  it('removes the organization through deleteOrganizationCascade, licence and certificate included', async () => {
    /*
     * The rows from the previous test are still attached — the refusal above left them in place,
     * which is exactly the state a leaked fixture is in after a `db:test:seed` run.
     */
    await deleteOrganizationCascade(officeId);

    expect(
      await rawPrisma.organization.count({ where: { id: officeId } }),
      'the organization survived the cascade',
    ).toBe(0);
    // And nothing of its is left orphaned behind it.
    expect(
      await rawPrisma.brokerLicense.count({
        where: { organizationId: officeId },
      }),
    ).toBe(0);
    expect(
      await rawPrisma.document.count({ where: { organizationId: officeId } }),
    ).toBe(0);
    expect(
      await rawPrisma.slaHoliday.count({ where: { organizationId: officeId } }),
    ).toBe(0);
    expect(
      await rawPrisma.branch.count({ where: { organizationId: officeId } }),
    ).toBe(0);
    expect(
      await rawPrisma.department.count({ where: { organizationId: officeId } }),
    ).toBe(0);
    officeId = '';
  }, 120_000);
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { createTestApp } from './utils/test-app';
import { rawPrisma } from './tenant-prisma';
import { OrgContextService } from '../src/common/org-context/org-context.service';
import { CompanyRecordService } from '../src/modules/company/company-record.service';

/**
 * REGISTER ENTRY 38 — THE COMPANY'S OWN-RECORD RESPONSE SHAPE, AGAINST THE REAL PRODUCER.
 *
 * ## THE OWNER NAMED WHICH TEST MATTERS, AND THIS FILE IS BUILT AROUND HER SENTENCE
 *
 *   "The test that matters is the one proving the response does not carry what we excluded. That test
 *    defends the owner's decision, not the code."
 *
 * So the centre of this file is an EXACT KEY SET at both levels plus a sweep for the excluded nouns BY
 * NAME. The exact set is what catches the realistic leak — somebody adding a convenient key to a
 * response a company reads — because a leak arrives as an ADDITION, and every `toHaveProperty` in the
 * world keeps passing while one appears. The noun sweep is the second half: an exact set says the
 * shape is what it was, and the sweep says what that shape must never mention however it is spelled.
 *
 * ## WHY THIS IS NOT AN HTTP TEST, MEASURED RATHER THAN PREFERRED
 *
 * Reaching `GET /company/registry-record` over HTTP needs a signed-in user INSIDE the company, and
 * authenticating writes append-only `AuditLogEntry` rows into that company's own tenant.
 * `AuditLogEntry_organizationId_fkey` is `ON DELETE RESTRICT` and the `audit_log_entry_no_delete`
 * trigger refuses DELETE on the table outright, so ONE login makes that organization permanent and
 * db-test would gain a company per run — two brokerage offices were stranded proving exactly this in
 * item (d), and clearing them needed the trigger disabled and re-enabled by hand.
 *
 * So the service is called inside `orgContext.runAs`, which `last-administrator-lock.e2e-spec.ts`
 * already establishes as "the same code path a request takes after `JwtStrategy` has established the
 * office". Real service, real Prisma, real database, real RLS context, no login.
 *
 * ## WHAT THIS PROVES AND WHAT IT DOES NOT — stated, because the gap is the reason entry 38 exists
 *
 * PROVES: the exact shape the real producer returns from the real database, every exclusion, the
 * derivation of `licensedCategories`, and that the type gate refuses a brokerage office with a
 * sentence naming the type.
 *
 * DOES NOT PROVE: the HTTP transport — the controller's serialisation, the guard chain, the status
 * code. `company-administrator-invitation.e2e-spec.ts` covers the route's reachability and its
 * refusals, and `company-record.spec.ts` (Playwright) covers the screen against a mocked body. What
 * was missing and is now closed is the middle: that the SHAPE those two agree about is the shape the
 * service actually produces.
 *
 * ## THE AUDIT ROW IS ROUTED TO THE DEFAULT OFFICE ON PURPOSE, AND THAT IS THE ONE ARTIFICIAL PART
 *
 * `AuditService.record` uses its own client, so the row lands in whatever organization the surrounding
 * `runAs` names. Naming the company would strand it — the very thing above. So the block runs as the
 * DEFAULT OFFICE (permanent, and already full of audit rows) while the ACTOR's `organizationId` is the
 * company, which is the only input `ownRecord` reads to decide whose record to show.
 *
 * The one consequence is bounded and stated: `Document` IS tenant-owned, so a certificate belonging to
 * the company is not visible from the default office's context. The fixture therefore holds NO
 * certificate and asserts the null branch — `certificate: null` with `certificateOnRecord: false`,
 * which is a real state a newly registered company is in. The non-null branch is covered by the
 * Playwright test, and the KEY SET — the thing that matters — is identical either way, because the key
 * is present and null rather than absent.
 */

let app: INestApplication<App>;
let orgContext: OrgContextService;
let service: CompanyRecordService;

let companyId: string;
let officeId: string;
let actorUserId: string;
let generalLineCode: string;
let lifeLineCode: string;

const SUBDOMAIN = `shape-co-${Date.now()}`;

async function sweep(): Promise<void> {
  const leftovers = await rawPrisma.organization.findMany({
    where: {
      type: 'INSURANCE_COMPANY',
      subdomain: { startsWith: 'shape-co-' },
    },
    select: { id: true },
  });
  for (const { id } of leftovers) {
    await rawPrisma.insurerLicensedLine.deleteMany({
      where: { insuranceCompanyId: id },
    });
    await rawPrisma.organization.delete({ where: { id } });
  }
}

beforeAll(async () => {
  // ON ENTRY AS WELL AS ON EXIT: an `afterAll` is exactly what cannot be relied on — one threw in a
  // sibling spec in this module and left seven organizations behind.
  await sweep();
  app = await createTestApp();
  orgContext = app.get(OrgContextService);
  service = app.get(CompanyRecordService);

  const office = await rawPrisma.organization.findFirstOrThrow({
    where: { type: 'BROKERAGE_OFFICE' },
    select: { id: true },
  });
  officeId = office.id;
  const actor = await rawPrisma.user.findFirstOrThrow({
    where: { organizationId: officeId },
    select: { id: true },
  });
  actorUserId = actor.id;

  const lines = await rawPrisma.insuranceLine.findMany({
    select: { id: true, code: true, category: true },
    orderBy: { code: 'asc' },
  });
  const general = lines.find((l) => l.category === 'GENERAL');
  const life = lines.find((l) => l.category === 'LIFE');
  expect(general, 'db-test must hold a GENERAL line').toBeTruthy();
  expect(life, 'db-test must hold a LIFE line').toBeTruthy();
  generalLineCode = general!.code;
  lifeLineCode = life!.code;

  const company = await rawPrisma.organization.create({
    data: {
      legalName: 'Shape Fixture Insurance Company',
      legalNameAr: 'شركة تأمين لاختبار الشكل',
      type: 'INSURANCE_COMPANY',
      subdomain: SUBDOMAIN,
      insurerLicenseNumber: `SHAPE-${Date.now()}`,
    },
    select: { id: true },
  });
  companyId = company.id;

  // TWO lines in TWO categories, so `licensedCategories` is a derivation with something to derive
  // rather than a one-element array any implementation would produce.
  await rawPrisma.insurerLicensedLine.createMany({
    data: [
      { insuranceCompanyId: companyId, insuranceLineId: general!.id },
      { insuranceCompanyId: companyId, insuranceLineId: life!.id },
    ],
  });
}, 300_000);

afterAll(async () => {
  await sweep();
  await app?.close();
}, 300_000);

function readOwnRecord(organizationId: string) {
  return orgContext.runAs(officeId, () =>
    service.ownRecord({ id: actorUserId, organizationId }),
  );
}

describe("the company's own registry record — what the response carries", () => {
  it('has EXACTLY five top-level keys, so a sixth is a decision rather than a diff', async () => {
    const body = await readOwnRecord(companyId);
    /*
     * AN EXACT SET, NOT A SUBSET. A company reads this screen, so the realistic failure is a key
     * ADDED for a plausible reason — a rating, a list of offices, a premium total — and every subset
     * assertion keeps passing while that happens. This one fails by name.
     */
    expect(Object.keys(body).sort()).toEqual([
      'certificate',
      'identity',
      'licensedCategories',
      'licensedLines',
      'recordState',
    ]);
  }, 300_000);

  it('identity carries EXACTLY the registry columns, and no more', async () => {
    const body = await readOwnRecord(companyId);
    expect(Object.keys(body.identity).sort()).toEqual([
      'address',
      'businessModel',
      'city',
      'claimsEmail',
      'code',
      'commercialRegistrationNo',
      'country',
      'email',
      'id',
      'insurerLicenseNumber',
      'integrationMethod',
      'legalForm',
      'legalName',
      'legalNameAr',
      'licensingAuthority',
      'nationalEstablishmentNo',
      'phone',
      'quotationEmail',
      'registeredAt',
      'shortName',
      'taxNumber',
      'website',
    ]);
  }, 300_000);

  it('CARRIES NONE OF THE FOUR EXCLUSIONS — the test that defends the decision', async () => {
    const body = await readOwnRecord(companyId);
    const serialised = JSON.stringify(body).toLowerCase();

    /*
     * EACH NOUN ONE AT A TIME, with its own message, because a single combined regex tells you a leak
     * exists and not which decision it broke. The four absences are the service's own header, and
     * each is somebody else's fact rather than a feature nobody got to:
     *
     *   RATING — `Insurer.financialStrengthRating` is ONE OFFICE's private judgement of this company
     *   as a counterparty, on an office-owned row. A company deals with many offices.
     *
     *   LINKED OFFICES — which offices chose to work with this company is each office's own commercial
     *   fact, held on `Insurer.insuranceCompanyId`.
     *
     *   CUSTOMER / MONEY / POLICY — none of it is the company's, and none of it is even reachable from
     *   here: every one of those models carries `organizationId`.
     *
     *   ANOTHER ORGANIZATION'S RECORD — the id is never taken from the request. The type-gate test
     *   below proves that half.
     */
    /*
     * THE NOUN LIST WAS TOO BLUNT ON ITS FIRST RUN, AND THE CORRECTION IS THE INTERESTING PART.
     *
     * It began with a bare `insurer`, which failed immediately — on `insurerLicenseNumber`, the
     * company's OWN licence number, which is the most legitimate field on the whole response. The
     * exclusion is not the WORD; it is the office-owned `Insurer` row's relationship columns. A sweep
     * coarse enough to flag a company's own licence number is a sweep somebody deletes the first time
     * it goes red, so the nouns below name the leaking fields rather than the subject area.
     */
    for (const noun of [
      'rating',
      'financialstrength',
      'creditterms',
      'rfqcontact',
      'claimscontact',
      'underwriter',
      'linesoffered',
      'insurancecompanyid',
      'isofficelocal',
      'insurermasterid',
      'brokerage',
      'customer',
      'policy',
      'premium',
      'commission',
      'invoice',
      'receipt',
      'remittance',
    ]) {
      expect(
        serialised.includes(noun),
        `the company own-record response mentions "${noun}". Read the four absences in company-record.service.ts before adding anything here: three of them are another party's fact and one is a tenancy boundary`,
      ).toBe(false);
    }
  }, 300_000);

  it('derives licensedCategories from the lines, and stores them nowhere', async () => {
    const body = await readOwnRecord(companyId);
    // DECISION 67, the same rule that governs a broker's licence types: the categories ARE the
    // distinct categories of the licensed lines, so a column beside them would be a second home.
    expect(body.licensedCategories).toEqual(['GENERAL', 'LIFE']);
    expect(body.licensedLines.map((l) => l.code).sort()).toEqual(
      [generalLineCode, lifeLineCode].sort(),
    );
    // Each line carries exactly four keys — the catalogue's own, with no office-side anything.
    for (const line of body.licensedLines) {
      expect(Object.keys(line).sort()).toEqual([
        'category',
        'code',
        'nameAr',
        'nameEn',
      ]);
    }
    expect(body.recordState).toEqual({
      certificateOnRecord: false,
      licensedLineCount: 2,
    });
    // The null branch, which is the state a company is in the moment it is registered.
    expect(body.certificate).toBeNull();
  }, 300_000);

  it('REFUSES a brokerage office with a sentence naming the type, never an empty body', async () => {
    /*
     * The authorization IS the type check, so this is the assertion that it exists at all. An empty
     * response would read as "there is nothing here" when the truth is "this screen is not for you" —
     * the rule item (j)'s provider route established.
     */
    await expect(readOwnRecord(officeId)).rejects.toThrow(/BROKERAGE_OFFICE/);
    await expect(readOwnRecord(officeId)).rejects.toThrow(
      /regulatory-compliance/,
    );
  }, 300_000);

  it('AUDITS the read with counts, and copies no content into the log', async () => {
    await readOwnRecord(companyId);
    const rows = await rawPrisma.auditLogEntry.findMany({
      where: {
        entityType: 'Organization',
        entityId: companyId,
        action: 'READ',
      },
      select: { afterValue: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    const after = rows[rows.length - 1].afterValue as Record<string, unknown>;
    /*
     * COUNTS ONLY — the `ProviderOfficeState` rule. Who looked at the record is worth recording;
     * copying the record into an append-only table that can never be corrected would put the same
     * facts in two places, one of them unfixable.
     */
    expect(Object.keys(after).sort()).toEqual([
      'certificateOnRecord',
      'licensedLineCount',
      'surface',
    ]);
    expect(JSON.stringify(after)).not.toContain('Shape Fixture');
  }, 300_000);
});

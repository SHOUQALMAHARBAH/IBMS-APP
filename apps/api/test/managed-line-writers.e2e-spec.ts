import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma, rawPrisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';
import { makeInsurer } from './insurer-fixture';
import { COVERAGE_LINE_CODES } from '../src/modules/insurance-program/insurance-program.config';

/**
 * Do the WRITERS populate the managed-line FK?
 *
 * Migration `20261019100000` gave four models a line FK and backfilled every row that existed.
 * It changed no writer, so every row written afterwards carried NULL on both FK columns —
 * measured three days later as 6 unmapped `InsuranceProgramLine` and 4 unmapped `RFQ` rows on two
 * models the migration had mapped 100% (IMPROVEMENTS.md § 1.40). Nothing was broken, because
 * nothing read the column; the gap only became visible because somebody asked what the number
 * should have been.
 *
 * This file is the guard that the gap does not reopen. It is written around the property the four
 * models exist for — **a line must MATCH another model's** — so the assertions are about identity
 * flowing along the chain, not about any single row:
 *
 *     programme line  --inherits-->  RFQ  --inherits-->  Policy
 *     commission agreement  --matched to a Policy BY that identity-->
 *
 * Every assertion reads the DATABASE ROW rather than the API response. A response shape is a view
 * and could carry a resolved line while the stored column is null, which is exactly the failure
 * being guarded against.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const tag = Math.random().toString(36).slice(2, 8);
const FIXTURE_PREFIX = 'Line Writers';

let app: INestApplication<App> | null = null;
let placement: { accessToken: string; userId: string };
let rateManager: { accessToken: string; userId: string };
let motorLineId: string;
let propertyLineId: string;

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` } as Record<string, string>;
}

async function makeUser(label: string, ...roleNames: string[]) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Writers ${label}`, email, password: PASSWORD })
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
  const enrolled = enroll.body as { credentialId: string; otpAuthUri: string };
  const secret = /[?&]secret=([^&]+)/.exec(enrolled.otpAuthUri)![1];
  await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(body.accessToken))
    .send({
      credentialId: enrolled.credentialId,
      code: authenticator.generate(secret),
    })
    .expect(200);

  for (const roleName of roleNames) {
    const role = await ensureRole(roleName);
    await prisma.userRoleAssignment.create({
      data: { userId: body.user.id, roleId: role.id },
    });
  }
  return { accessToken: body.accessToken, userId: body.user.id };
}

/**
 * An Opportunity ready to take to market, whose programme line CARRIES a managed-line FK.
 *
 * Built with Prisma rather than through the needs-assessment chain: what is under test here is
 * whether `POST /rfqs` copies the identity it is given, and the shortest fixture that can answer
 * that is a programme line with a known FK. The programme-line WRITER is asserted separately, on
 * its own API path, in `insurance-program.e2e-spec.ts`.
 */
async function marketReadyOpportunity(
  ownerUserId: string,
  line: { insuranceLine: string; insuranceLineId: string | null },
): Promise<{ opportunityId: string; programmeLineId: string }> {
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `${FIXTURE_PREFIX} Customer ${tag}-${Math.random().toString(36).slice(2, 6)}`,
      ownerUserId,
    },
  });
  const riskProfile = await prisma.riskProfile.create({
    data: { customerId: customer.id, siteLabel: 'HQ' },
  });
  const program = await prisma.insuranceProgram.create({
    data: { riskProfileId: riskProfile.id, status: 'FINALIZED' },
  });
  const opportunity = await prisma.opportunity.create({
    data: {
      customerId: customer.id,
      insuranceProgramId: program.id,
      status: 'NEEDS_CONFIRMED',
    },
  });
  const programmeLine = await prisma.insuranceProgramLine.create({
    data: {
      insuranceProgramId: program.id,
      insuranceLine: line.insuranceLine,
      insuranceLineId: line.insuranceLineId,
    },
  });
  return { opportunityId: opportunity.id, programmeLineId: programmeLine.id };
}

/**
 * A fixture insurer is MASTER-LINKED, so its own `legalName` is NULL and the name lives on
 * `InsurerMaster` — `insurer-identity.ts`'s whole reason for existing. A teardown filtering on
 * `insurer.legalName` therefore matches nothing and leaves children behind; this one matches
 * either side of the split. Found the direct way: the first run left `RFQInsurer` rows and the
 * RFQ delete hit `RFQInsurer_rfqId_fkey`'s RESTRICT.
 */
const FIXTURE_INSURER = {
  OR: [
    { legalName: { startsWith: FIXTURE_PREFIX } },
    { insurerMaster: { legalName: { startsWith: FIXTURE_PREFIX } } },
  ],
};

async function removeFixtures(): Promise<void> {
  await rawPrisma.commissionAgreement.deleteMany({
    where: { insurer: FIXTURE_INSURER },
  });
  await rawPrisma.rFQInsurer.deleteMany({
    where: {
      OR: [
        { insurer: FIXTURE_INSURER },
        {
          rfq: {
            opportunity: {
              customer: { legalName: { startsWith: FIXTURE_PREFIX } },
            },
          },
        },
      ],
    },
  });
  await rawPrisma.rFQ.deleteMany({
    where: {
      opportunity: { customer: { legalName: { startsWith: FIXTURE_PREFIX } } },
    },
  });
  await rawPrisma.insuranceProgramLine.deleteMany({
    where: {
      insuranceProgram: {
        riskProfile: {
          customer: { legalName: { startsWith: FIXTURE_PREFIX } },
        },
      },
    },
  });
  await rawPrisma.opportunity.deleteMany({
    where: { customer: { legalName: { startsWith: FIXTURE_PREFIX } } },
  });
  await rawPrisma.insuranceProgram.deleteMany({
    where: {
      riskProfile: { customer: { legalName: { startsWith: FIXTURE_PREFIX } } },
    },
  });
  await rawPrisma.riskProfile.deleteMany({
    where: { customer: { legalName: { startsWith: FIXTURE_PREFIX } } },
  });
  await rawPrisma.customer.deleteMany({
    where: { legalName: { startsWith: FIXTURE_PREFIX } },
  });
  await rawPrisma.insurer.deleteMany({ where: FIXTURE_INSURER });
  await rawPrisma.insurerMaster.deleteMany({
    where: { legalName: { startsWith: FIXTURE_PREFIX } },
  });
}

beforeAll(async () => {
  await removeFixtures();
  app = await createTestApp();
  placement = await makeUser(
    `lw-plc-${tag}`,
    'PLACEMENT_TECHNICAL_OFFICER',
    'SALES_RELATIONSHIP_OFFICER',
  );
  // `commission-rate.manage` is Compliance / Manager — Finance may APPLY the governed rate but
  // never alter the table. Using the wrong role here would 403 and look like a writer bug.
  rateManager = await makeUser(`lw-rate-${tag}`, 'COMPLIANCE_OFFICER');

  const motor = await rawPrisma.insuranceLine.findFirstOrThrow({
    where: { code: 'MOTOR_COMPREHENSIVE' },
  });
  const property = await rawPrisma.insuranceLine.findFirstOrThrow({
    where: { code: 'PROPERTY_ALL_RISKS' },
  });
  motorLineId = motor.id;
  propertyLineId = property.id;
}, 600_000);

afterAll(async () => {
  await removeFixtures();
  await app?.close();
  app = null;
});

describe('an RFQ INHERITS its line identity from the programme line', () => {
  it('copies the programme line FK onto the stored RFQ row', async () => {
    const insurer = await makeInsurer(`${FIXTURE_PREFIX} RFQ Ins ${tag}`);
    const { opportunityId } = await marketReadyOpportunity(placement.userId, {
      insuranceLine: 'Property All Risks',
      insuranceLineId: propertyLineId,
    });

    const created = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(placement.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Property All Risks',
        insurerIds: [insurer.id],
      })
      .expect(201);
    const rfqId = (created.body as { id: string }).id;

    // The stored ROW, not the response: a view could resolve a line for display while the column
    // stays null, which is exactly the failure this file exists for.
    const row = await rawPrisma.rFQ.findUniqueOrThrow({ where: { id: rfqId } });
    expect(row.insuranceLineId).toBe(propertyLineId);
    expect(row.officeInsuranceLineId).toBeNull();
    // And the string is still there — it is retained until a measurement says it can go.
    expect(row.insuranceLine).toBe('Property All Risks');
  }, 300_000);

  it('inherits NULL from a programme line that has no managed line, rather than guessing', async () => {
    // The honest edge: a programme line for a coverage string the config has no mapping for
    // carries no FK, so the RFQ taken from it cannot carry one either. Resolving the string here
    // would be a SECOND resolution path — two lookups that have to agree forever, which is the
    // defect the FK removes.
    const insurer = await makeInsurer(`${FIXTURE_PREFIX} RFQ Unmapped ${tag}`);
    const { opportunityId } = await marketReadyOpportunity(placement.userId, {
      insuranceLine: 'Kidnap & Ransom',
      insuranceLineId: null,
    });

    const created = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(placement.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Kidnap & Ransom',
        insurerIds: [insurer.id],
      })
      .expect(201);
    const row = await rawPrisma.rFQ.findUniqueOrThrow({
      where: { id: (created.body as { id: string }).id },
    });
    expect(row.insuranceLineId).toBeNull();
    expect(row.officeInsuranceLineId).toBeNull();
    expect(row.insuranceLine).toBe('Kidnap & Ransom');
  }, 300_000);
});

describe('a commission agreement resolves its managed line or is REFUSED', () => {
  it('stores the resolved catalogue id for a line named exactly', async () => {
    const insurer = await makeInsurer(`${FIXTURE_PREFIX} Rate Ins ${tag}`);
    const created = await request(app!.getHttpServer())
      .post('/commission/agreements')
      .set(bearer(rateManager.accessToken))
      .send({
        insurerId: insurer.id,
        insuranceLine: 'Motor Comprehensive',
        ratePercent: '12.5',
        effectiveFrom: '2026-01-01',
      })
      .expect(201);

    const row = await rawPrisma.commissionAgreement.findUniqueOrThrow({
      where: { id: (created.body as { id: string }).id },
    });
    expect(row.insuranceLineId).toBe(motorLineId);
  }, 300_000);

  it('accepts a catalogue CODE', async () => {
    const insurer = await makeInsurer(`${FIXTURE_PREFIX} Rate Code ${tag}`);
    const created = await request(app!.getHttpServer())
      .post('/commission/agreements')
      .set(bearer(rateManager.accessToken))
      .send({
        insurerId: insurer.id,
        insuranceLine: 'MOTOR_COMPREHENSIVE',
        ratePercent: '11',
        effectiveFrom: '2026-01-01',
      })
      .expect(201);
    const row = await rawPrisma.commissionAgreement.findUniqueOrThrow({
      where: { id: (created.body as { id: string }).id },
    });
    expect(row.insuranceLineId).toBe(motorLineId);
  }, 300_000);

  it('REFUSES a line the catalogue does not have, so no unmapped rate can be written', async () => {
    // The difference between this model and the other three: a rate on a line nothing can match
    // is a rate that will never be applied, and this table decides what the broker is PAID. So
    // the write is refused rather than stored with a null identity — which is what makes the
    // unmapped count on this table stop growing.
    const insurer = await makeInsurer(`${FIXTURE_PREFIX} Rate Bad ${tag}`);
    const refused = await request(app!.getHttpServer())
      .post('/commission/agreements')
      .set(bearer(rateManager.accessToken))
      .send({
        insurerId: insurer.id,
        insuranceLine: 'Moter Comprehensiv',
        ratePercent: '12.5',
        effectiveFrom: '2026-01-01',
      })
      .expect(422);
    const message = (refused.body as { message: string }).message;
    expect(message).toContain('Moter Comprehensiv');
    expect(message).toContain('/insurance-lines');

    // And nothing was written — a refusal that left a row behind would be worse than no refusal.
    const count = await rawPrisma.commissionAgreement.count({
      where: { insurerId: insurer.id },
    });
    expect(count).toBe(0);
  }, 300_000);
});

describe('the mapping table cannot name a line the catalogue does not have', () => {
  it('every COVERAGE_LINE_MAPPINGS code exists in the seeded catalogue', async () => {
    // The programme-line writer resolves a code to an id. A code that resolves to nothing writes a
    // NULL FK and only logs — so the guard against a typo, a rename or a retired line belongs
    // HERE, against the real catalogue, rather than in a unit test with a mocked one.
    const catalogue = await rawPrisma.insuranceLine.findMany({
      select: { code: true },
    });
    const codes = new Set(catalogue.map((l) => l.code));
    const missing = COVERAGE_LINE_CODES.filter((code) => !codes.has(code));
    expect(
      missing,
      'a coverage mapping names a catalogue code that is not seeded — every programme line using it would be written with no managed-line reference',
    ).toEqual([]);
    // And the table is not empty, so the assertion above cannot pass by having nothing to check.
    expect(COVERAGE_LINE_CODES.length).toBeGreaterThan(10);
  }, 300_000);
});

describe('the rate table and the policy chain agree about what a line can BE', () => {
  it('no Policy carries an office-added line, because no commission rate could govern it', async () => {
    // ## The invariant, and why it is asserted rather than assumed
    //
    // `POST /commission/agreements` resolves its line against the PLATFORM catalogue and refuses
    // anything else, so `CommissionAgreement.officeInsuranceLineId` can never be populated through
    // the API. A Policy on an office-added line would therefore have no rate that could govern it
    // and no way to create one — `resolveGovernedRate` would find nothing and the calculation
    // would 422 permanently.
    //
    // Today that is unreachable, measured four ways: `InsuranceProgramLineInput` has no
    // `officeInsuranceLineId` field at all, so no API path can put one on a programme line; RFQ and
    // Policy only COPY their parent's reference, so with nothing upstream there is nothing to
    // inherit; the needs assessment derives its coverage list from answers, so it is always a
    // subset of the fixed `COVERAGE_LINES`; and the row counts are zero on every model.
    //
    // **So this test is not guarding a bug — it is guarding the ASSUMPTION that makes § 1.40's
    // remaining step a convenience rather than a hole.** The day something writes an office line
    // onto a programme line, that step becomes urgent, and without this nothing would say so: the
    // symptom would be a commission calculation refusing a policy for no visible reason.
    const offenders = await rawPrisma.policy.findMany({
      where: { officeInsuranceLineId: { not: null } },
      select: { id: true, insuranceLine: true, officeInsuranceLineId: true },
      take: 10,
    });
    expect(
      offenders,
      'A Policy carries an office-added insurance line, and the commission rate table cannot express an agreement for one — so this policy can never have a governing rate and the calculation will 422 with nothing to fix it. Close the remaining step in IMPROVEMENTS.md § 1.40 (the agreement DTO taking a lineId) before allowing an office line onto the policy chain.',
    ).toEqual([]);

    // And the same for the two models upstream, so the guard names the step where it entered
    // rather than only the end of the chain.
    const upstream = await Promise.all([
      rawPrisma.insuranceProgramLine.count({
        where: { officeInsuranceLineId: { not: null } },
      }),
      rawPrisma.rFQ.count({ where: { officeInsuranceLineId: { not: null } } }),
    ]);
    expect(
      { programmeLines: upstream[0], rfqs: upstream[1] },
      'an office-added line has entered the programme -> RFQ -> Policy chain; see the message above',
    ).toEqual({ programmeLines: 0, rfqs: 0 });
  }, 300_000);

  it('would FAIL if such a policy existed — proven by planting one', async () => {
    // The plant, because a set-is-empty assertion passes trivially and tells you nothing on its
    // own. Rolled back, so the invariant is never actually violated on the database.
    const insurer = await makeInsurer(`${FIXTURE_PREFIX} Plant Ins ${tag}`);
    const officeLine = await prisma.officeInsuranceLine.create({
      data: {
        nameEn: `${FIXTURE_PREFIX} Plant Line ${tag}`,
        nameAr: `${FIXTURE_PREFIX} خط الزرع ${tag}`,
        canonicalEn: `line writers plant line ${tag}`,
        canonicalAr: `line writers plant ar ${tag}`,
        category: 'GENERAL',
        createdByUserId: placement.userId,
      },
    });
    const { opportunityId } = await marketReadyOpportunity(placement.userId, {
      insuranceLine: 'Property All Risks',
      insuranceLineId: propertyLineId,
    });

    let seen = -1;
    await expect(
      rawPrisma.$transaction(async (tx) => {
        const opp = await tx.opportunity.findUniqueOrThrow({
          where: { id: opportunityId },
          select: { customerId: true, organizationId: true },
        });
        await tx.policy.create({
          data: {
            opportunityId,
            customerId: opp.customerId,
            // Named explicitly: `rawPrisma` is the OWNER client and does not stamp the tenant
            // column — only the scoped client does. Taken from the opportunity so the plant
            // cannot accidentally sit in a different office than its own parent.
            organizationId: opp.organizationId,
            insurerId: insurer.id,
            insuranceLine: `${FIXTURE_PREFIX} Plant Line ${tag}`,
            officeInsuranceLineId: officeLine.id,
            inceptionDate: new Date('2026-10-01'),
            requestedPremium: '1000.000',
            currency: 'JOD',
          },
        });
        seen = await tx.policy.count({
          where: { officeInsuranceLineId: { not: null } },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    // The query the guard above runs DOES see such a policy when one exists, so its `toEqual([])`
    // is a real measurement rather than a query that can never match.
    expect(seen).toBeGreaterThan(0);
  }, 300_000);
});

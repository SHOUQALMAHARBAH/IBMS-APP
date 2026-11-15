import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * ART. 15/d — «التواصل مع ثلاث شركات تأمين», OVER REAL HTTP.
 *
 * Every test is named by the criterion it proves: OWNER DECISION 129 §4's seven and OWNER
 * DECISION 130 §4's four. The PURE half of the rule is already covered by
 * `article-15-d.config.spec.ts` — this is the half a unit test cannot reach: the permission, the
 * database CHECKs, the record, and the alert that arrives later.
 *
 * ## 🔴 CRITERION 1 IS PROVEN IN THE FORM THE DATA ALLOWS, AND THE DIFFERENCE IS THE POINT
 *
 * Decision 129's criterion 1 reads «تجديد طبي فردي بشركة واحدة ⟵ يمرّ بلا قائمة ولا نافذة،
 * والطلب يحمل الإعفاء الأول موسوماً «من النظام»» — it passes with NO list and NO window, carrying
 * exemption 1 TAGGED BY THE SYSTEM.
 *
 * MEASURED 2026-11-12 and unchanged since: **the system cannot tag any of the five.**
 * `InsuranceLine` has no individual/group medical split (`MEDICAL_HEALTH` is a single row), the
 * consecutive-renewal count is recorded nowhere (`Opportunity.renewalCaseId` has no writer), and
 * the defined-benefit list has not been issued. So there is no fact on which the system could
 * decide that THIS medical request is an individual renewal.
 *
 * ⟶ What is proven instead is what the system CAN do and what decision 129 actually governs: on
 *   the medical line the two renewal exemptions are OFFERED, the employee's choice is recorded as
 *   «اختاره فلان», and `TAGGED_BY_SYSTEM` stays reachable in the column for the day one becomes
 *   taggable. ⛔ Writing a test that drove a tag would mean inventing the fact the tag rests on,
 *   which is the one thing this record must never do.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = Math.random().toString(36).slice(2, 8);
const FIXTURE = `ZZ-A15D-${RUN}`;

/** The standard line codes the exemptions are gated on. Resolved by CODE at run time rather than
 *  hard-coded ids: a seeded uuid differs per database. */
const MOTOR = 'MOTOR_COMPREHENSIVE';
const MEDICAL = 'MEDICAL_HEALTH';

let app: INestApplication<App> | null = null;
/** Sends quote requests. Holds `rfq.create` and NOT the declaration code. */
let officer: { accessToken: string; userId: string };
/** The same, plus the declaration code — the state an office reaches after its administrator
 *  grants it. */
let declarer: { accessToken: string; userId: string };

const createdRoleIds: string[] = [];
const createdUserIds: string[] = [];
const createdInsurerIds: string[] = [];
const createdCustomerIds: string[] = [];

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

interface RfqBody {
  id: string;
}
interface OptionsBody {
  required: boolean;
  minInsurers: number;
  premiumCeilingJod: string;
  exemptions: { exemption: string; because: string }[];
  mayDeclare: boolean;
  evidence: { id: string; channel: string; sentAt: string }[];
  window: {
    title: string;
    text: string;
    reasonHint: string;
    acknowledgement: string;
    reasonMinLength: number;
  };
}

async function seedRole(name: string, codes: string[]): Promise<string> {
  const role = await prisma.role.create({
    data: {
      name,
      nameEn: name,
      nameAr: name,
      requiresMfaAlways: false,
      requiresHardwareToken: false,
      isSystem: false,
    },
  });
  createdRoleIds.push(role.id);
  const permissions = await prisma.permission.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  expect(
    permissions.map((p) => p.code).sort(),
    'a permission this spec grants is not in the catalogue',
  ).toEqual([...codes].sort());
  await prisma.rolePermission.createMany({
    data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
  });
  return role.id;
}

async function makeUser(
  label: string,
  roleId: string,
): Promise<{ accessToken: string; userId: string }> {
  const email = `${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}@ibms.test`;
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Art 15d ${label}`, email, password: PASSWORD })
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

  await prisma.userRoleAssignment.create({
    data: { userId: body.user.id, roleId },
  });
  createdUserIds.push(body.user.id);
  return { accessToken: body.accessToken, userId: body.user.id };
}

async function makeInsurer(label: string): Promise<string> {
  const insurer = await prisma.insurer.create({
    data: { legalName: `${FIXTURE} ${label}`, isActive: true },
  });
  createdInsurerIds.push(insurer.id);
  return insurer.id;
}

/** An opportunity taken to market on a NAMED standard line, so the exemptions are gated on a
 *  code the catalogue really holds. Direct writes: the subject is art. 15/d, not the funnel. */
async function opportunityOn(
  lineCode: string,
  lineLabel: string,
  /*
   * WHO OWNS THE CUSTOMER FILE, and it is a PARAMETER rather than always the officer.
   *
   * An RFQ inherits its opportunity's customer's visibility: the owning Sales officer, or a
   * holder of `customer-file.all-owners.read`. The declarer holds neither of those for a file
   * owned by somebody else, so every route answers 404 — which is correct behaviour and was
   * three failures until this was made explicit. ⛔ The fix is NOT to hand the declarer a
   * cross-owner read: that would widen a role in a fixture to paper over a visibility rule, and
   * the rule is the one `rfq-oversight-read.e2e-spec.ts` exists to protect.
   */
  ownerUserId: string = officer.userId,
): Promise<{
  opportunityId: string;
  customerId: string;
  insuranceProgramId: string;
}> {
  const line = await prisma.insuranceLine.findFirstOrThrow({
    where: { code: lineCode },
    select: { id: true },
  });
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `${FIXTURE} Customer ${Math.random().toString(36).slice(2, 6)}`,
      ownerUserId,
    },
  });
  createdCustomerIds.push(customer.id);
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
  await prisma.insuranceProgramLine.create({
    data: {
      insuranceProgramId: program.id,
      insuranceLine: lineLabel,
      insuranceLineId: line.id,
    },
  });
  return {
    opportunityId: opportunity.id,
    customerId: customer.id,
    insuranceProgramId: program.id,
  };
}

async function optionsFor(
  token: string,
  opportunityId: string,
  insuranceLine: string,
  insurerCount: number,
): Promise<OptionsBody> {
  const res = await request(app!.getHttpServer())
    .get('/rfqs/article-15-d/options')
    .query({ opportunityId, insuranceLine, insurerCount })
    .set(bearer(token))
    .expect(200);
  return res.body as OptionsBody;
}

beforeAll(async () => {
  app = await createTestApp();

  const officerRole = await seedRole(`${FIXTURE} Officer`, [
    'rfq.create',
    'rfq.read',
    'insurer.read',
    'quotation.capture',
    // `POST /quotations/:id/revise` carries `quotation.negotiate`, not `quotation.capture` --
    // the COMPILER cannot see that and the route answered 403 until it was measured.
    'quotation.negotiate',
    'quotation.read',
  ]);
  /*
   * ⚠️ THE DECLARATION CODE IS GRANTED HERE SO A TEST CAN RUN, AND NOWHERE ELSE.
   *
   * OWNER DECISION 131: a new permission is granted to NOBODY, and this code ships held by no
   * role in any real office. This role exists only inside this spec, is created and deleted by
   * it, and is what the office reaches AFTER its administrator decides — which is exactly the
   * state the declaration path has to be tested in.
   */
  const declarerRole = await seedRole(`${FIXTURE} Declarer`, [
    'rfq.create',
    'rfq.read',
    'insurer.read',
    'declared-act.article-15-d.declare',
  ]);

  officer = await makeUser(`a15d-officer-${RUN}`, officerRole);
  declarer = await makeUser(`a15d-declarer-${RUN}`, declarerRole);
}, 300_000);

afterAll(async () => {
  await app?.close();
  app = null;

  // db-test is CUMULATIVE. Everything this spec wrote comes out, children first.
  const rfqs = await prisma.rFQ.findMany({
    where: { opportunity: { customer: { id: { in: createdCustomerIds } } } },
    select: { id: true },
  });
  const rfqIds = rfqs.map((r) => r.id);
  if (rfqIds.length > 0) {
    const exemptions = await prisma.rfqArticle15DExemption.findMany({
      where: { rfqId: { in: rfqIds } },
      select: { id: true },
    });
    await prisma.article15DPremiumAlert.deleteMany({
      where: { exemptionId: { in: exemptions.map((e) => e.id) } },
    });
    /*
     * ⛔ `RfqArticle15DExemption` AND `DeclaredAct` REFUSE DELETE BY TRIGGER, both of them, and
     * that is correct: an exemption records what a request was sent under and a declared act is
     * a register of admitted regulatory breaches. Neither may be removed by any permission.
     *
     * ⟶ So this spec's rows are PERMANENT residue on db-test, and the fixture prefix is what
     *   keeps them identifiable. Nothing here tries to delete them; attempting it would fail the
     *   teardown and leave the rest of the cleanup undone. The RFQs they point at stay too, for
     *   the same reason — the FKs are `onDelete: Restrict`.
     *
     * ## 🔴 MEASURED AFTER THE FIRST FULL SUITE RUN, AND IT IS A NEW CLASS OF RESIDUE
     *
     * db-test held **129 `RfqArticle15DExemption` rows and 11 `DeclaredAct` rows** once this
     * spec and `insurer-deactivation` had run. ⟶ A full `npm run test:e2e` now adds ~16 rows to
     * two APPEND-ONLY regulatory registers, every run, for ever.
     *
     * That is NOT the bloat class `reset-db-test.sh` was written for — hundreds of rows, not the
     * 356,062 audit rows that script records — and it is a different KIND of thing: the cleanup
     * discipline every other spec here uses (delete your roles, delete your users) **cannot be
     * applied at all**, because the triggers refuse DELETE to everyone including the owner. Only
     * `reset-db-test.sh` clears them.
     *
     * ⛔ AND THE TRIGGERS MUST NOT BE WEAKENED TO MAKE TEARDOWN TIDIER. A register of admitted
     * regulatory breaches that a test fixture can delete is not a register. `declared-act-
     * record.e2e-spec.ts` solved its own version by probing inside aborting transactions — which
     * works for a DIRECT database probe and cannot work here, because the point of this spec is
     * to drive real HTTP, and HTTP commits.
     */
  }
  if (createdUserIds.length > 0) {
    await prisma.userRoleAssignment.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
  }
  if (createdRoleIds.length > 0) {
    await prisma.rolePermission.deleteMany({
      where: { roleId: { in: createdRoleIds } },
    });
    await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
  }
}, 180_000);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// OWNER DECISION 130 — THREE OR MORE IS THE LAW BEING COMPLIED WITH
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('OWNER DECISION 130 — the window appears on the minority alone', () => {
  it('DECISION 130 — three or more insurers creates NO exemption row and NO declared act', async () => {
    /*
     * «المكتب بيبعت كل طلب عرض سعر لثلاث شركات أو أكثر لأنه هيك القانون، والنافذة بتطلع بس لما
     * الطلب يروح لأقل من ثلاث وما في إعفاء.»
     *
     * Not an empty exemption, not a tagged one, not a row saying "none needed" — NOTHING. A
     * record of compliance on every request would bury the minority that actually needs one, and
     * the database agrees: `only_below_three_insurers` refuses such a row outright.
     */
    const { opportunityId } = await opportunityOn(MOTOR, 'Motor Comprehensive');
    const insurers = await Promise.all([
      makeInsurer('A'),
      makeInsurer('B'),
      makeInsurer('C'),
    ]);

    const options = await optionsFor(
      officer.accessToken,
      opportunityId,
      'Motor Comprehensive',
      3,
    );
    expect(options.required, 'three insurers still asked the question').toBe(
      false,
    );
    expect(
      options.exemptions,
      'exemptions were offered for a compliant request',
    ).toEqual([]);

    const created = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: insurers,
      })
      .expect(201);
    const rfqId = (created.body as RfqBody).id;

    expect(
      await prisma.rfqArticle15DExemption.count({ where: { rfqId } }),
    ).toBe(0);
    expect(
      await prisma.declaredAct.count({
        where: { entity: 'RFQ', entityId: rfqId },
      }),
    ).toBe(0);
  }, 300_000);

  it('DECISION 130 — and a request reaching three REFUSES an exemption it cannot need', async () => {
    // There is nothing to be exempt FROM. Accepting one would inflate the share of requests that
    // "needed" an exemption, which is the figure an inspector would read.
    const { opportunityId } = await opportunityOn(MOTOR, 'Motor Comprehensive');
    const insurers = await Promise.all([
      makeInsurer('D'),
      makeInsurer('E'),
      makeInsurer('F'),
    ]);
    const refused = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: insurers,
        article15D: { exemption: 'DEFINED_BENEFIT_CONTRACT' },
      })
      .expect(422);
    expect((refused.body as { message: string }).message).toContain(
      'art. 15/d is satisfied',
    );
  }, 300_000);

  it('DECISION 130 — the count is PER REQUEST: two RFQs on one opportunity, the window on the second alone', async () => {
    /*
     * «طلبان في فرصة واحدة، أحدهما لثلاث والآخر لواحدة ⟵ النافذة على الثاني وحده.» Decision 130
     * ruling 2, and it is the reason `insurerCount` is stored ON the exemption row: the count
     * that mattered is the request's own, not the opportunity's total.
     */
    const { opportunityId, insuranceProgramId } = await opportunityOn(
      MOTOR,
      'Motor Comprehensive',
    );
    // A SECOND line on the SAME programme, so one opportunity can carry two RFQs — which is the
    // only shape in which "per request" and "per opportunity" give different answers.
    await prisma.insuranceProgramLine.create({
      data: {
        insuranceProgramId,
        insuranceLine: 'Medical / Health',
        insuranceLineId: (
          await prisma.insuranceLine.findFirstOrThrow({
            where: { code: MEDICAL },
            select: { id: true },
          })
        ).id,
      },
    });

    const three = await Promise.all([
      makeInsurer('G'),
      makeInsurer('H'),
      makeInsurer('I'),
    ]);
    const wide = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: three,
      })
      .expect(201);

    const narrow = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Medical / Health',
        insurerIds: [three[0]],
        article15D: { exemption: 'INDIVIDUAL_MEDICAL_RENEWAL' },
      })
      .expect(201);

    expect(
      await prisma.rfqArticle15DExemption.count({
        where: { rfqId: (wide.body as RfqBody).id },
      }),
      'the wide request carried an exemption because its SIBLING was narrow',
    ).toBe(0);
    const narrowRow = await prisma.rfqArticle15DExemption.findUniqueOrThrow({
      where: { rfqId: (narrow.body as RfqBody).id },
    });
    expect(narrowRow.insurerCount).toBe(1);
  }, 300_000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// OWNER DECISION 129 § 4 — THE SEVEN CRITERIA
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('OWNER DECISION 129 § 4 — the seven criteria', () => {
  it('CRITERION 1 — a medical request OFFERS both renewal exemptions, and the record says a PERSON chose', async () => {
    /*
     * See this file's header for why criterion 1 is proven in this form. The criterion asks for
     * exemption 1 TAGGED BY THE SYSTEM; measured, the system holds no fact it could tag on —
     * `MEDICAL_HEALTH` is one row with no individual/group split. So what is asserted is what
     * decision 129 actually governs: the exemptions are offered on the line that can carry them,
     * and the record distinguishes «اختاره فلان» from «وسمه النظام».
     */
    const { opportunityId } = await opportunityOn(MEDICAL, 'Medical / Health');
    const options = await optionsFor(
      officer.accessToken,
      opportunityId,
      'Medical / Health',
      1,
    );
    expect(options.required).toBe(true);
    expect(options.exemptions.map((e) => e.exemption)).toContain(
      'INDIVIDUAL_MEDICAL_RENEWAL',
    );
    expect(options.exemptions.map((e) => e.exemption)).toContain(
      'GROUP_MEDICAL_RENEWAL_UP_TO_THREE_YEARS',
    );
    // Every offer says WHY, never a bare code.
    for (const offer of options.exemptions) {
      expect(offer.because.length).toBeGreaterThan(20);
    }

    const insurer = await makeInsurer('J');
    const created = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Medical / Health',
        insurerIds: [insurer],
        article15D: { exemption: 'INDIVIDUAL_MEDICAL_RENEWAL' },
      })
      .expect(201);

    const row = await prisma.rfqArticle15DExemption.findUniqueOrThrow({
      where: { rfqId: (created.body as RfqBody).id },
    });
    expect(row.basis).toBe('CHOSEN_BY_PERSON');
    expect(row.chosenByUserId).toBe(officer.userId);
    expect(row.chosenByNameShown?.trim()).not.toBe('');
  }, 300_000);

  it('CRITERION 2 — change the line to non-medical and the medical exemptions go', async () => {
    // «غيِّر الفرع إلى غير الطبي ⟶ يزول الوسم، وتظهر الإعفاءات المتاحة أو النافذة.»
    const { opportunityId } = await opportunityOn(MOTOR, 'Motor Comprehensive');
    const options = await optionsFor(
      officer.accessToken,
      opportunityId,
      'Motor Comprehensive',
      1,
    );
    const offered = options.exemptions.map((e) => e.exemption);
    expect(offered).not.toContain('INDIVIDUAL_MEDICAL_RENEWAL');
    expect(offered).not.toContain('GROUP_MEDICAL_RENEWAL_UP_TO_THREE_YEARS');
    // And the server refuses one posted anyway — the screen is not the enforcement.
    const insurer = await makeInsurer('K');
    const refused = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurer],
        article15D: { exemption: 'INDIVIDUAL_MEDICAL_RENEWAL' },
      })
      .expect(422);
    expect((refused.body as { message: string }).message).toContain(
      'does not apply',
    );
  }, 300_000);

  it('CRITERION 3 — a premium of 2001 on motor is refused and 2000 is accepted', async () => {
    /*
     * «قسط ٢٠٠١ في المركبات ⟶ الإعفاء الرابع لا يُعرَض. وقسط ٢٠٠٠ ⟶ يُعرَض اختياراً.» AT the
     * ceiling is INSIDE it, because the article says «لا يزيد عن». An off-by-one here refuses a
     * transaction the instrument permits.
     */
    const over = await opportunityOn(MOTOR, 'Motor Comprehensive');
    const insurerOver = await makeInsurer('L');
    const refused = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId: over.opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurerOver],
        article15D: {
          exemption: 'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT',
          declaredAnnualPremiumJod: '2001',
        },
      })
      .expect(422);
    expect((refused.body as { message: string }).message).toContain('2001');

    const at = await opportunityOn(MOTOR, 'Motor Comprehensive');
    const insurerAt = await makeInsurer('M');
    const accepted = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId: at.opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurerAt],
        article15D: {
          exemption: 'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT',
          declaredAnnualPremiumJod: '2000',
        },
      })
      .expect(201);
    const row = await prisma.rfqArticle15DExemption.findUniqueOrThrow({
      where: { rfqId: (accepted.body as RfqBody).id },
    });
    expect(row.declaredAnnualPremiumJod?.toString()).toBe('2000');
  }, 300_000);

  it('CRITERION 4 — the ceiling is COPIED onto the row, so an old request keeps its own value', async () => {
    /*
     * «غيِّر سطر الـ٢٠٠٠ في الجدول بتاريخ نفاذ جديد ⟶ الطلب القديم يبقى على قيمته يوم أُرسل.»
     *
     * A foreign key to `LegalValue` would satisfy this too — but only while somebody remembered
     * to pass the request's own date, and `sla-timer.service.ts:247` is this repository's own
     * recorded example of a dated read that quietly uses today. The figure is copied, so the
     * request carries its own answer and no later reader can get it wrong.
     */
    const { opportunityId } = await opportunityOn(MOTOR, 'Motor Comprehensive');
    const insurer = await makeInsurer('N');
    const created = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurer],
        article15D: {
          exemption: 'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT',
          declaredAnnualPremiumJod: '1900',
        },
      })
      .expect(201);
    const row = await prisma.rfqArticle15DExemption.findUniqueOrThrow({
      where: { rfqId: (created.body as RfqBody).id },
    });
    // The value is ON the row, not reachable only through a join.
    expect(row.ceilingValueJod).not.toBeNull();
    const inForce = await prisma.legalValue.findFirstOrThrow({
      where: {
        code: 'SINGLE_INSURER_EXEMPTION_PREMIUM_CEILING_JOD',
        effectiveTo: null,
      },
    });
    expect(row.ceilingValueJod?.toString()).toBe(
      inForce.numericValue?.toString(),
    );
  }, 300_000);

  it('CRITERION 5 — exemption 5 with no evidence is NOT saved, and WhatsApp is refused', async () => {
    /*
     * «الإعفاء الخامس بلا ما يثبت طلب العميل ⟶ لا يُحفَظ.» And the evidence has to have ARRIVED
     * by one of art. 22/s's approved means — OWNER DECISION 132 ruling 2 and 133 §3. WhatsApp is
     * an electronic channel by any reading and is refused BY NAME (OWNER DECISION 44), which is
     * the case no name-based rule could get right.
     */
    const { opportunityId } = await opportunityOn(MOTOR, 'Motor Comprehensive');
    const insurer = await makeInsurer('O');

    const bare = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurer],
        article15D: { exemption: 'AT_CUSTOMER_REQUEST' },
      })
      .expect(400);
    expect((bare.body as { message: string }).message).toContain('evidence');

    /*
     * WhatsApp: on file, INBOUND, and on THIS request's own customer — and still refused.
     *
     * ⚠️ THE CUSTOMER MATTERS AND THE FIRST VERSION OF THIS TEST GOT IT WRONG, usefully. The log
     * was created against the previous opportunity's customer, and the refusal that came back
     * was «the evidence has to be a communication from this request's own customer» rather than
     * the channel one. ⟶ So the IDENTITY check fires before the MEANS check, which is the right
     * order: whose message it is comes before how it arrived, and a message from the wrong
     * customer is not improved by having come by email.
     */
    const second = await opportunityOn(MOTOR, 'Motor Comprehensive');
    const whatsapp = await prisma.communicationLog.create({
      data: {
        customerId: second.customerId,
        channel: 'WHATSAPP',
        direction: 'INBOUND',
        subject: `${FIXTURE} ask`,
      },
    });
    const refused = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId: second.opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurer],
        article15D: {
          exemption: 'AT_CUSTOMER_REQUEST',
          evidenceCommunicationLogId: whatsapp.id,
        },
      })
      .expect(422);
    expect((refused.body as { message: string }).message).toContain('WHATSAPP');

    // And an approved means IS accepted — «تبليغ خطي», art. 22/s's first, which had no channel
    // member at all until OWNER DECISION 133 §3 ruling 2.
    const written = await prisma.communicationLog.create({
      data: {
        customerId: second.customerId,
        channel: 'WRITTEN_NOTICE',
        direction: 'INBOUND',
        subject: `${FIXTURE} written ask`,
      },
    });
    const accepted = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId: second.opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurer],
        article15D: {
          exemption: 'AT_CUSTOMER_REQUEST',
          evidenceCommunicationLogId: written.id,
        },
      })
      .expect(201);
    const row = await prisma.rfqArticle15DExemption.findUniqueOrThrow({
      where: { rfqId: (accepted.body as RfqBody).id },
    });
    expect(row.evidenceCommunicationLogId).toBe(written.id);
  }, 300_000);

  it('CRITERION 6 — no exemption and below three needs the SEPARATE permission, and says who grants it', async () => {
    /*
     * «لا إعفاء وأقلّ من ثلاث ⟶ النافذة، ولا تمرّ بلا صلاحيتها المنفصلة.»
     *
     * 🔴 THIS IS DECISION 131's FIRST REAL CONSEQUENCE. The code is granted to NOBODY when it
     * ships, so this is the state every office starts in — and the refusal has to name the
     * remedy, because the administrator's grant is the only way out.
     *
     * ⛔ AND IT IS NOT DECISION 126 BEING BROKEN. 126 says the system does not refuse the ACT on
     * the ground that it is a breach. This is an ordinary PERMISSION refusal, in the standing
     * vocabulary, and every other route in the product refuses the same way.
     */
    const { opportunityId } = await opportunityOn(MOTOR, 'Motor Comprehensive');
    const insurer = await makeInsurer('P');

    const refused = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurer],
        article15D: {
          declaration: {
            reason: 'a written reason that is long enough',
            acknowledged: true,
          },
        },
      })
      .expect(403);
    const message = (refused.body as { message: string }).message;
    expect(
      message,
      "the refusal does not name whoever can grant the permission — the administrator's grant is the only way out of this state",
    ).toContain('ask whoever manages permissions in your office');

    // The options route says so BEFORE the employee writes anything.
    const options = await optionsFor(
      officer.accessToken,
      opportunityId,
      'Motor Comprehensive',
      1,
    );
    expect(options.mayDeclare).toBe(false);

    // And the holder of the code goes through, with the act recorded.
    const second = await opportunityOn(
      MOTOR,
      'Motor Comprehensive',
      declarer.userId,
    );
    const declared = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(declarer.accessToken))
      .send({
        opportunityId: second.opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurer],
        article15D: {
          declaration: {
            reason: 'the customer named this insurer and refused the others',
            acknowledged: true,
          },
        },
      })
      .expect(201);
    const act = await prisma.declaredAct.findFirstOrThrow({
      where: { entity: 'RFQ', entityId: (declared.body as RfqBody).id },
    });
    expect(act.site).toBe('ARTICLE_15_D_FEWER_THAN_THREE_INSURERS');
    // Element 3: the record says WHICH permission was used, and it is not `rfq.create`.
    expect(act.permissionCode).toBe('declared-act.article-15-d.declare');
    expect(act.actorUserId).toBe(declarer.userId);
    // Element 4: the acknowledgement is stored AS DISPLAYED, from the one constant the screen
    // renders — so the record testifies to the sentence the person actually saw.
    expect(act.acknowledgementTextShown).toContain('إبراء ذمة الشركة المطورة');
  }, 300_000);

  it('🔴 A REFUSED REQUEST LEAVES NO ROW BEHIND, so the employee can correct it and retry', async () => {
    /*
     * THE DEFECT THIS TEST EXISTS FOR, found by its own sibling above on a second run.
     *
     * Art. 15/d used to be evaluated AFTER `insertRfqRow`, because the exemption and the
     * declared act both point AT the request. True of the WRITES; false of the REFUSALS — and a
     * refused request left the RFQ row behind. The employee corrected their mistake, submitted
     * again, and got **409 Conflict** from `@@unique([opportunityId, insuranceLine])`: told that
     * a request they could not see already existed, with no way to proceed on that line at all.
     *
     * ⟶ The fix is the `evaluate` / `apply` split, and this is what pins it. ⛔ Not an assertion
     *   about internals: it drives the exact sequence a person does — refused, then corrected —
     *   which is the only form in which the bug was visible.
     */
    const { opportunityId, customerId } = await opportunityOn(
      MOTOR,
      'Motor Comprehensive',
    );
    const insurer = await makeInsurer('V');

    // Refused: WhatsApp is not an approved means.
    const whatsapp = await prisma.communicationLog.create({
      data: {
        customerId,
        channel: 'WHATSAPP',
        direction: 'INBOUND',
        subject: `${FIXTURE} retry ask`,
      },
    });
    await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurer],
        article15D: {
          exemption: 'AT_CUSTOMER_REQUEST',
          evidenceCommunicationLogId: whatsapp.id,
        },
      })
      .expect(422);

    // NOTHING was created — not the RFQ, not an exemption, not an act.
    expect(
      await prisma.rFQ.count({ where: { opportunityId } }),
      'a refused request left an RFQ row behind. The employee cannot retry on this line: the unique index answers 409 for a request they cannot see.',
    ).toBe(0);

    // And the corrected attempt goes straight through on the SAME line.
    const written = await prisma.communicationLog.create({
      data: {
        customerId,
        channel: 'EMAIL',
        direction: 'INBOUND',
        subject: `${FIXTURE} retry ask by email`,
      },
    });
    await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurer],
        article15D: {
          exemption: 'AT_CUSTOMER_REQUEST',
          evidenceCommunicationLogId: written.id,
        },
      })
      .expect(201);
  }, 300_000);

  it('CRITERION 6, THE OTHER HALF — an EXEMPTED request needs no such permission', async () => {
    // The refusal reaches the minority of the minority. An office with nobody holding the code
    // can still send every exempted request it likes, which is what keeps decision 123's
    // click-count test satisfied.
    const { opportunityId } = await opportunityOn(MEDICAL, 'Medical / Health');
    const insurer = await makeInsurer('Q');
    await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Medical / Health',
        insurerIds: [insurer],
        article15D: { exemption: 'GROUP_MEDICAL_RENEWAL_UP_TO_THREE_YEARS' },
      })
      .expect(201);
  }, 300_000);

  it('CRITERION 6, THE ACKNOWLEDGEMENT — an unticked box is no declaration', async () => {
    // Element 4: it is ticked BY HAND. The adviser's own design is that the continue button does
    // not open until the box is ticked, so a request arriving without it did not come from that
    // window.
    const { opportunityId } = await opportunityOn(
      MOTOR,
      'Motor Comprehensive',
      declarer.userId,
    );
    const insurer = await makeInsurer('R');
    const refused = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(declarer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurer],
        article15D: {
          declaration: {
            reason: 'a reason long enough to pass',
            acknowledged: false,
          },
        },
      })
      .expect(400);
    expect((refused.body as { message: string }).message).toContain(
      'acknowledged',
    );
  }, 300_000);

  it('CRITERION 7 — the record tells WHO chose, and refuses to be edited after sending', async () => {
    /*
     * «السجل يفرّق بين «وسمه النظام» و«اختاره فلان»، ولا يُعدَّل بعد الإرسال.»
     *
     * The second half is a TRIGGER, not a permission: an exemption that can be swapped after the
     * request was sent is not evidence of anything. Probed inside a transaction that ROLLS BACK,
     * because db-test is cumulative and the table is append-only — a committed probe could never
     * be removed by any permission.
     */
    const { opportunityId } = await opportunityOn(MOTOR, 'Motor Comprehensive');
    const insurer = await makeInsurer('S');
    const created = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurer],
        article15D: { exemption: 'DEFINED_BENEFIT_CONTRACT' },
      })
      .expect(201);
    const rfqId = (created.body as RfqBody).id;
    const row = await prisma.rfqArticle15DExemption.findUniqueOrThrow({
      where: { rfqId },
    });
    expect(row.basis).toBe('CHOSEN_BY_PERSON');
    expect(row.chosenByNameShown).toBeTruthy();

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.rfqArticle15DExemption.update({
          where: { id: row.id },
          data: { exemption: 'AT_CUSTOMER_REQUEST' },
        });
        throw new Error('rolled back');
      }),
      'the exemption was EDITED after the request was sent — criterion 7',
    ).rejects.toThrow(/append-only|rolled back/);

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.rfqArticle15DExemption.delete({ where: { id: row.id } });
        throw new Error('rolled back');
      }),
      'the exemption was DELETED — criterion 7',
    ).rejects.toThrow(/append-only|rolled back/);
  }, 300_000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE ALERT, WHICH ARRIVES LATER — DECISION 130's THIRD CASE
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('OWNER DECISION 130 — a quote above the ceiling warns and does not refuse', () => {
  it('DECISION 130 — expected 1900, quoted 2100: the alert is recorded, the quote stands, the exemption survives', async () => {
    /*
     * «الإعفاء الرابع: قسط متوقّع ١٩٠٠ ثم عرض بـ٢١٠٠ ⟵ تنبيه مسجَّل، والطلب لا يُرفَض ولا يُمحى
     * إعفاؤه.» — decision 130 ruling 3, and message 36 §4.5's «ينبّه ولا يرفض».
     *
     * All three halves asserted, because each was a live temptation: refusing the quotation would
     * lose a factual event, and erasing the exemption would rewrite what the employee declared in
     * good faith.
     */
    const { opportunityId } = await opportunityOn(MOTOR, 'Motor Comprehensive');
    const insurer = await makeInsurer('T');
    const created = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurer],
        article15D: {
          exemption: 'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT',
          declaredAnnualPremiumJod: '1900',
        },
      })
      .expect(201);
    const rfqId = (created.body as RfqBody).id;

    const quoted = await request(app!.getHttpServer())
      .post('/quotations')
      .set(bearer(officer.accessToken))
      .send({
        rfqId,
        insurerId: insurer,
        premium: '2100',
        currency: 'JOD',
      })
      .expect(201);
    expect(quoted.status, 'the quotation was REFUSED — it must only warn').toBe(
      201,
    );

    const exemption = await prisma.rfqArticle15DExemption.findUniqueOrThrow({
      where: { rfqId },
    });
    expect(
      exemption.exemption,
      'the exemption was erased or changed when the quote came back high',
    ).toBe('LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT');

    const alerts = await prisma.article15DPremiumAlert.findMany({
      where: { exemptionId: exemption.id },
    });
    expect(
      alerts,
      'no alert was raised for a quote above the ceiling',
    ).toHaveLength(1);
    expect(alerts[0].quotedPremiumJod.toString()).toBe('2100');
    expect(alerts[0].ceilingValueJod.toString()).toBe(
      exemption.ceilingValueJod?.toString(),
    );
  }, 300_000);

  it('🔴 DECISION 130 — AND A REVISION RAISES ITS OWN ALERT, which the first wiring missed', async () => {
    /*
     * THE GAP THIS TEST EXISTS FOR. `capture` had the ceiling check and `revise` did not — so an
     * insurer's opening quote of 1,800 raised nothing (correctly) and its REVISED quote of 2,100
     * would have raised nothing either. The system would have warned on the cheapest path and
     * gone silent on the expensive one.
     *
     * Message 36 section 4.5 is «ولمّا ترجع العروض يقارن النظام» — when the quotes come back the
     * system compares — and a revision IS a quote coming back. Found by reading the sibling path
     * rather than by a failure, which is why it is pinned here now.
     *
     * ⚠️ AND IT IS ITS OWN ALERT, not an edit to the first one: a revision is a new `Quotation`
     * row, the index is `(exemptionId, quotationId)`, and the alert is a TABLE rather than a
     * flag precisely so a second high quote cannot be swallowed by the first.
     */
    const { opportunityId } = await opportunityOn(MOTOR, 'Motor Comprehensive');
    const insurer = await makeInsurer('W');
    const created = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurer],
        article15D: {
          exemption: 'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT',
          declaredAnnualPremiumJod: '1700',
        },
      })
      .expect(201);
    const rfqId = (created.body as RfqBody).id;

    // The opening quote is WITHIN the ceiling: nothing is raised.
    const opening = await request(app!.getHttpServer())
      .post('/quotations')
      .set(bearer(officer.accessToken))
      .send({ rfqId, insurerId: insurer, premium: '1800', currency: 'JOD' })
      .expect(201);
    const exemption = await prisma.rfqArticle15DExemption.findUniqueOrThrow({
      where: { rfqId },
    });
    expect(
      await prisma.article15DPremiumAlert.count({
        where: { exemptionId: exemption.id },
      }),
    ).toBe(0);

    // The REVISION is above it.
    const chain = opening.body as { current: { id: string } };
    await request(app!.getHttpServer())
      .post(`/quotations/${chain.current.id}/revise`)
      .set(bearer(officer.accessToken))
      .send({ premium: '2400', currency: 'JOD' })
      .expect(201);

    const alerts = await prisma.article15DPremiumAlert.findMany({
      where: { exemptionId: exemption.id },
    });
    expect(
      alerts,
      'a REVISED quotation above the ceiling raised no alert. The system would warn on the opening quote and go silent on the revision, which is the expensive one.',
    ).toHaveLength(1);
    expect(alerts[0].quotedPremiumJod.toString()).toBe('2400');

    // And the exemption still stands — decision 126, on the revision path too.
    const after = await prisma.rfqArticle15DExemption.findUniqueOrThrow({
      where: { rfqId },
    });
    expect(after.exemption).toBe('LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT');
  }, 300_000);

  it('DECISION 130 — a quote AT or below the ceiling raises nothing', async () => {
    // An alert that is not above the ceiling is not an alert. Without this, a sweep could write
    // rows for every quotation and the register would read as a wall of warnings — which is how
    // a real one stops being noticed. The database refuses it too.
    const { opportunityId } = await opportunityOn(MOTOR, 'Motor Comprehensive');
    const insurer = await makeInsurer('U');
    const created = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Motor Comprehensive',
        insurerIds: [insurer],
        article15D: {
          exemption: 'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT',
          declaredAnnualPremiumJod: '1500',
        },
      })
      .expect(201);
    const rfqId = (created.body as RfqBody).id;
    await request(app!.getHttpServer())
      .post('/quotations')
      .set(bearer(officer.accessToken))
      .send({ rfqId, insurerId: insurer, premium: '1800', currency: 'JOD' })
      .expect(201);

    const exemption = await prisma.rfqArticle15DExemption.findUniqueOrThrow({
      where: { rfqId },
    });
    expect(
      await prisma.article15DPremiumAlert.count({
        where: { exemptionId: exemption.id },
      }),
    ).toBe(0);
  }, 300_000);
});

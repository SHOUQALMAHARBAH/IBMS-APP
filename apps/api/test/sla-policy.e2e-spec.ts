import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

function uniqueEmail(label: string): string {
  return `${label}-${RUN}@ibms.test`;
}
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return match[1];
}

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface PolicyBody {
  id: string;
  policyCode: string;
  processType: string;
  durationValue: number;
  durationUnit: string;
  sourceType: string;
  sourceReference: string | null;
  sourceDocument: string | null;
  isRegulatory: boolean;
  sourceLabel: string;
  status: string;
}

let app: INestApplication<App>;

async function makeUser(
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'SLA E2E User', email, password: PASSWORD })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const { accessToken, user } = login.body as IssuedSessionBody;

  const enroll = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(enrollBody.otpAuthUri)),
    })
    .expect(200);

  for (const roleName of roles) {
    const role = await ensureRole(roleName);
    const activeGrant = await prisma.userRoleAssignment.findFirst({
      where: { userId: user.id, roleId: role.id, revokedAt: null },
    });
    if (!activeGrant) {
      await prisma.userRoleAssignment.create({
        data: { userId: user.id, roleId: role.id },
      });
    }
  }
  return { accessToken, userId: user.id };
}

describe('Configurable SLA policies (e2e) — task Part A', () => {
  let compliance: { accessToken: string; userId: string };
  let sales: { accessToken: string; userId: string };
  const created: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    // COMPLIANCE_OFFICER holds read + manage + regulatory.
    compliance = await makeUser('sla-compliance', 'COMPLIANCE_OFFICER');
    sales = await makeUser('sla-sales', 'SALES_RELATIONSHIP_OFFICER');
  }, 120_000);

  afterAll(async () => {
    if (created.length > 0) {
      // db-test is cumulative across specs — clean up only this run's rows.
      await prisma.slaPolicyEscalation.deleteMany({
        where: { slaPolicyId: { in: created } },
      });
      await prisma.slaPolicy.deleteMany({ where: { id: { in: created } } });
    }
    await app?.close();
  });

  it('refuses a REGULATORY policy that names no instrument, and accepts an INTERNAL_POLICY with none', async () => {
    // The core of the feature: the system must not be able to claim an SLA is
    // legally required without saying what requires it.
    await request(app.getHttpServer())
      .post('/sla/policies')
      .set(bearer(compliance.accessToken))
      .send({
        policyCode: `SLA-E2E-BOGUS-${RUN}`.toUpperCase().slice(0, 60),
        policyName: 'Bogus regulatory claim',
        processType: `e2e_process_${RUN}`,
        durationValue: 3,
        durationUnit: 'BUSINESS_DAYS',
        sourceType: 'REGULATORY',
      })
      .expect(422);

    const ok = await request(app.getHttpServer())
      .post('/sla/policies')
      .set(bearer(compliance.accessToken))
      .send({
        policyCode: `SLA-E2E-INTERNAL-${RUN}`.toUpperCase().slice(0, 60),
        policyName: 'Drafted internal target',
        processType: `e2e_process_${RUN}`,
        durationValue: 3,
        durationUnit: 'BUSINESS_DAYS',
        sourceType: 'INTERNAL_POLICY',
      })
      .expect(201);
    const body = ok.body as PolicyBody;
    created.push(body.id);

    expect(body.sourceType).toBe('INTERNAL_POLICY');
    expect(body.isRegulatory).toBe(false);
    expect(body.sourceLabel).toBe('Internal policy');
    // Never born ACTIVE — activation is its own audited decision.
    expect(body.status).toBe('DRAFT');
  });

  /*
   * THE REGULATORY STAMP IS GATED IN BOTH DIRECTIONS, OVER HTTP.
   *
   * Changing a policy to REGULATORY has always needed `sla.policy.regulatory`. CREATING one that
   * way needed only `sla.policy.create` — and BRANCH_DEPARTMENT_MANAGER holds the create code
   * WITHOUT the regulatory one, so it could assert legal force on a new policy and not on an
   * existing one.
   *
   * Proven at HTTP level and not only in the unit spec, because the whole reason the check moved
   * into the server is that a screen-only guard reopens the moment anything else calls the route.
   * A request built by hand IS that anything else.
   */
  it('refuses a REGULATORY policy created by a holder of sla.policy.create who lacks sla.policy.regulatory', async () => {
    // A DISTINCT label. `uniqueEmail` here is `${label}-${RUN}`, unique per run and DETERMINISTIC
    // per label, and a test further down this file already makes a `sla-manager` — so sharing the
    // label meant whichever ran second got a 409 from signup. CI caught it; my own local run could
    // not, because `-t` filtered the other test out, and a filtered run cannot see a fixture
    // collision with the tests it excluded.
    const manager = await makeUser(
      'sla-regulatory-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );

    // Its OWN processType, not the shared `e2e_process_${RUN}`. A sibling test lists policies by
    // that filter and asserts on what it finds, so adding REGULATORY rows to it made that test's
    // `sourceType` PATCH a no-op change and turned its expected 422 into a 200. A new fixture must
    // not perturb a neighbouring assertion.
    //
    // FULLY CITED, so the only thing left to refuse is the authority to make the claim. Omitting
    // the citations would produce the same 422 for a different reason and prove nothing.
    const refused = await request(app.getHttpServer())
      .post('/sla/policies')
      .set(bearer(manager.accessToken))
      .send({
        policyCode: `SLA-E2E-MGR-REG-${RUN}`.toUpperCase().slice(0, 60),
        policyName: 'Manager asserting legal force',
        processType: `e2e_regstamp_${RUN}`,
        durationValue: 3,
        durationUnit: 'BUSINESS_DAYS',
        sourceType: 'REGULATORY',
        sourceReference: 'PDPL Art. 23(b)',
        sourceDocument: 'PRIV-SOP-05',
      })
      .expect(422);
    // The message must name the code and the honest alternative, or the reader asks for the wrong
    // grant and has no way forward.
    expect(JSON.stringify(refused.body)).toContain('sla.policy.regulatory');
    expect(JSON.stringify(refused.body)).toContain('INTERNAL_POLICY');

    // THE COMPLEMENT, on the same token: the identical caller succeeds the moment the stamp is not
    // REGULATORY. Without this the test above would pass equally on a build where that role simply
    // cannot create policies at all.
    const allowed = await request(app.getHttpServer())
      .post('/sla/policies')
      .set(bearer(manager.accessToken))
      .send({
        policyCode: `SLA-E2E-MGR-INT-${RUN}`.toUpperCase().slice(0, 60),
        policyName: 'Manager stating an internal target',
        processType: `e2e_regstamp_${RUN}`,
        durationValue: 3,
        durationUnit: 'BUSINESS_DAYS',
        sourceType: 'INTERNAL_POLICY',
      })
      .expect(201);
    created.push((allowed.body as PolicyBody).id);

    // And a holder of BOTH codes may still do it — so the gate is the permission and not the route.
    const byCompliance = await request(app.getHttpServer())
      .post('/sla/policies')
      .set(bearer(compliance.accessToken))
      .send({
        policyCode: `SLA-E2E-CO-REG-${RUN}`.toUpperCase().slice(0, 60),
        policyName: 'Compliance asserting legal force',
        processType: `e2e_regstamp_${RUN}`,
        durationValue: 3,
        durationUnit: 'BUSINESS_DAYS',
        sourceType: 'REGULATORY',
        sourceReference: 'PDPL Art. 23(b)',
        sourceDocument: 'PRIV-SOP-05',
      })
      .expect(201);
    created.push((byCompliance.body as PolicyBody).id);
    expect((byCompliance.body as PolicyBody).isRegulatory).toBe(true);
  }, 120_000);

  it('gates every route on RBAC', async () => {
    await request(app.getHttpServer())
      .get('/sla/policies')
      .set(bearer(sales.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .post('/sla/policies')
      .set(bearer(sales.accessToken))
      .send({
        policyCode: `SLA-E2E-DENIED-${RUN}`.toUpperCase().slice(0, 60),
        policyName: 'Denied',
        processType: `e2e_denied_${RUN}`,
        durationValue: 1,
        durationUnit: 'HOURS',
        sourceType: 'OPERATIONAL',
      })
      .expect(403);
  });

  it('serves the SEEDED policies with their real provenance', async () => {
    const res = await request(app.getHttpServer())
      .get('/sla/policies?status=ACTIVE')
      .set(bearer(compliance.accessToken))
      .expect(200);
    const policies = res.body as PolicyBody[];

    const sanctions = policies.find(
      (p) => p.processType === 'sanctions_match_review',
    );
    expect(
      sanctions,
      'sanctions_match_review policy should be seeded',
    ).toBeDefined();
    // THE point of this whole feature: the 3-business-day figure was drafted
    // in this repo, and must not be presented as a legal requirement.
    expect(sanctions!.sourceType).toBe('INTERNAL_POLICY');
    expect(sanctions!.isRegulatory).toBe(false);
    expect(sanctions!.sourceDocument).toBeNull();

    const dsr = policies.find((p) => p.processType === 'dsr_access_deletion');
    expect(dsr).toBeDefined();
    expect(dsr!.isRegulatory).toBe(true);
    expect(dsr!.sourceDocument).toBeTruthy();
    expect(dsr!.sourceLabel).toMatch(/^Regulatory —/);
  });

  it('changes a deadline through the API — no code change, no deploy', async () => {
    const listed = await request(app.getHttpServer())
      .get(`/sla/policies?processType=e2e_process_${RUN}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const policy = (listed.body as PolicyBody[])[0];

    const updated = await request(app.getHttpServer())
      .patch(`/sla/policies/${policy.id}`)
      .set(bearer(compliance.accessToken))
      .send({ durationValue: 9 })
      .expect(200);
    expect((updated.body as PolicyBody).durationValue).toBe(9);

    // And it is audited, before AND after.
    const audits = await prisma.auditLogEntry.findMany({
      where: { entityType: 'SlaPolicy', entityId: policy.id, action: 'UPDATE' },
      // Unordered `findMany` + `[0]` imposes an ordering requirement nothing typechecks, and the answer
      // then comes from the query PLAN — the same defect that once decided which reviewer an
      // access-recertification subject got. A total order, so `[0]` means something.
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    // Was `toBeGreaterThan(0)` followed by assertions on `audits[0]`: it tolerated any number of rows
    // and then generalised from an arbitrary one. This test causes exactly ONE update of this policy, so
    // one row is the honest expectation — and a second UPDATE appearing here becomes a visible failure
    // rather than a coin flip about which row gets read.
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0].beforeValue)).toContain(
      '"durationValue":3',
    );
    expect(JSON.stringify(audits[0].afterValue)).toContain('"durationValue":9');
  });

  it('activates a policy, retiring whatever it replaces, and refuses a rival ACTIVE row', async () => {
    const listed = await request(app.getHttpServer())
      .get(`/sla/policies?processType=e2e_process_${RUN}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const first = (listed.body as PolicyBody[])[0];

    const activated = await request(app.getHttpServer())
      .post(`/sla/policies/${first.id}/activate`)
      .set(bearer(compliance.accessToken))
      .expect(201);
    expect((activated.body as PolicyBody).status).toBe('ACTIVE');

    // A second policy for the same process, activated, must retire the first —
    // "which SLA applies right now" has exactly one answer.
    const second = await request(app.getHttpServer())
      .post('/sla/policies')
      .set(bearer(compliance.accessToken))
      .send({
        policyCode: `SLA-E2E-SECOND-${RUN}`.toUpperCase().slice(0, 60),
        policyName: 'Replacement target',
        processType: `e2e_process_${RUN}`,
        durationValue: 5,
        durationUnit: 'BUSINESS_DAYS',
        sourceType: 'INTERNAL_POLICY',
      })
      .expect(201);
    const secondBody = second.body as PolicyBody;
    created.push(secondBody.id);

    await request(app.getHttpServer())
      .post(`/sla/policies/${secondBody.id}/activate`)
      .set(bearer(compliance.accessToken))
      .expect(201);

    const after = await prisma.slaPolicy.findMany({
      where: { processType: `e2e_process_${RUN}` },
      select: { id: true, status: true },
    });
    expect(after.filter((p) => p.status === 'ACTIVE')).toHaveLength(1);
    expect(after.find((p) => p.status === 'ACTIVE')!.id).toBe(secondBody.id);
  });

  it('records and reads back a holiday, which the business-day math then honours', async () => {
    const observedOn = `2031-03-1${Math.floor(Math.random() * 9)}`;
    await request(app.getHttpServer())
      .post('/sla/holidays')
      .set(bearer(compliance.accessToken))
      .send({ observedOn, name: `E2E holiday ${RUN}` })
      .expect(201);

    const listed = await request(app.getHttpServer())
      .get('/sla/holidays')
      .set(bearer(compliance.accessToken))
      .expect(200);
    const found = (listed.body as { observedOn: string; name: string }[]).find(
      (h) => h.name === `E2E holiday ${RUN}`,
    );
    expect(found).toBeDefined();
    // Stored as a whole UTC day, not shifted by a local-time parse.
    expect(found!.observedOn.slice(0, 10)).toBe(observedOn);

    await prisma.slaHoliday.deleteMany({
      where: { name: `E2E holiday ${RUN}` },
    });
  });

  it('refuses the same non-working day twice with a 409, and audits the act', async () => {
    // BOTH HALVES EXISTED IN NEITHER FORM BEFORE THE ROUTE HAD A CALLER.
    //
    // The controller called the repository directly, there is no global Prisma
    // exception filter, and the table carries two partial UNIQUE indexes on the
    // date — so a second entry for the same day was an unhandled P2002 and a
    // 500. Two people working from the same published holiday list is not an
    // edge case, and "the system is broken" is the wrong thing to tell the
    // second one.
    //
    // And nothing audited a holiday, while editing one policy's duration was
    // audited — even though a single holiday row moves EVERY business-day
    // deadline in the office at once.
    // 1 + 0..8, never day 00. THE ORIGINAL WAS `Math.floor(Math.random() * 9)`,
    // which produces `2032-04-00` one run in nine — a shape-valid date that is
    // not a day. It passed locally and made CI red, and chasing it found the real
    // defect underneath: nothing validated that a date EXISTS (see the test
    // below, and `is-calendar-date.validator.ts`).
    const observedOn = `2032-04-0${1 + Math.floor(Math.random() * 8)}`;
    const name = `E2E duplicate holiday ${RUN}`;

    const created = await request(app.getHttpServer())
      .post('/sla/holidays')
      .set(bearer(compliance.accessToken))
      .send({ observedOn, name })
      .expect(201);
    const holidayId = (created.body as { id: string }).id;

    // The SAME day again — a 409, and the message names the day rather than
    // leaving the reader to guess which entry collided.
    const conflict = await request(app.getHttpServer())
      .post('/sla/holidays')
      .set(bearer(compliance.accessToken))
      .send({ observedOn, name: `${name} (again)` })
      .expect(409);
    expect((conflict.body as { message: string }).message).toContain(
      observedOn,
    );

    // A NAMED CALENDAR on the same day is a DIFFERENT row and must still be
    // accepted: the two partial uniques are "one all-calendars entry per date"
    // and "one entry per date per calendar", not "one row per date".
    await request(app.getHttpServer())
      .post('/sla/holidays')
      .set(bearer(compliance.accessToken))
      .send({ observedOn, name: `${name} (custom)`, calendarType: 'CUSTOM' })
      .expect(201);

    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: 'SlaHoliday', entityId: holidayId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('CREATE');
    expect(JSON.stringify(audit[0].afterValue)).toContain(observedOn);

    await prisma.slaHoliday.deleteMany({
      where: { name: { startsWith: name } },
    });
  });

  it('refuses a date that is shaped like a day but is not one', async () => {
    // FOUND BY CI, from a bad date in the test above rather than from reading.
    //
    // `@Matches(/^\d{4}-\d{2}-\d{2}$/)` is the established spelling for a
    // whole-day field across this api, and it admits three non-dates. The 400s
    // below are the point; the SILENT one is why this test exists at all:
    // `2026-02-30` parses to 2 March, so without the guard an administrator
    // typing 30 February would have a non-working day recorded on a day she never
    // entered, and every business-day deadline in the office would count against
    // it.
    for (const bad of [
      '2032-04-00',
      '2026-13-01',
      '2026-02-30',
      '2026-04-31',
    ]) {
      await request(app.getHttpServer())
        .post('/sla/holidays')
        .set(bearer(compliance.accessToken))
        .send({ observedOn: bad, name: `E2E bad date ${RUN}` })
        .expect(400);
    }

    // POSITIVE ANCHOR: a real day in the same shape is still accepted, so the
    // four refusals above are about the dates and not about the route.
    await request(app.getHttpServer())
      .post('/sla/holidays')
      .set(bearer(compliance.accessToken))
      .send({ observedOn: '2032-02-29', name: `E2E leap day ${RUN}` })
      .expect(201);

    await prisma.slaHoliday.deleteMany({
      where: { name: { contains: `day ${RUN}` } },
    });
  });

  it('reports what a year still owes, fills the fixed four, and expands an Eid', async () => {
    // Jordan's public holidays, per the Ministry of Foreign Affairs
    // (https://www.mfa.gov.jo/content/public-holidays): four fixed dates that may be
    // generated, and four Islamic occasions that may NOT — in Jordan the date is set by
    // official announcement and can differ by a day from any calendar conversion, so
    // they are entered from the announcement.
    //
    // A distant year, cleaned at both ends: db-test is cumulative, and the fixed four
    // are fixed DATES, so two runs against the same year would collide on the
    // duplicate-date constraint rather than on anything this test is about.
    const YEAR = 2091;
    const clearYear = () =>
      prisma.slaHoliday.deleteMany({
        where: {
          observedOn: {
            gte: new Date(`${YEAR}-01-01T00:00:00.000Z`),
            lt: new Date(`${YEAR + 1}-01-01T00:00:00.000Z`),
          },
        },
      });
    await clearYear();

    interface YearView {
      year: number;
      holidays: { name: string; observedOn: string }[];
      missingFixed: { nameEn: string; observedOn: string }[];
      missingOccasions: { key: string; days: number }[];
    }

    // EMPTY YEAR: it owes all four fixed dates and all four occasions. The missing list
    // is the point of this read — a calendar that only lists what is present cannot tell
    // an office what it has not entered.
    const before = await request(app.getHttpServer())
      .get(`/sla/holidays/year/${YEAR}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const b = before.body as YearView;
    expect(b.holidays).toHaveLength(0);
    expect(b.missingFixed.map((f) => f.observedOn)).toEqual([
      `${YEAR}-01-01`,
      `${YEAR}-05-01`,
      `${YEAR}-05-25`,
      `${YEAR}-12-25`,
    ]);
    expect(b.missingOccasions.map((o) => `${o.key}:${o.days}`)).toEqual([
      'islamic_new_year:1',
      'prophets_birthday:1',
      'eid_al_fitr:4',
      'eid_al_adha:5',
    ]);

    // FILL THE FIXED FOUR, then again — the second call must create nothing rather than
    // conflict, because two people opening the same year is ordinary.
    const first = await request(app.getHttpServer())
      .post(`/sla/holidays/year/${YEAR}/fixed`)
      .set(bearer(compliance.accessToken))
      .expect(201);
    expect(
      (first.body as { created: unknown[]; skipped: number }).created,
    ).toHaveLength(4);
    const second = await request(app.getHttpServer())
      .post(`/sla/holidays/year/${YEAR}/fixed`)
      .set(bearer(compliance.accessToken))
      .expect(201);
    expect(
      (second.body as { created: unknown[]; skipped: number }).created,
    ).toHaveLength(0);
    expect((second.body as { skipped: number }).skipped).toBe(4);

    // AN EID IS FIVE DAYS, and the server supplies the length so an officer does not
    // have to remember it. Started on a Thursday so the run crosses Friday+Saturday —
    // a public holiday falls on the day it falls on.
    const adha = await request(app.getHttpServer())
      .post('/sla/holidays/occasion')
      .set(bearer(compliance.accessToken))
      .send({ occasionKey: 'eid_al_adha', startDate: `${YEAR}-06-04` })
      .expect(201);
    const rows = adha.body as { observedOn: string; name: string }[];
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.observedOn.slice(0, 10))).toEqual([
      `${YEAR}-06-04`,
      `${YEAR}-06-05`,
      `${YEAR}-06-06`,
      `${YEAR}-06-07`,
      `${YEAR}-06-08`,
    ]);
    // The day number is in the name, so a reader can see a five-day Eid is complete.
    expect(rows[4].name).toContain('day 5 of 5');

    // The year now owes only the three occasions it has not been told about.
    const after = await request(app.getHttpServer())
      .get(`/sla/holidays/year/${YEAR}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const a = after.body as YearView;
    expect(a.holidays).toHaveLength(9); // 4 fixed + 5 Eid days
    expect(a.missingFixed).toHaveLength(0);
    expect(a.missingOccasions.map((o) => o.key)).toEqual([
      'islamic_new_year',
      'prophets_birthday',
      'eid_al_fitr',
    ]);

    // An unknown occasion is a 422 that NAMES the four, rather than a silent no-op.
    const bad = await request(app.getHttpServer())
      .post('/sla/holidays/occasion')
      .set(bearer(compliance.accessToken))
      .send({ occasionKey: 'ramadan', startDate: `${YEAR}-03-01` })
      .expect(422);
    expect((bad.body as { message: string }).message).toContain('eid_al_adha');

    // And a start date that is not a day is refused before anything is created.
    await request(app.getHttpServer())
      .post('/sla/holidays/occasion')
      .set(bearer(compliance.accessToken))
      .send({ occasionKey: 'eid_al_fitr', startDate: `${YEAR}-02-30` })
      .expect(400);

    await clearYear();
  });

  it('separates "change the duration" from "declare it legally required"', async () => {
    // BRANCH_DEPARTMENT_MANAGER holds sla.policy.update but NOT
    // sla.policy.regulatory. Shortening a deadline is a normal governance
    // edit; asserting the deadline is the law is not, and the split is a ROUTE
    // boundary rather than a branch inside one handler.
    //
    // This distinction is WHY the owner ruled that splitting `sla.policy.manage` was routine: the
    // decision that carries the regulatory weight on this surface already stood apart, so splitting
    // the CRUD verbs around it takes nothing away from it (IMPROVEMENTS § 3.15).
    const manager = await makeUser('sla-manager', 'BRANCH_DEPARTMENT_MANAGER');

    const listed = await request(app.getHttpServer())
      .get(`/sla/policies?processType=e2e_process_${RUN}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const policy = (listed.body as PolicyBody[])[0];

    // Allowed: an ordinary duration edit.
    await request(app.getHttpServer())
      .patch(`/sla/policies/${policy.id}`)
      .set(bearer(manager.accessToken))
      .send({ durationValue: 4 })
      .expect(200);

    // Refused: changing what the system claims about its legal force.
    await request(app.getHttpServer())
      .patch(`/sla/policies/${policy.id}/source`)
      .set(bearer(manager.accessToken))
      .send({
        sourceType: 'REGULATORY',
        sourceReference: 'Invented',
        sourceDocument: 'Nowhere',
      })
      .expect(403);

    // And even WITH the permission, a regulatory claim still needs an
    // instrument — the citation requirement is not a permission check.
    await request(app.getHttpServer())
      .patch(`/sla/policies/${policy.id}/source`)
      .set(bearer(compliance.accessToken))
      .send({ sourceType: 'REGULATORY' })
      .expect(422);

    const stillInternal = await request(app.getHttpServer())
      .get(`/sla/policies/${policy.id}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((stillInternal.body as PolicyBody).isRegulatory).toBe(false);
  });

  it('validates input rather than storing nonsense', async () => {
    for (const body of [
      { durationValue: -1 },
      { durationUnit: 'FORTNIGHTS' },
      { sourceType: 'MADE_UP' },
      { warningThreshold: 5 },
    ]) {
      await request(app.getHttpServer())
        .post('/sla/policies')
        .set(bearer(compliance.accessToken))
        .send({
          policyCode: `SLA-E2E-BAD-${RUN}`.toUpperCase().slice(0, 60),
          policyName: 'Invalid',
          processType: `e2e_bad_${RUN}`,
          durationValue: 3,
          durationUnit: 'BUSINESS_DAYS',
          sourceType: 'INTERNAL_POLICY',
          ...body,
        })
        .expect(400);
    }
  });
});

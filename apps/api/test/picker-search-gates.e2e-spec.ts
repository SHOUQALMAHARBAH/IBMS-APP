import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/**
 * A PICKER'S SEARCH ROUTE IS REACHABLE BY EVERY ROLE THAT NEEDS IT — asserted through real HTTP.
 *
 * The owner's rule, and the two cases below are the ones that were SHIPPED WRONG and are what the rule
 * was written from. They are tested by ROLE and not by permission code, because the defect was never
 * visible in a decorator: the code was right for the flow the route was built for and wrong for the
 * screens that came to need it, and only the seeded grid can say which.
 *
 *   1. AN EXECUTIVE COULD NOT FIND AN EMPLOYEE. `GET /employees/search` was gated on
 *      `employee.national-id.reveal`, held by COMPLIANCE_OFFICER alone, while `/employee-performance`
 *      and `/dashboards/insurer-employee-performance` — the two screens that type an `employeeId` —
 *      are gated on codes held by BRANCH_DEPARTMENT_MANAGER and EXECUTIVE_MANAGEMENT.
 *   2. THE DPO COULD NOT FIND A CUSTOMER. `GET /customers/search` was gated on `customer.read`, which
 *      the DATA_PROTECTION_OFFICER does not hold — and `/dsr` is their screen.
 *
 * ## Why a 200 is not enough on its own, and what else each case asserts
 *
 * A route that admits everybody would satisfy every positive assertion here. So each picker also
 * asserts a role that must STILL be refused, and the refusals are chosen to be meaningful rather than
 * convenient: `EXTERNAL_AUDITOR` is read-only by construction and holds none of the codes any of these
 * routes accept, so a 403 for them is the evidence that the widening is a widening and not a hole.
 *
 * And the FLOOR is asserted per route, because the floor is the condition that stops a search field
 * being a directory listing — a route admitting an empty term returns a page of the register to
 * everybody the widened gate just let in.
 */
const PASSWORD = 'Correct-Horse-Battery-Staple-9';

let sharedApp: INestApplication<App> | undefined;
async function boot(): Promise<INestApplication<App>> {
  if (!sharedApp) sharedApp = await createTestApp();
  return sharedApp;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function runId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return match[1];
}

async function makeUser(
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const app = await boot();
  const email = `${label}-${runId()}@ibms.test`;
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Picker gate e2e', email, password: PASSWORD })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const { accessToken, user } = login.body as {
    accessToken: string;
    user: { id: string };
  };

  const enroll = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const enrollBody = enroll.body as {
    credentialId: string;
    otpAuthUri: string;
  };
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
    const active = await prisma.userRoleAssignment.findFirst({
      where: { userId: user.id, roleId: role.id, revokedAt: null },
    });
    if (!active) {
      await prisma.userRoleAssignment.create({
        data: { userId: user.id, roleId: role.id },
      });
    }
  }
  return { accessToken, userId: user.id };
}

describe('Picker search gates (e2e) — any of the using screens permissions', () => {
  afterAll(async () => {
    await sharedApp?.close();
    sharedApp = undefined;
  });

  it('AN EXECUTIVE CAN NOW FIND AN EMPLOYEE — the defect the rule came from', async () => {
    const app = await boot();
    // EXECUTIVE_MANAGEMENT holds `employee-performance.view` and NOT `employee.national-id.reveal`.
    // Before 2026-10-02 this request was a 403 on the screen built for this role.
    const exec = await makeUser('picker-exec', 'EXECUTIVE_MANAGEMENT');
    await request(app.getHttpServer())
      .get('/employees/search')
      .query({ q: 'ah' })
      .set(bearer(exec.accessToken))
      .expect(200);

    // The other screen's role, separately — one 200 does not establish both, and the two screens are
    // gated on different codes.
    const manager = await makeUser('picker-mgr', 'BRANCH_DEPARTMENT_MANAGER');
    await request(app.getHttpServer())
      .get('/employees/search')
      .query({ q: 'ah' })
      .set(bearer(manager.accessToken))
      .expect(200);

    // STILL REFUSED. Without this the test would pass on a route with no gate at all.
    const auditor = await makeUser('picker-auditor-emp', 'EXTERNAL_AUDITOR');
    await request(app.getHttpServer())
      .get('/employees/search')
      .query({ q: 'ah' })
      .set(bearer(auditor.accessToken))
      .expect(403);

    // THE FLOOR SURVIVED THE WIDENING. Two characters for an employee; one is refused.
    await request(app.getHttpServer())
      .get('/employees/search')
      .query({ q: 'a' })
      .set(bearer(exec.accessToken))
      .expect(400);
  });

  it('THE DPO CAN NOW FIND A CUSTOMER — their own screen', async () => {
    const app = await boot();
    // DATA_PROTECTION_OFFICER holds `dsr.log` and NOT `customer.read`. `/dsr` is their screen, and the
    // field built to replace a search-box-plus-select was unusable by them the day after it shipped.
    const dpo = await makeUser('picker-dpo', 'DATA_PROTECTION_OFFICER');
    await request(app.getHttpServer())
      .get('/customers/search')
      .query({ q: 'ahm' })
      .set(bearer(dpo.accessToken))
      .expect(200);

    // The three-character floor is the owner's own condition and is not relaxed by the widening.
    await request(app.getHttpServer())
      .get('/customers/search')
      .query({ q: 'ah' })
      .set(bearer(dpo.accessToken))
      .expect(400);
    // Whitespace trims to empty and fails the floor rather than matching everything.
    await request(app.getHttpServer())
      .get('/customers/search')
      .query({ q: '   ' })
      .set(bearer(dpo.accessToken))
      .expect(400);
  });

  it('the four new pickers admit a role whose screen needs them, and refuse a read-only auditor', async () => {
    const app = await boot();
    // One role per picker, each chosen because it holds a SCREEN's code and not the entity's own read:
    //
    //   insurer — EXECUTIVE_MANAGEMENT via `dashboard.financial.view`
    //   policy  — via `document.read`, which is what `/documents` is gated on
    //   user    — via `dashboard.sales.view`, which is `/sales-performance`
    //   branch  — via `dashboard.executive.view`
    //
    // EXECUTIVE_MANAGEMENT holds all four of those, so one actor exercises every picker and the
    // assertion is about the GATE rather than about one role's grid row.
    const exec = await makeUser('picker-four', 'EXECUTIVE_MANAGEMENT');

    /**
     * THE REFUSAL WITNESS IS PER ROUTE, and the first version of this test got it wrong in the
     * instructive direction: it used EXTERNAL_AUDITOR for all four and went red on the insurer picker
     * with `expected 403, got 200`.
     *
     * That 200 is CORRECT. The auditor holds `insurer.read`, which is in `INSURER_SEARCH_CODES`
     * because each list opens with the entity's own read code — a role that may read a register may
     * obviously search it, and leaving that code out would create the inverse defect. So the test was
     * asserting a refusal the design does not want.
     *
     * Each witness below holds NONE of its route's codes, measured on the seeded grid rather than
     * guessed. Recorded here because the fix was to the test and the measurement is what decided it.
     */
    const witnesses: Record<string, RoleName> = {
      '/insurers/search': 'DATA_PROTECTION_OFFICER',
      '/policies/search': 'EXTERNAL_AUDITOR',
      '/admin/users/search': 'POLICY_CHECKING_OFFICER',
      '/admin/branches/search': 'EXTERNAL_AUDITOR',
    };

    const routes: { path: string; q: string; shortQ?: string }[] = [
      { path: '/insurers/search', q: 'a' },
      { path: '/policies/search', q: 'abc', shortQ: 'ab' },
      { path: '/admin/users/search', q: 'a' },
      { path: '/admin/branches/search', q: 'a' },
    ];

    for (const route of routes) {
      await request(app.getHttpServer())
        .get(route.path)
        .query({ q: route.q })
        .set(bearer(exec.accessToken))
        .expect(200);

      // Asserted PER ROUTE rather than once: four routes with four decorator lists is four chances to
      // spread the wrong constant, and a single 403 somewhere would not catch it.
      const refused = await makeUser(
        `picker-403${route.path.replace(/\W+/g, '-')}`,
        witnesses[route.path],
      );
      await request(app.getHttpServer())
        .get(route.path)
        .query({ q: route.q })
        .set(bearer(refused.accessToken))
        .expect(403);

      // No unfiltered mode anywhere.
      await request(app.getHttpServer())
        .get(route.path)
        .set(bearer(exec.accessToken))
        .expect(400);

      if (route.shortQ) {
        await request(app.getHttpServer())
          .get(route.path)
          .query({ q: route.shortQ })
          .set(bearer(exec.accessToken))
          .expect(400);
      }
    }
  });

  it('the user picker returns a name and an id, and NEVER an email', async () => {
    const app = await boot();
    const exec = await makeUser('picker-user-shape', 'EXECUTIVE_MANAGEMENT');
    // A term that matches the actor themselves, so the result is guaranteed non-empty — an empty array
    // satisfies every `not.toHaveProperty` assertion and would prove nothing.
    const res = await request(app.getHttpServer())
      .get('/admin/users/search')
      .query({ q: 'Picker' })
      .set(bearer(exec.accessToken))
      .expect(200);

    const rows = res.body as { id: string; name: string }[];
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    if (!row)
      throw new Error('empty result — the assertions below would be vacuous');
    expect(typeof row.id).toBe('string');
    expect(typeof row.name).toBe('string');

    /**
     * AN EXACT KEY SET, not a list of fields I thought to name.
     *
     * The first version of this assertion listed four withheld fields — email, roles, lastLoginAt,
     * mfaEnabled — and a plant that spread the whole repository row into the response left it GREEN,
     * because the row carries `isActive` and `employee` and neither was on my list. A withheld-field
     * list can only refuse what its author anticipated; an exact key set refuses everything else,
     * including the field nobody thought of.
     *
     * Same form as the insurer assertion below, for the same reason and after the same plant.
     */
    expect(Object.keys(row).sort()).toEqual(['id', 'name']);
    // Kept BESIDE the key set rather than replaced by it: these four name what is actually sensitive
    // here, so a future reader widening the set has to delete an assertion that says why.
    expect(row).not.toHaveProperty('email');
    expect(row).not.toHaveProperty('roles');
    expect(row).not.toHaveProperty('lastLoginAt');
    expect(row).not.toHaveProperty('mfaEnabled');
  });

  it('the insurer picker never returns this office RELATIONSHIP contacts', async () => {
    // This is what makes the widened gate safe: ten roles can now find an insurer by name, and the
    // named people who answer THIS office stay inside the two roles that hold
    // `insurer.relationship.manage`. Asserted on the row, because the repository's select is the only
    // thing standing between the two.
    const app = await boot();
    const exec = await makeUser('picker-insurer-shape', 'EXECUTIVE_MANAGEMENT');
    const res = await request(app.getHttpServer())
      .get('/insurers/search')
      .query({ q: 'a' })
      .set(bearer(exec.accessToken))
      .expect(200);

    const rows = res.body as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    if (!row)
      throw new Error('empty result — the assertions below would be vacuous');
    expect(Object.keys(row).sort()).toEqual(['id', 'name', 'nameAr']);
    for (const withheld of [
      'rfqContactName',
      'rfqContactEmail',
      'rfqContactPhone',
      'claimsContactName',
      'claimsContactEmail',
      'claimsContactPhone',
    ]) {
      expect(row).not.toHaveProperty(withheld);
    }
  });

  /**
   * THE DOCUMENT PICKER, AND ITS ABSENCE FOR THE EXTERNAL AUDITOR IS HALF THE ASSERTION.
   *
   * Owner decision 41 gates `GET /documents/search` on `document.read` ALONE, which is a DELIBERATE
   * departure from the rule this whole file exists to enforce: the screen that types a `documentId` is
   * `/audit-trail`, whose document-history section is gated on `document-history.read`, so the rule as
   * written would add that code here.
   *
   * `picker-route-reachability.mjs` will NOT flag it, and I asserted the opposite before measuring:
   * run today that script prints SIX picker sections and no DOCUMENT one, reporting `0 stuck`,
   * because its SCREEN side (`picker-route-permissions.py`) carries no `documentId` field for
   * `/audit-trail` — so the pair that would be reported does not exist. **THIS TEST IS THEREFORE
   * WHAT DEFENDS THE NARROWNESS. There is no measurement standing behind it.**
   *
   * It is overruled because the remedy is worse than the fault. Measured on the seeded grid,
   * `document-history.read` is held by COMPLIANCE_OFFICER and EXTERNAL_AUDITOR; adding it would hand a
   * READ-ONLY AUDITOR a name search over every document in the office — every KYC pack, every incident
   * report, every disposal batch's evidence — when what that role is entitled to is the history of a
   * document it already has the id of. A chooser is a directory; an id lookup is not.
   *
   * So BOTH halves are asserted, and the second is what makes the absence a decision rather than a
   * capability regression: the auditor is refused the chooser AND still reaches document history by id.
   * Without that second half this test would be indistinguishable from having broken the auditor's own
   * screen.
   */
  it('the document picker admits COMPLIANCE_OFFICER and refuses the EXTERNAL_AUDITOR, who keeps document history by id', async () => {
    const app = await boot();

    // COMPLIANCE_OFFICER holds `document.read` AND `document-history.read`, so this is the role the
    // chooser exists for — the one reader of `/audit-trail` who can use it.
    const compliance = await makeUser('picker-doc-co', 'COMPLIANCE_OFFICER');
    await request(app.getHttpServer())
      .get('/documents/search')
      .query({ q: 'pol' })
      .set(bearer(compliance.accessToken))
      .expect(200);

    const auditor = await makeUser('picker-doc-auditor', 'EXTERNAL_AUDITOR');

    // THE ABSENCE, ASSERTED. A 403 here is the decision, not a defect to be widened away.
    await request(app.getHttpServer())
      .get('/documents/search')
      .query({ q: 'pol' })
      .set(bearer(auditor.accessToken))
      .expect(403);

    // AND THE OTHER HALF — the capability the auditor keeps. 404 rather than 403 on an id that does
    // not exist is exactly the discriminator: it proves the permission gate ADMITTED this role and the
    // route then failed to find the record, so nothing was taken away by the refusal above. A fixture
    // document is not needed for that, and would only weaken what the status code already says.
    const unknownDocumentId = '00000000-0000-4000-8000-000000000000';
    await request(app.getHttpServer())
      .get(`/audit-trail/documents/${unknownDocumentId}/history`)
      .set(bearer(auditor.accessToken))
      .expect(404);

    // THE FLOOR. Three characters for a document, the largest of the seven registers, and whitespace
    // trims to empty rather than matching everything.
    await request(app.getHttpServer())
      .get('/documents/search')
      .query({ q: 'po' })
      .set(bearer(compliance.accessToken))
      .expect(400);
    await request(app.getHttpServer())
      .get('/documents/search')
      .query({ q: '   ' })
      .set(bearer(compliance.accessToken))
      .expect(400);
  });

  it('the document picker returns a name and what tells two files apart, and nothing else', async () => {
    // `storageRef` is an internal object-storage key and the uploader is a person; neither belongs in a
    // dropdown. `fileName` DOES cross, and that is consistent with `documentAuditSnapshot` deliberately
    // withholding it: that snapshot's reason is that a filename can name an insured person or describe a
    // medical event, so it must not be copied into the append-only audit table — while this view goes
    // only to a holder of `document.read`, which is the permission that already returns every filename
    // through `GET /documents`.
    const app = await boot();
    const compliance = await makeUser('picker-doc-shape', 'COMPLIANCE_OFFICER');

    /**
     * THE FIXTURE CREATES WHAT IT NEEDS — it does not hunt for it.
     *
     * The first version searched for `'pol'` on the assumption that a cumulative db-test holds a
     * "policy.pdf", and the non-vacuity guard below caught it: nothing matched, so every shape
     * assertion would have been skipped while the test reported green. That is the recorded
     * `makeCommissionFreePolicy` lesson — a fixture that FINDS is a fixture whose result depends on
     * what earlier specs happened to leave behind, and a from-nothing database holds none of it.
     *
     * The name is run-unique, so the term cannot match anything but this row and the assertion is
     * about the SHAPE rather than about a count. `policyId` and `customerId` are both left null —
     * nullable by design, and attaching the document to either would add FK teardown for nothing.
     */
    const marker = `zzpickerdoc${runId()}`;
    const doc = await prisma.document.create({
      data: {
        category: 'OTHER',
        classification: 'INTERNAL',
        fileName: `${marker}.pdf`,
        storageRef: `s3://ibms/picker-gate-e2e/${marker}.pdf`,
        uploadedByUserId: compliance.userId,
      },
    });

    let rows: Record<string, unknown>[];
    try {
      const res = await request(app.getHttpServer())
        .get('/documents/search')
        .query({ q: marker })
        .set(bearer(compliance.accessToken))
        .expect(200);
      rows = res.body as Record<string, unknown>[];
    } finally {
      await prisma.document.delete({ where: { id: doc.id } });
    }

    const row = rows[0];
    if (!row)
      throw new Error(
        'the document this test just created was not found by its own unique name — the matcher stopped matching, and the shape assertions below would be vacuous',
      );
    // An EXACT key set, because a disclosure leak arrives as an ADDITION and every `not.toHaveProperty`
    // keeps passing while a new field appears beside it.
    expect(Object.keys(row).sort()).toEqual([
      'category',
      'fileName',
      'id',
      'versionNumber',
    ]);
    for (const withheld of [
      'storageRef',
      'uploadedByUserId',
      'classification',
      'customerId',
      'policyId',
    ]) {
      expect(row).not.toHaveProperty(withheld);
    }
  });
});

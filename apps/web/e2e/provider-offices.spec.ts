import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expectAbsentWithin } from './support/anchored';

/**
 * MODULE 0 ITEM (j) — the provider dashboard screen.
 *
 * The api e2e proves the view crosses offices, that the column list holds on the wire, and that the
 * route is gated. What only these tests can prove is what a reader SEES:
 *
 *   * that the screen says out loud it crosses office boundaries, before the first row,
 *   * that the three licence states render as three states and not two,
 *   * and that a reader without the code gets the shared refusal sentence rather than an empty page.
 */

const ME_BASE = {
  id: 'user-1',
  email: 'admin@ibms.test',
  fullName: 'Security Admin',
  languagePreference: 'EN',
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

/**
 * AUTH BY EXPLICIT CODES, not by a role name — and that changed with item (j)'s gap closure.
 *
 * This spec used to call `permissionsForRoles(['SYSTEM_SECURITY_ADMINISTRATOR'])`, which worked only
 * while a brokerage office's admin role held `provider.office-state.read`. The closure withdrew that
 * grant (migration `20261117120000`), so six tests here began rendering the refusal instead of the
 * table — the closure working, and this spec's premise being wrong.
 *
 * NO ROLE NAME CAN EXPRESS "platform operator" in this fixture: `permissionsForRoles` is built from
 * the twelve seeded OFFICE roles, and the provider's `PLATFORM_OPERATOR` lives in a different
 * organization entirely. So the codes are given directly, which is the same reason
 * `mockAuthWithCodes` exists in `roles.spec.ts`.
 */
async function mockAuth(page: Page, permissions: string[]) {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'fake-access-token' } }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles: ['PLATFORM_OPERATOR'], permissions },
    }),
  );
}

/** Shaped from `ProviderOfficeStateView`, not approximated — the web interface is hand-copied over
 *  HTTP and TypeScript cannot check it, so a mock that drifts is a screen tested against fiction. */
const OFFICES = [
  {
    organizationId: 'org-a',
    legalName: 'Amman Brokerage Office',
    legalNameAr: 'مكتب عمّان للوساطة',
    subdomain: 'amman',
    organizationType: 'BROKERAGE_OFFICE',
    brokerKind: 'CORPORATE',
    organizationStatus: 'ACTIVE',
    onboardedAt: '2024-01-01T00:00:00.000Z',
    licenseNumber: 'CBJ-100',
    licenseIssuedAt: '2024-01-01T00:00:00.000Z',
    licenseExpiresAt: '2028-12-31T00:00:00.000Z',
    licenseStatus: 'active',
    renewalRequestedAt: null,
    isCurrentlyLapsed: false,
    renewalDueBy: '2028-11-16T00:00:00.000Z',
    renewalFiledOnTime: null,
    licensedBranches: 6,
    dormantLicensedBranches: 2,
    users: 12,
    activeUsers: 9,
    lastActivityAt: '2026-10-10T00:00:00.000Z',
  },
  {
    organizationId: 'org-b',
    legalName: 'Irbid Brokerage Office',
    legalNameAr: 'مكتب إربد للوساطة',
    subdomain: 'irbid',
    organizationType: 'BROKERAGE_OFFICE',
    brokerKind: 'NATURAL_PERSON',
    organizationStatus: 'ACTIVE',
    onboardedAt: '2025-03-01T00:00:00.000Z',
    licenseNumber: 'CBJ-200',
    licenseIssuedAt: '2025-03-01T00:00:00.000Z',
    licenseExpiresAt: '2025-12-31T00:00:00.000Z',
    licenseStatus: 'active',
    renewalRequestedAt: null,
    isCurrentlyLapsed: true,
    renewalDueBy: '2025-11-16T00:00:00.000Z',
    renewalFiledOnTime: null,
    licensedBranches: 2,
    dormantLicensedBranches: 0,
    users: 3,
    activeUsers: 3,
    lastActivityAt: null,
  },
  {
    // The THIRD state: no licence term on record at all.
    organizationId: 'org-c',
    legalName: 'Zarqa Brokerage Office',
    legalNameAr: 'مكتب الزرقاء للوساطة',
    subdomain: 'zarqa',
    organizationType: 'BROKERAGE_OFFICE',
    brokerKind: 'CORPORATE',
    organizationStatus: 'ACTIVE',
    onboardedAt: '2026-09-01T00:00:00.000Z',
    licenseNumber: null,
    licenseIssuedAt: null,
    licenseExpiresAt: null,
    licenseStatus: null,
    renewalRequestedAt: null,
    isCurrentlyLapsed: null,
    renewalDueBy: null,
    renewalFiledOnTime: null,
    licensedBranches: 0,
    dormantLicensedBranches: 0,
    users: 1,
    activeUsers: 1,
    lastActivityAt: null,
  },
  {
    /*
     * ITEM (و)'s CASE: a registered office with NOBODY IN IT. This is the state the owner's own
     * registration produced on dev — `goglobal`, zero users, zero accounts — and the state that was
     * previously answerable only by querying the database.
     */
    organizationId: 'org-d',
    legalName: 'Aqaba Brokerage Office',
    legalNameAr: 'مكتب العقبة للوساطة',
    subdomain: 'aqaba',
    organizationType: 'BROKERAGE_OFFICE',
    brokerKind: 'NATURAL_PERSON',
    organizationStatus: 'ACTIVE',
    onboardedAt: '2026-10-19T00:00:00.000Z',
    licenseNumber: 'CBJ-400',
    licenseIssuedAt: '2026-10-19T00:00:00.000Z',
    licenseExpiresAt: '2027-10-19T00:00:00.000Z',
    licenseStatus: 'active',
    renewalRequestedAt: null,
    isCurrentlyLapsed: false,
    renewalDueBy: '2027-09-04T00:00:00.000Z',
    renewalFiledOnTime: null,
    licensedBranches: 4,
    dormantLicensedBranches: 4,
    users: 0,
    activeUsers: 0,
    lastActivityAt: null,
  },
  {
    /*
     * A REGISTERED INSURANCE COMPANY, which this view carries since batch 5 widened its filter so
     * that one invite control could serve both types.
     *
     * Every licence field is null BY NATURE — a company holds no broker licence — and that is the
     * same raw shape as `zarqa`'s "no term on record". The screen must tell them apart or it
     * reports a registered company as being in regulatory default under art. 21/a/9.
     */
    organizationId: 'org-e',
    legalName: 'Manarah Insurance Company',
    legalNameAr: 'شركة المنارة للتأمين',
    subdomain: 'manarah',
    organizationType: 'INSURANCE_COMPANY',
    brokerKind: null,
    organizationStatus: 'ACTIVE',
    onboardedAt: '2026-10-19T00:00:00.000Z',
    licenseNumber: null,
    licenseIssuedAt: null,
    licenseExpiresAt: null,
    licenseStatus: null,
    renewalRequestedAt: null,
    isCurrentlyLapsed: null,
    renewalDueBy: null,
    renewalFiledOnTime: null,
    licensedBranches: 0,
    dormantLicensedBranches: 0,
    users: 0,
    activeUsers: 0,
    lastActivityAt: null,
  },
];

async function mockOffices(page: Page, offices: unknown = OFFICES) {
  // Named with the API ORIGIN: a bare `**/provider/offices` could also match a page path that
  // shares the noun, and Playwright would then serve the mocked JSON as the document — item (e)
  // was bitten by exactly that and the page rendered raw JSON with no error.
  await page.route('http://localhost:4000/provider/offices', (route) =>
    route.fulfill({ status: 200, json: offices }),
  );
}

test('says it crosses office boundaries BEFORE the first row', async ({
  page,
}) => {
  /*
   * Every other screen in this product shows the reader's own office. A cross-office table that
   * looks like the others is the kind of thing somebody shares without thinking about whose data it
   * is, so the screen states what it is first — and states what it does NOT contain, because
   * "office state" is not obvious from a table of offices.
   */
  await mockAuth(page, ['provider.office-state.read']);
  await mockOffices(page);
  await page.goto('/provider-offices');

  const banner = page.locator('[data-provider-cross-office]');
  await expect(banner).toContainText('crosses office boundaries');
  await expect(banner).toContainText('no customer, policy, premium');
  await expect(banner).toContainText('nothing about any individual person');
});

test('renders the THREE licence states as three states', async ({ page }) => {
  /*
   * `isCurrentlyLapsed === null` means no term on record, which item (c) made BLOCK new business
   * under art. 21/a/9 — a different and worse fact than a lapsed licence. A screen that collapsed
   * the two would tell a provider a licence expired when none was ever recorded, and would hide the
   * worse state behind the milder one.
   */
  await mockAuth(page, ['provider.office-state.read']);
  await mockOffices(page);
  await page.goto('/provider-offices');

  await expect(page.locator('[data-standing="amman"]')).toContainText(
    'in force',
  );
  await expect(page.locator('[data-standing="irbid"]')).toContainText(
    'lapsed — new business blocked',
  );
  const noTerm = page.locator('[data-standing="zarqa"]');
  await expect(noTerm).toContainText('no licence term on record');
  // It names the article, not merely the fact — a provider chasing an office needs to know which
  // rule they are chasing under.
  await expect(noTerm).toContainText('21/a/9');
});

test('shows the dormant count BESIDE the total, never instead of it', async ({
  page,
}) => {
  // "2 dormant" means nothing without knowing of how many. Asserted on both numbers.
  await mockAuth(page, ['provider.office-state.read']);
  await mockOffices(page);
  await page.goto('/provider-offices');

  await expect(page.locator('[data-branches="amman"]')).toContainText('6');
  await expect(page.locator('[data-branches="amman"]')).toContainText(
    '2 with no business',
  );
});

test('an office never used says so rather than showing a dash', async ({
  page,
}) => {
  // "never used" and "no date" are different facts, and on a provider dashboard the first is the
  // actionable one.
  await mockAuth(page, ['provider.office-state.read']);
  await mockOffices(page);
  await page.goto('/provider-offices');

  const row = page.locator('[data-office="irbid"]');
  await expect(row).toContainText('never used');
});

test('a reader without the code gets the shared refusal, not an empty page', async ({
  page,
}) => {
  // A reader holding NO codes — which is now every brokerage user, since the closure withdrew
  // the grant from every office role.
  await mockAuth(page, []);
  await mockOffices(page);
  await page.goto('/provider-offices');

  const refusal = page.locator('[data-provider-refusal]');
  // The shared sentence: the act, the code in a parenthetical, and the grantor BY FUNCTION.
  await expect(refusal).toContainText('provider.office-state.read');
  await expect(refusal).toContainText('manages permissions');
  await expect(page.locator('[data-provider-offices]')).toHaveCount(0);
});

test('an empty platform is a stated state, not an empty table', async ({
  page,
}) => {
  // "No offices" on a platform dashboard is a wrong-answer state rather than a quiet nothing — an
  // empty table would read as "nothing to see" for a condition that means something is broken.
  await mockAuth(page, ['provider.office-state.read']);
  await mockOffices(page, []);
  await page.goto('/provider-offices');

  await expect(page.locator('[data-provider-empty]')).toContainText(
    'not a normal result',
  );
  await expect(page.locator('[data-provider-offices]')).toHaveCount(0);
});

test('@a11y the provider dashboard has no violations', async ({ page }) => {
  await mockAuth(page, ['provider.office-state.read']);
  await mockOffices(page);
  await page.goto('/provider-offices');
  await expect(page.locator('[data-provider-offices]')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

/* ===========================================================================================
 * ITEM (و) — THE WAY IN.
 *
 * The two invite routes were correct, gated and proven over real HTTP for two batches, and NOTHING
 * IN THE WEB APP CALLED EITHER ONE. By the owner's rule — a surface is not delivered until a human
 * can reach it by clicking — item (و) was not done.
 *
 * These tests are about the CLICK PATH, which is the half an api e2e cannot see.
 * =========================================================================================== */

const INVITE_CODES = [
  'provider.office-state.read',
  'provider.office.administrator.invite',
  'provider.insurance-company.administrator.invite',
];

/**
 * The row's own account state is what the reader came to change, so the reload must show it.
 *
 * KEYED ON WHETHER THE INVITATION ACTUALLY HAPPENED, not on a call counter — and the first version
 * of this helper counted calls and failed with Aqaba already reading "1 active of 1" before
 * anything was clicked. The screen reads `/provider/offices` more than once: `load` is memoised on
 * `t`, whose identity changes once the language resolves from `/auth/me`, so the effect runs again.
 * That is the same `t`-captured-at-mount shape this repo has already paid for in `EntitySearch`.
 *
 * A fixture whose answer depends on HOW MANY times it was asked is a fixture that encodes a render
 * count nobody decided. This one depends on the state the test is about.
 */
function mockOfficesAroundInvitation(page: Page) {
  const state = { invited: false };
  const ready = page.route('http://localhost:4000/provider/offices', (route) =>
    route.fulfill({
      status: 200,
      json: state.invited
        ? OFFICES.map((o) =>
            o.subdomain === 'aqaba' ? { ...o, users: 1, activeUsers: 1 } : o,
          )
        : OFFICES,
    }),
  );
  return { state, ready };
}

test('the row SAYS whether an organization has an administrator', async ({
  page,
}) => {
  /*
   * Before this, the only way to learn that a registered office had nobody in it was to query the
   * database — which is how the gap survived two batches. The row answers it now, and the two
   * sentences are different facts: "has an account" is also "cannot be invited", because the invite
   * route itself refuses once the organization holds any account.
   */
  await mockAuth(page, INVITE_CODES);
  await mockOffices(page);
  await page.goto('/provider-offices');

  await expect(page.locator('[data-has-administrator="amman"]')).toContainText(
    'has an account',
  );
  await expect(page.locator('[data-no-account="aqaba"]')).toContainText(
    'nobody can sign in',
  );
  await expect(page.locator('[data-no-account="manarah"]')).toContainText(
    'nobody can sign in',
  );
  // An organization that already has one offers no button: the server would refuse it.
  await expect(page.locator('[data-invite-open="amman"]')).toHaveCount(0);
});

test('a human can invite an office its first administrator by clicking', async ({
  page,
}) => {
  /*
   * THE WHOLE POINT OF THIS FILE'S NEW HALF. Not "the API accepts a request" — that is proven in
   * `office-administrator.e2e-spec.ts` — but that a person who opens the provider dashboard can
   * reach a sent invitation without anybody building a request by hand.
   */
  await mockAuth(page, INVITE_CODES);
  const { state, ready } = mockOfficesAroundInvitation(page);
  await ready;

  let body: Record<string, unknown> | null = null;
  let hitPath: string | null = null;
  await page.route(
    'http://localhost:4000/provider/brokerage-offices/*/administrator',
    (route) => {
      hitPath = new URL(route.request().url()).pathname;
      body = route.request().postDataJSON() as Record<string, unknown>;
      state.invited = true;
      return route.fulfill({
        status: 201,
        json: {
          officeId: 'org-d',
          userId: 'user-new',
          email: 'first.admin@aqaba.jo',
          roleName: 'OFFICE_ADMINISTRATOR',
          howTheySignIn: 'PASSWORD_RESET',
        },
      });
    },
  );

  await page.goto('/provider-offices');
  await page.locator('[data-invite-open="aqaba"]').click();

  const form = page.locator('[data-invite-form="aqaba"]');
  await expect(form).toBeVisible();

  await form.locator('[data-invite-email]').fill('first.admin@aqaba.jo');
  await form.locator('[data-invite-name]').fill('Ahmad Al-Aqaba');
  await form
    .locator('[data-invite-reason]')
    .fill('First administrator for the office registered under CBJ-400.');
  await form.locator('[data-invite-submit]').click();

  await expect(page.locator('[data-invite-done]')).toContainText(
    'first.admin@aqaba.jo',
  );
  // The role is the server's choice and the screen reports it rather than naming one itself.
  await expect(page.locator('[data-invite-done]')).toContainText(
    'OFFICE_ADMINISTRATOR',
  );
  // And it says how they get in, because nothing anywhere produced a password.
  await expect(page.locator('[data-invite-done]')).toContainText(
    'password reset',
  );

  // THE REQUEST WENT TO THE OFFICE PATH with the named organization's id in it — not to the
  // company path, and not to a route that could write into the caller's own organization.
  expect(hitPath).toBe('/provider/brokerage-offices/org-d/administrator');
  expect(body).toEqual({
    email: 'first.admin@aqaba.jo',
    fullName: 'Ahmad Al-Aqaba',
    reason: 'First administrator for the office registered under CBJ-400.',
  });
  // NO PASSWORD FIELD, in any spelling. Asserted as an exact key set above AND by name here,
  // because an addition is how this would arrive.
  for (const k of ['password', 'temporaryPassword', 'initialPassword', 'pass']) {
    expect(Object.keys(body ?? {})).not.toContain(k);
  }
  // And no office field: the tenancy comes from the path and the extension, never the body.
  for (const k of ['organizationId', 'officeId', 'organization', 'tenantId']) {
    expect(Object.keys(body ?? {})).not.toContain(k);
  }

  // The row re-read, so the reader sees the thing they changed.
  await expect(page.locator('[data-has-administrator="aqaba"]')).toContainText(
    'has an account',
  );
});

test('inviting a COMPANY goes to the company path and says what that account can do', async ({
  page,
}) => {
  /*
   * The same act, so the same screen — building a second screen for companies is what this surface
   * exists to avoid. What differs is the path, the role the server chooses, and ONE LINE OF
   * HONESTY: an invited insurance-company administrator can sign in and read the company's own
   * record and nothing else, because the gateway is a separate module that is not built.
   *
   * That line is asserted here so that it cannot be dropped as reassurance-clutter later. A
   * provider who finds out from the company is the failure.
   */
  await mockAuth(page, INVITE_CODES);
  await mockOffices(page);

  let hitPath: string | null = null;
  await page.route(
    'http://localhost:4000/provider/insurance-companies/*/administrator',
    (route) => {
      hitPath = new URL(route.request().url()).pathname;
      return route.fulfill({
        status: 201,
        json: {
          companyId: 'org-e',
          userId: 'user-co',
          email: 'admin@manarah.jo',
          roleName: 'INSURANCE_COMPANY_ADMINISTRATOR',
          howTheySignIn: 'PASSWORD_RESET',
        },
      });
    },
  );

  await page.goto('/provider-offices');
  await page.locator('[data-invite-open="manarah"]').click();

  const limit = page.locator('[data-invite-company-limit]');
  await expect(limit).toBeVisible();
  await expect(limit).toContainText('read the company own record');
  await expect(limit).toContainText('no issuance');
  await expect(limit).toContainText('separate module');
  // The sentence that stops this being reported as the companies being operational.
  await expect(limit).toContainText('does not make it operational');

  const form = page.locator('[data-invite-form="manarah"]');
  await form.locator('[data-invite-email]').fill('admin@manarah.jo');
  await form.locator('[data-invite-name]').fill('Lina Manarah');
  await form
    .locator('[data-invite-reason]')
    .fill('First administrator for the insurance company registered today.');
  await form.locator('[data-invite-submit]').click();

  await expect(page.locator('[data-invite-done]')).toContainText(
    'INSURANCE_COMPANY_ADMINISTRATOR',
  );
  expect(hitPath).toBe('/provider/insurance-companies/org-e/administrator');
});

test('an OFFICE invitation shows no company-limit line', async ({ page }) => {
  // The paired negative: the company line is CONDITIONAL, and a line shown on every invitation
  // would be noise an office reader learns to skip — which is how the one that matters gets missed.
  await mockAuth(page, INVITE_CODES);
  await mockOffices(page);
  await page.goto('/provider-offices');
  await page.locator('[data-invite-open="aqaba"]').click();

  const form = page.locator('[data-invite-form="aqaba"]');
  await expect(form).toBeVisible();
  await expectAbsentWithin(form, (scope) =>
    scope.getByText('does not make it operational'),
  );
});

test('both guarantees are on the form before anything is typed', async ({
  page,
}) => {
  /*
   * A person is about to create an account inside somebody else's organization. The two things they
   * are entitled to see first: that no password is produced anywhere, and that this satisfies no
   * licensing requirement — "first manager" means the first account that OPENS the organization on
   * this platform, not the Central Bank's minimum approved staff, which is recorded against
   * employees and is a different thing.
   */
  await mockAuth(page, INVITE_CODES);
  await mockOffices(page);
  await page.goto('/provider-offices');
  await page.locator('[data-invite-open="aqaba"]').click();

  const noPassword = page.locator('[data-invite-no-password]');
  await expect(noPassword).toContainText('No password is created');
  await expect(noPassword).toContainText('password reset');

  const notLicensing = page.locator('[data-invite-not-licensing]');
  await expect(notLicensing).toContainText('satisfies no licensing requirement');
  await expect(notLicensing).toContainText('broker-in-charge');
});

test('the reason floor is enforced before the request is sent', async ({
  page,
}) => {
  /*
   * The server refuses below ten characters. A screen that sends a request it already knows will
   * be refused teaches the reader that the system is unreliable — so the button stays disabled and
   * says why.
   *
   * NINE characters, not zero: a test that only checks an empty form cannot tell a ten-character
   * floor from a non-empty check.
   */
  await mockAuth(page, INVITE_CODES);
  await mockOffices(page);
  await page.goto('/provider-offices');
  await page.locator('[data-invite-open="aqaba"]').click();

  const form = page.locator('[data-invite-form="aqaba"]');
  await form.locator('[data-invite-email]').fill('a@b.jo');
  await form.locator('[data-invite-name]').fill('Ahmad');
  await form.locator('[data-invite-reason]').fill('too short');
  await expect(form.locator('[data-invite-submit]')).toBeDisabled();
  await expect(page.locator('[data-invite-reason-short]')).toContainText(
    'at least 10 characters',
  );

  await form.locator('[data-invite-reason]').fill('ten chars.');
  await expect(form.locator('[data-invite-submit]')).toBeEnabled();
});

test('the control is PER TYPE: holding the office code does not offer a company', async ({
  page,
}) => {
  /*
   * Two codes exist deliberately — reusing the office code for a company would make the name
   * promise "office" while the act reached a company. So the control is offered against the code
   * for THAT ROW's type, and a reader who holds one sees exactly the rows they can act on.
   *
   * The table still renders either way: the reader came to read office state, not to invite, so a
   * control they cannot use simply is not there. It is NOT a refusal sentence — explain a refusal
   * where the reader came for the thing refused.
   */
  await mockAuth(page, [
    'provider.office-state.read',
    'provider.office.administrator.invite',
  ]);
  await mockOffices(page);
  await page.goto('/provider-offices');

  await expect(page.locator('[data-invite-open="aqaba"]')).toBeVisible();
  // Anchored on the row that IS there, from the same render — an absence asserted against nothing
  // passes on an unhydrated page.
  const companyRow = page.locator('[data-office="manarah"]');
  await expect(companyRow).toBeVisible();
  await expect(page.locator('[data-invite-open="manarah"]')).toHaveCount(0);
  // And the row still says the company has nobody in it, which is the fact a reader needs even
  // when they cannot act on it.
  await expect(page.locator('[data-no-account="manarah"]')).toBeVisible();
});

test('a registered company is NOT reported as being in regulatory default', async ({
  page,
}) => {
  /*
   * THE FALSE FINDING THIS WIDENING COULD HAVE REINTRODUCED, and the reason the view's filter said
   * BROKERAGE_OFFICE in the first place.
   *
   * An insurance company has no broker licence by nature, so every licence field is null — the same
   * raw shape as an office with no term on record, which item (c) made BLOCK new business under
   * art. 21/a/9. Unbranched, this screen would tell the reader that a company the provider itself
   * registered is in regulatory default.
   *
   * BOTH HALVES are asserted, because a test that only checked the company would pass against a
   * screen that had stopped reporting the office state too — which is the opposite defect and just
   * as wrong.
   */
  await mockAuth(page, INVITE_CODES);
  await mockOffices(page);
  await page.goto('/provider-offices');

  const company = page.locator('[data-standing="manarah"]');
  await expect(company).toContainText('not applicable');
  await expectAbsentWithin(company, (scope) => scope.getByText('21/a/9'));

  // The office with no term still says it, in full, with the article.
  const office = page.locator('[data-standing="zarqa"]');
  await expect(office).toContainText('no licence term on record');
  await expect(office).toContainText('21/a/9');
});

test('@a11y the invitation form has no violations', async ({ page }) => {
  await mockAuth(page, INVITE_CODES);
  await mockOffices(page);
  await page.goto('/provider-offices');
  await page.locator('[data-invite-open="aqaba"]').click();
  await expect(page.locator('[data-invite-form="aqaba"]')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

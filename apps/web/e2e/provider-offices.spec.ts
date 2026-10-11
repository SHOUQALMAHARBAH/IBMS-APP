import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { permissionsForRoles } from './fixtures/role-permissions';

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

async function mockAuth(page: Page, roles: string[]) {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'fake-access-token' } }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        roles,
        permissions: permissionsForRoles(roles),
      },
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
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
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
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
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
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
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
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await mockOffices(page);
  await page.goto('/provider-offices');

  const row = page.locator('[data-office="irbid"]');
  await expect(row).toContainText('never used');
});

test('a reader without the code gets the shared refusal, not an empty page', async ({
  page,
}) => {
  await mockAuth(page, ['SALES_RELATIONSHIP_OFFICER']);
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
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await mockOffices(page, []);
  await page.goto('/provider-offices');

  await expect(page.locator('[data-provider-empty]')).toContainText(
    'not a normal result',
  );
  await expect(page.locator('[data-provider-offices]')).toHaveCount(0);
});

test('@a11y the provider dashboard has no violations', async ({ page }) => {
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await mockOffices(page);
  await page.goto('/provider-offices');
  await expect(page.locator('[data-provider-offices]')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

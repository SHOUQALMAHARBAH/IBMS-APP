import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * MODULE 0-ب ITEM (e) — the insurance-company registration screen.
 *
 * The api e2e proves the six refusals over real HTTP and that no constraint reaches the wire. What
 * only these tests can prove is what a reader SEES:
 *
 *   * that the thirteen sheet fields which are NOT on this form are STATED rather than missing,
 *   * that the licensed lines say which fact they are — the licence, not what offices have bought,
 *   * that a server refusal arrives in the SERVER'S own words,
 *   * and that a reader without the code gets the shared refusal sentence rather than a form they
 *     cannot submit.
 */

const ME_BASE = {
  id: 'user-1',
  email: 'operator@ibms.local',
  fullName: 'Platform Operator',
  languagePreference: 'EN',
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

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

const ROW = (id: string, code: string, en: string, ar: string) => ({
  id,
  code,
  nameEn: en,
  nameAr: ar,
  descriptionAr: null,
});

const REFERENCE = {
  countries: [ROW('c-1', 'JO', 'Jordan', 'الأردن')],
  cities: [ROW('city-1', 'AMMAN', 'Amman', 'عمّان')],
  banks: [ROW('bank-1', 'ARAB_BANK', 'Arab Bank', 'البنك العربي')],
  currencies: [ROW('cur-1', 'JOD', 'Jordanian Dinar', 'دينار أردني')],
  licensingAuthorities: [
    ROW('auth-1', 'CBJ', 'Central Bank of Jordan', 'البنك المركزي الأردني'),
  ],
  ratingAgencies: [ROW('ra-1', 'AM_BEST', 'AM Best', 'إيه إم بست')],
  legalForms: [
    ROW('lf-1', 'PUBLIC_SHAREHOLDING', 'Public shareholding company', 'شركة مساهمة عامة'),
  ],
  businessModels: [ROW('bm-1', 'COMPOSITE', 'Composite', 'مركّبة')],
};

const LINES = [
  {
    id: 'line-1',
    code: 'MOTOR_COMPREHENSIVE',
    nameEn: 'Motor comprehensive',
    nameAr: 'مركبات شامل',
    category: 'GENERAL',
  },
  {
    id: 'line-2',
    code: 'GROUP_LIFE',
    nameEn: 'Group life',
    nameAr: 'حياة جماعي',
    category: 'LIFE',
  },
];

function registeredBody(over: Record<string, unknown> = {}) {
  return {
    id: 'org-ins-1',
    code: 'INS-1',
    legalName: 'Registered Insurance Company',
    legalNameAr: 'شركة التأمين المسجّلة',
    shortName: 'RegIns',
    certificateDocumentId: 'doc-1',
    licensedLineCount: 2,
    licensedCategories: ['GENERAL', 'LIFE'],
    ...over,
  };
}

/** The API ORIGIN is named, never a bare `**\/...`: a pattern that can also match the screen's own
 *  navigation makes Playwright serve the mock as the document, which looks exactly like a page that
 *  failed to mount. */
async function mockReads(page: Page) {
  await page.route('http://localhost:4000/reference-data', (route) =>
    route.fulfill({ status: 200, json: REFERENCE }),
  );
  await page.route('http://localhost:4000/insurance-lines', (route) =>
    route.fulfill({ status: 200, json: LINES }),
  );
}

async function fillValidForm(page: Page) {
  const value: Record<string, string> = {
    code: 'INS-1',
    legalNameAr: 'شركة التأمين المسجّلة',
    legalName: 'Registered Insurance Company',
    shortName: 'RegIns',
    nationalEstablishmentNo: 'INAT-1',
    commercialRegistrationNo: 'ICR-1',
    taxNumber: 'ITAX-1',
    insurerLicenseNumber: 'CBJ-INS-1',
    certificateFileName: 'cbj-insurer-licence.pdf',
    certificateStorageRef: 'store/cbj-insurer-licence.pdf',
    address: 'Amman',
    phone: '+962790000001',
    email: 'company@example.test',
    quotationEmail: 'quotes@example.test',
    claimsEmail: 'claims@example.test',
    iban: 'JO94CBJO0010000000000131000302',
    subdomain: 'reg-ins',
  };
  for (const [field, v] of Object.entries(value)) {
    await page.locator(`[data-field="${field}"]`).fill(v);
  }
  await page.locator('[data-field="legalFormId"]').selectOption('lf-1');
  await page
    .locator('[data-field="licensingAuthorityId"]')
    .selectOption('auth-1');
  await page.locator('[data-field="businessModelId"]').selectOption('bm-1');
  await page.locator('[data-field="countryId"]').selectOption('c-1');
  await page.locator('[data-field="cityId"]').selectOption('city-1');
  await page.locator('[data-field="bankId"]').selectOption('bank-1');
  await page.locator('[data-line="MOTOR_COMPREHENSIVE"]').check();
  await page.locator('[data-line="GROUP_LIFE"]').check();
}

test.describe('registering an insurance company', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page, ['provider.insurer.register']);
    await mockReads(page);
  });

  test("is sectioned by the dictionary's own groups", async ({ page }) => {
    await page.goto('/provider-register-insurer');
    for (const section of [
      'Basic identity',
      'Licensing and activity',
      'Address and contact',
      'Integration',
      'Banking',
      'Platform data',
    ]) {
      await expect(
        page.getByRole('group', { name: section, exact: true }),
      ).toBeVisible();
    }
  });

  test('STATES what is recorded by the office instead, rather than leaving gaps', async ({
    page,
  }) => {
    /*
     * THIRTEEN of the sheet's 38 fields are not on this form, and the difference between "absent" and
     * "recorded elsewhere, and here is where" is the difference between thirteen apparent shortfalls
     * and the design. Decision 63 made visible on the screen a person actually reads.
     */
    await page.goto('/provider-register-insurer');
    /*
     * VISIBLE, not merely present — and a plant is what showed the difference. Hiding the note left
     * every `toContainText` assertion green, because text content is readable from a hidden element.
     * For a sentence whose entire purpose is to be READ, "it is in the DOM" is not the claim.
     */
    await expect(page.getByTestId('office-scoped-note')).toBeVisible();
    await expect(page.getByTestId('office-scoped-note')).toContainText(
      'recorded by each office',
    );
    await expect(page.getByTestId('office-scoped-note')).toContainText(
      'financial strength rating',
    );
    await expect(page.getByTestId('status-derived-note')).toBeVisible();
    await expect(page.getByTestId('status-derived-note')).toContainText(
      'neither entered nor stored',
    );
  });

  test('says WHICH FACT the licensed lines are — the licence, not what offices bought', async ({
    page,
  }) => {
    // The two-source rule, on the screen. `InsurerDirectory.lines` renders identically and is a
    // different fact; a reader who confuses them would read a company's licence out of market
    // behaviour.
    await page.goto('/provider-register-insurer');
    // VISIBLE, for the reason the test above records.
    await expect(page.getByTestId('licensed-lines-hint')).toBeVisible();
    await expect(page.getByTestId('licensed-lines-hint')).toContainText(
      'permits it to underwrite',
    );
    await expect(page.getByTestId('licensed-lines-hint')).toContainText(
      'NOT what offices have recorded buying',
    );
  });

  test('warns that registering creates a tenant, before the first field', async ({
    page,
  }) => {
    await page.goto('/provider-register-insurer');
    await expect(page.getByTestId('tenant-warning')).toContainText(
      'cannot be deleted',
    );
  });

  test('registers, and reports the DERIVED insurance types', async ({
    page,
  }) => {
    await page.route(
      'http://localhost:4000/provider/insurance-companies',
      (route) => route.fulfill({ status: 201, json: registeredBody() }),
    );
    await page.goto('/provider-register-insurer');
    await fillValidForm(page);
    await page.getByRole('button', { name: 'Register company' }).click();

    await expect(page.getByTestId('registered-company')).toContainText('INS-1');
    await expect(page.getByTestId('licensed-categories')).toContainText(
      'GENERAL, LIFE',
    );
    // BOTH types, which says something specific: art. 3/a's one-type rule binds a natural-person
    // BROKER, not a company.
    await expect(page.getByTestId('licensed-lines')).toContainText('2');
  });

  test("renders the SERVER'S refusal, not a generic one", async ({ page }) => {
    await page.route(
      'http://localhost:4000/provider/insurance-companies',
      (route) =>
        route.fulfill({
          status: 422,
          json: {
            statusCode: 422,
            message:
              'An API integration needs its endpoint. Enter the endpoint, or choose a different integration method.',
          },
        }),
    );
    await page.goto('/provider-register-insurer');
    await fillValidForm(page);
    await page.locator('[data-field="integrationMethod"]').selectOption('API');
    await page.getByRole('button', { name: 'Register company' }).click();

    await expect(page.getByTestId('submit-error')).toContainText(
      'needs its endpoint',
    );
    // DECISION 90 on the screen too: whatever reaches the reader, it is not a constraint.
    await expect(page.getByTestId('submit-error')).not.toContainText(
      'violates',
    );
  });

  test('a reader without the code gets the shared refusal sentence, not an empty page', async ({
    page,
  }) => {
    await mockAuth(page, ['provider.office.register']);
    await page.goto('/provider-register-insurer');
    await expect(
      page.getByText('provider.insurer.register', { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Register an insurance company' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Register company' }),
    ).toHaveCount(0);
  });

  test('@a11y has no detectable accessibility violations', async ({ page }) => {
    await page.goto('/provider-register-insurer');
    await expect(
      page.getByRole('group', { name: 'Basic identity', exact: true }),
    ).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

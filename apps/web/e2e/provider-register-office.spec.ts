import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * MODULE 0-ب ITEM (d) — the registration screen.
 *
 * The api e2e proves the four refusals over real HTTP and the grant set on the real database. What
 * only these tests can prove is what a reader SEES:
 *
 *   * that the form is sectioned by the data dictionary's own groups rather than regrouped,
 *   * that the three fields nobody enters are STATED ABSENCES and not missing fields,
 *   * that "no capital recorded" and "capital short" render as different things,
 *   * that the art. 10/b expiry warning appears AFTER a successful registration — the warning and
 *     the success together, which is the whole claim that it does not block,
 *   * and that a server refusal reaches the reader in the SERVER'S own words.
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

/** By explicit CODES: no role name in this fixture can express "platform operator", because
 *  `permissionsForRoles` is built from the twelve seeded OFFICE roles and the provider's role lives
 *  in a different organization. Same reason `provider-offices.spec.ts` does it this way. */
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

/** Shaped from `ReferenceData`, not approximated. */
const REFERENCE = {
  countries: [
    {
      id: 'c-1',
      code: 'JO',
      nameEn: 'Jordan',
      nameAr: 'الأردن',
      descriptionAr: null,
    },
  ],
  cities: [
    {
      id: 'city-1',
      code: 'AMMAN',
      nameEn: 'Amman',
      nameAr: 'عمّان',
      descriptionAr: null,
    },
  ],
  banks: [
    {
      id: 'bank-1',
      code: 'ARAB_BANK',
      nameEn: 'Arab Bank',
      nameAr: 'البنك العربي',
      descriptionAr: null,
    },
  ],
  currencies: [
    {
      id: 'cur-1',
      code: 'JOD',
      nameEn: 'Jordanian Dinar',
      nameAr: 'دينار أردني',
      descriptionAr: null,
    },
  ],
  licensingAuthorities: [
    {
      id: 'auth-1',
      code: 'CBJ',
      nameEn: 'Central Bank of Jordan',
      nameAr: 'البنك المركزي الأردني',
      descriptionAr: null,
    },
  ],
  ratingAgencies: [
    {
      id: 'ra-1',
      code: 'AM_BEST',
      nameEn: 'AM Best',
      nameAr: 'إيه إم بست',
      descriptionAr: null,
    },
  ],
  legalForms: [
    {
      id: 'lf-1',
      code: 'SOLE_ESTABLISHMENT',
      nameEn: 'Sole establishment',
      nameAr: 'مؤسسة فردية',
      descriptionAr: 'الشكل الذي تقتضيه م١٠/أ/١/أ للوسيط الطبيعي.',
    },
  ],
  businessModels: [
    {
      id: 'bm-1',
      code: 'COMPOSITE',
      nameEn: 'Composite',
      nameAr: 'مركّبة',
      descriptionAr: 'شركة تكتب التأمين العام والحياة معاً.',
    },
  ],
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
    id: 'org-new',
    code: 'OFF-1',
    legalName: 'New Brokerage Office',
    legalNameAr: 'مكتب وساطة جديد',
    administratorRoleId: 'role-new',
    administratorGrantCount: 45,
    licensedTypes: ['GENERAL'],
    capital: {
      requiredCapital: '5000.000',
      paidUpCapital: null,
      shortfall: null,
      meetsRequirement: false,
      capitalIsUnrecorded: true,
    },
    expiryIsEndOfCalendarYear: true,
    expiryMatchesThreeYearTerm: true,
    ...over,
  };
}

/** The API ORIGIN is named, never `**\/reference-data`: a bare pattern can also match the screen's
 *  own navigation when the path shares a noun, and Playwright then serves the mock as the document —
 *  which looks exactly like a page that failed to mount. */
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
    code: 'OFF-1',
    legalNameAr: 'مكتب وساطة جديد',
    legalName: 'New Brokerage Office',
    nationalEstablishmentNo: 'NAT-1',
    commercialRegistrationNo: 'CR-1',
    taxNumber: 'TAX-1',
    licenseNumber: 'CBJ-L-1',
    licenseIssuedAt: '2026-03-01',
    licenseExpiresAt: '2028-12-31',
    certificateFileName: 'cbj-licence.pdf',
    certificateStorageRef: 'store/cbj-licence.pdf',
    address: 'Amman',
    phone: '+962790000000',
    email: 'office@example.test',
    generalManagerName: 'A Manager',
    complianceOfficerName: 'A Compliance Officer',
    complianceOfficerEmail: 'compliance@example.test',
    piPolicyNumber: 'PI-1',
    piInsurerName: 'An Insurer',
    piCoverageLimit: '250000.000',
    piExpiresAt: '2027-12-31',
    iban: 'JO94CBJO0010000000000131000302',
    subdomain: 'new-office',
  };
  for (const [field, v] of Object.entries(value)) {
    await page.locator(`[data-field="${field}"]`).fill(v);
  }
  await page.locator('[data-field="legalFormId"]').selectOption('lf-1');
  await page.locator('[data-field="licensingAuthorityId"]').selectOption('auth-1');
  await page.locator('[data-field="countryId"]').selectOption('c-1');
  await page.locator('[data-field="cityId"]').selectOption('city-1');
  await page.locator('[data-field="bankId"]').selectOption('bank-1');
  await page.locator('[data-field="currencyId"]').selectOption('cur-1');
  await page.locator('[data-line="MOTOR_COMPREHENSIVE"]').check();
}

test.describe('registering a brokerage office', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page, ['provider.office.register']);
    await mockReads(page);
  });

  test('is sectioned by the data dictionary\'s own groups', async ({ page }) => {
    await page.goto('/provider-register-office');
    // The person filling this in has the sheet or the certificate in front of them. A form that
    // regroups the fields by what is convenient to render makes them hunt.
    for (const section of [
      'Basic identity',
      'Licence',
      'Address and contact',
      'Key people',
      'Regulatory guarantees',
      'Banking',
      'Platform data',
    ]) {
      await expect(
        page.getByRole('group', { name: section, exact: true }),
      ).toBeVisible();
    }
  });

  test('STATES the three things nobody enters, rather than omitting them', async ({
    page,
  }) => {
    await page.goto('/provider-register-office');
    // An absent field reads as an oversight; a stated absence reads as a decision — and all three
    // are decisions (71, 67, and "created_by is the server's").
    await expect(page.getByTestId('status-derived-note')).toContainText(
      'neither entered nor stored',
    );
    await expect(page.getByText('derived from these branches')).toBeVisible();
  });

  test('warns that registering creates a tenant, before the first field', async ({
    page,
  }) => {
    await page.goto('/provider-register-office');
    await expect(page.getByTestId('tenant-warning')).toContainText(
      'cannot be deleted',
    );
  });

  test('says the bank guarantee is NOT a regulatory requirement', async ({
    page,
  }) => {
    await page.goto('/provider-register-office');
    // The dictionary's correction 1, on the screen rather than only in a migration comment: an
    // operator who sees four guarantee fields will assume the regulation asks for them.
    await expect(page.getByTestId('guarantee-note')).toContainText(
      'does not appear in CBJ Instructions No. 9 of 2026',
    );
    await expect(page.getByTestId('pi-note')).toContainText(
      'mandatory without condition',
    );
  });

  test('registers, and reports the administrator grants and the DERIVED types', async ({
    page,
  }) => {
    await page.route(
      'http://localhost:4000/provider/brokerage-offices',
      (route) => route.fulfill({ status: 201, json: registeredBody() }),
    );
    await page.goto('/provider-register-office');
    await fillValidForm(page);
    await page.getByRole('button', { name: 'Register office' }).click();

    await expect(page.getByTestId('administrator-grants')).toContainText('45');
    await expect(page.getByTestId('administrator-grants')).toContainText(
      'computed from the permission catalogue',
    );
    await expect(page.getByTestId('licensed-types')).toContainText('GENERAL');
  });

  test('renders "no capital recorded" and "capital short" as DIFFERENT facts', async ({
    page,
  }) => {
    // Conflating them tells an office it is undercapitalised when nobody typed the number. Asserted
    // as a pair in one test, because the claim is that they differ.
    await page.route(
      'http://localhost:4000/provider/brokerage-offices',
      (route) => route.fulfill({ status: 201, json: registeredBody() }),
    );
    await page.goto('/provider-register-office');
    await fillValidForm(page);
    await page.getByRole('button', { name: 'Register office' }).click();
    await expect(page.getByTestId('capital-unrecorded')).toContainText(
      'missing fact about the office',
    );
    await expect(page.getByTestId('capital-short')).toHaveCount(0);

    await page.getByRole('button', { name: 'Register another office' }).click();
    await page.route(
      'http://localhost:4000/provider/brokerage-offices',
      (route) =>
        route.fulfill({
          status: 201,
          json: registeredBody({
            capital: {
              requiredCapital: '5000.000',
              paidUpCapital: '1000.000',
              shortfall: '4000.000',
              meetsRequirement: false,
              capitalIsUnrecorded: false,
            },
          }),
        }),
    );
    await fillValidForm(page);
    await page.getByRole('button', { name: 'Register office' }).click();
    await expect(page.getByTestId('capital-short')).toContainText('4000.000');
    await expect(page.getByTestId('capital-unrecorded')).toHaveCount(0);
  });

  test('shows the art. 10/b expiry warning AND the registration that was not blocked', async ({
    page,
  }) => {
    /*
     * THE PAIR IS THE CLAIM. A test that only asserted the warning would pass against an
     * implementation that also refused — which is the version somebody writes when they read art.
     * 10/b as a gate. The certificate is the authority.
     */
    await page.route(
      'http://localhost:4000/provider/brokerage-offices',
      (route) =>
        route.fulfill({
          status: 201,
          json: registeredBody({
            expiryIsEndOfCalendarYear: false,
            expiryMatchesThreeYearTerm: false,
          }),
        }),
    );
    await page.goto('/provider-register-office');
    await fillValidForm(page);
    await page.getByRole('button', { name: 'Register office' }).click();

    await expect(page.getByTestId('expiry-not-year-end')).toContainText(
      '31 December',
    );
    await expect(page.getByTestId('expiry-not-three-years')).toBeVisible();
    // AND the office exists. Both halves, in one test.
    await expect(page.getByTestId('registered-office')).toContainText('OFF-1');
  });

  test("renders the SERVER'S refusal, not a generic one", async ({ page }) => {
    /*
     * Four different refusals reach this screen and each names what to do about it. Replacing them
     * with "could not register" would make a duplicate establishment number indistinguishable from
     * an art. 3/a breach — and the second needs a different person to fix it.
     */
    await page.route(
      'http://localhost:4000/provider/brokerage-offices',
      (route) =>
        route.fulfill({
          status: 422,
          json: {
            statusCode: 422,
            message:
              'a natural-person broker may be licensed for ONE insurance type (CBJ Instructions No. 9 of 2026, art. 3/a), and the branches chosen span 2: GENERAL and LIFE. Register this office as CORPORATE, or choose branches within a single type.',
          },
        }),
    );
    await page.goto('/provider-register-office');
    await fillValidForm(page);
    await page.getByRole('button', { name: 'Register office' }).click();

    await expect(page.getByTestId('submit-error')).toContainText('art. 3/a');
    await expect(page.getByTestId('submit-error')).toContainText(
      'choose branches within a single type',
    );
  });

  test('a reader without the code gets the shared refusal sentence, not an empty page', async ({
    page,
  }) => {
    await mockAuth(page, ['provider.office-state.read']);
    await page.goto('/provider-register-office');
    await expect(
      page.getByText('provider.office.register', { exact: false }),
    ).toBeVisible();
    // And no form to fill in. Anchored on the heading, which IS rendered, so an unhydrated page
    // cannot satisfy the absence.
    await expect(
      page.getByRole('heading', { name: 'Register a brokerage office' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Register office' }),
    ).toHaveCount(0);
  });

  test('@a11y has no detectable accessibility violations', async ({ page }) => {
    await page.goto('/provider-register-office');
    await expect(
      page.getByRole('group', { name: 'Basic identity', exact: true }),
    ).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

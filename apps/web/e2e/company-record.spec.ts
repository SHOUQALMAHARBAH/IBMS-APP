import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * MODULE 0-ب ITEM (f), COMPANY HALF — the company's own registry record screen.
 *
 * ## THIS FILE CARRIES THE 200 PATH, AND THAT IS NOT A CONVENIENCE
 *
 * `company-administrator-invitation.e2e-spec.ts` deliberately never authenticates as a company
 * administrator: signing in writes `AuditLogEntry` rows into that organization's own tenant, the
 * organization FK is `ON DELETE RESTRICT`, and DELETE on that table is refused by a trigger — so one
 * login makes the company permanent and db-test accumulates one per run. Two brokerage offices were
 * stranded proving it. So the api spec covers the REFUSALS, which need no company, and the populated
 * screen is covered here against a mocked response.
 *
 * ## WHAT THESE TESTS ARE ACTUALLY FOR
 *
 *   * the four DELIBERATE ABSENCES are absent — no rating, no linked offices, no customer/money/
 *     policy data. Each is a decision, and a decision nothing asserts is a decision that gets
 *     undone by the next person who adds a field "while they are in there".
 *   * the record-state clause is VISIBLE, not merely present. `toContainText` passes on a hidden
 *     element, which this repository has already paid for once.
 *   * the screen is READ-ONLY — no form, no save.
 *   * the nav entry is gated BOTH WAYS: a company sees it, a brokerage office does not.
 */

const ME_BASE = {
  id: 'user-1',
  email: 'admin@company.test',
  fullName: 'Company Administrator',
  languagePreference: 'EN',
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

/** The six self-administration codes a company administrator actually holds. */
const COMPANY_CODES = [
  'permission.read',
  'role.create',
  'role.deactivate',
  'role.read',
  'role.update',
  'user.manage',
];

async function mockAuth(
  page: Page,
  organizationType: string,
  permissions: string[] = COMPANY_CODES,
) {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'fake-access-token' } }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        roles: ['INSURANCE_COMPANY_ADMINISTRATOR'],
        permissions,
        organizationType,
      },
    }),
  );
}

const RECORD = {
  identity: {
    id: 'org-1',
    legalName: 'Jordan Insurance Company',
    legalNameAr: 'شركة التأمين الأردنية',
    shortName: 'JIC',
    code: 'JIC',
    nationalEstablishmentNo: 'NE-1',
    commercialRegistrationNo: 'CR-1',
    taxNumber: 'TX-1',
    insurerLicenseNumber: 'IL-1',
    legalForm: {
      code: 'PUBLIC_SHAREHOLDING',
      nameEn: 'Public shareholding company',
      nameAr: 'شركة مساهمة عامة',
    },
    licensingAuthority: {
      code: 'CBJ',
      nameEn: 'Central Bank of Jordan',
      nameAr: 'البنك المركزي الأردني',
    },
    businessModel: {
      code: 'CONVENTIONAL',
      nameEn: 'Conventional insurance',
      nameAr: 'تأمين تقليدي',
    },
    country: { code: 'JO', nameEn: 'Jordan', nameAr: 'الأردن' },
    city: { code: 'AMMAN', nameEn: 'Amman', nameAr: 'عمّان' },
    address: 'Amman',
    phone: '+962-6-0000000',
    email: 'info@company.test',
    website: null,
    quotationEmail: 'quotes@company.test',
    claimsEmail: 'claims@company.test',
    integrationMethod: 'EMAIL',
    registeredAt: '2026-10-15T00:00:00.000Z',
  },
  licensedLines: [
    {
      code: 'MOTOR_COMPREHENSIVE',
      nameEn: 'Motor comprehensive',
      nameAr: 'تأمين المركبات الشامل',
      category: 'GENERAL',
    },
    {
      code: 'GROUP_LIFE',
      nameEn: 'Group life',
      nameAr: 'تأمين الحياة الجماعي',
      category: 'LIFE',
    },
  ],
  licensedCategories: ['GENERAL', 'LIFE'],
  certificate: {
    id: 'doc-1',
    fileName: 'licence.pdf',
    recordedAt: '2026-10-15T00:00:00.000Z',
  },
  recordState: { certificateOnRecord: true, licensedLineCount: 2 },
};

async function mockRecord(page: Page, body: unknown = RECORD) {
  await page.route('http://localhost:4000/company/registry-record', (route) =>
    route.fulfill({ status: 200, json: body }),
  );
}

test.describe('the company reads its own registry record', () => {
  test('renders identity, licensed lines, the certificate and the record state', async ({
    page,
  }) => {
    await mockAuth(page, 'INSURANCE_COMPANY');
    await mockRecord(page);
    await page.goto('/company-record');

    await expect(
      page.getByRole('heading', { name: /your company record/i }),
    ).toBeVisible();

    const identity = page.getByTestId('company-identity');
    await expect(identity).toContainText('Jordan Insurance Company');
    await expect(identity).toContainText('IL-1');
    await expect(identity).toContainText('Central Bank of Jordan');
    await expect(identity).toContainText('Public shareholding company');

    const lines = page.getByTestId('company-licensed-lines');
    await expect(lines).toContainText('MOTOR_COMPREHENSIVE');
    await expect(lines).toContainText('GROUP_LIFE');
    // The CATEGORIES are derived from the lines, never stored — decision 67.
    await expect(lines).toContainText('GENERAL');
    await expect(lines).toContainText('LIFE');

    await expect(page.getByTestId('company-certificate')).toContainText(
      'licence.pdf',
    );

    const state = page.getByTestId('company-record-state');
    await expect(state).toContainText('Licence certificate recorded');
    await expect(state).toContainText('Yes');
  });

  test('the record-state clause is VISIBLE and never makes a finding about the company', async ({
    page,
  }) => {
    await mockAuth(page, 'INSURANCE_COMPANY');
    await mockRecord(page);
    await page.goto('/company-record');

    /*
     * `toBeVisible()` FIRST. `toContainText` passes on a hidden element, so a clause moved into a
     * collapsed block would still satisfy a text assertion — which is exactly how the office's
     * registration-pack marker was once "asserted" without being shown.
     */
    const scope = page.getByTestId('company-record-state-scope');
    await expect(scope).toBeVisible();
    await expect(scope).toContainText('what the system records');
    await expect(scope).toContainText('not a finding about the company');
    // And what "recorded" is allowed to mean: this product has no object storage.
    await expect(scope).toContainText('never that the file can be retrieved');
  });

  test('says our not holding a certificate is OUR gap, not a breach by the company', async ({
    page,
  }) => {
    await mockAuth(page, 'INSURANCE_COMPANY');
    await mockRecord(page, {
      ...RECORD,
      certificate: null,
      recordState: { certificateOnRecord: false, licensedLineCount: 2 },
    });
    await page.goto('/company-record');

    const certificate = page.getByTestId('company-certificate');
    await expect(certificate).toBeVisible();
    await expect(certificate).toContainText('a gap in OUR record');
    // It must NOT read as a compliance finding against the company.
    await expect(certificate).not.toContainText(/breach|violation|non-complian/i);
  });

  test('the four deliberate absences are absent', async ({ page }) => {
    await mockAuth(page, 'INSURANCE_COMPANY');
    await mockRecord(page);
    await page.goto('/company-record');
    await expect(page.getByTestId('company-identity')).toBeVisible();

    const body = page.locator('main');
    /*
     * NO RATING. There is none at company level — `Organization` has no `%rating%` column — and the
     * only rating in the database is an OFFICE's private assessment of a counterparty. Showing it
     * would disclose one office's judgement to the company it judged.
     */
    await expect(body).not.toContainText(/rating|financial strength/i);
    // NO LINKED OFFICES. Which offices work with this company is each office's own commercial fact.
    await expect(body).not.toContainText(/linked offic|brokerage offices|offices working/i);
    /*
     * NO CUSTOMER, MONEY OR POLICY DATA — and the terms are chosen precisely rather than broadly.
     * `/claim/` would FAIL on "Claims email", which is a CONTACT field the insurer sheet requires
     * and not claims data; a test that forbids a legitimate label teaches the next person to delete
     * the test. So this names the data that must never appear: a customer, a premium, a commission,
     * a policy number.
     */
    await expect(body).not.toContainText(/customer|premium|commission|policy number|claim amount|claims paid/i);
  });

  test('is READ-ONLY — no form and no save', async ({ page }) => {
    await mockAuth(page, 'INSURANCE_COMPANY');
    await mockRecord(page);
    await page.goto('/company-record');
    await expect(page.getByTestId('company-identity')).toBeVisible();

    // Anchored on a POSITIVE read from the same render, so an unhydrated page cannot satisfy these.
    await expect(page.locator('main form')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /save|submit|update|correct/i }),
    ).toHaveCount(0);
    await expect(page.locator('main input, main textarea, main select')).toHaveCount(0);
  });

  test('a BROKERAGE OFFICE user is refused in words that name where their own licence lives', async ({
    page,
  }) => {
    await mockAuth(page, 'BROKERAGE_OFFICE', ['customer.read']);
    await page.route('http://localhost:4000/company/registry-record', (route) =>
      route.fulfill({
        status: 403,
        json: {
          statusCode: 403,
          message:
            'This screen shows an insurance company its own registry record, and your organization is a BROKERAGE_OFFICE. A brokerage office sees its own licence and scope at /regulatory-compliance; the platform provider sees every office at /provider/offices.',
        },
      }),
    );
    await page.goto('/company-record');

    const error = page.getByTestId('company-record-error');
    await expect(error).toBeVisible();
    // NEVER an empty screen: a reader who cannot use this is told where to go instead.
    await expect(error).toContainText('not an insurance company');
    await expect(error).toContainText('regulatory-compliance');
  });

  test('the nav entry is gated BOTH WAYS — a company sees it, a brokerage office does not', async ({
    page,
  }) => {
    await mockAuth(page, 'INSURANCE_COMPANY');
    await mockRecord(page);
    await page.goto('/company-record');
    await expect(page.getByTestId('company-identity')).toBeVisible();
    /*
     * BY HREF, never by accessible role: a nav group is a `<details>` that collapses by default, so
     * `getByRole('link')` returns zero whether the entry is gated out or merely closed. That
     * distinction cost this repository a test that could never fail.
     */
    /*
     * SCOPED TO THE PRIMARY NAV. A bare `locator('nav')` is a STRICT-MODE VIOLATION here — this
     * shell renders two, "Primary" and "Account and settings" — and that is how the first version of
     * this test failed. Scoping is the fix; loosening the selector would have let it pass against
     * whichever nav happened to match first.
     */
    const primary = page.getByRole('navigation', { name: 'Primary' });
    await expect(primary.locator('a[href="/company-record"]')).toHaveCount(1);

    await mockAuth(page, 'BROKERAGE_OFFICE', ['customer.read']);
    await page.goto('/customers');
    // Anchored on a POSITIVE read of the same nav, so a zero below is a gate and not an unrendered page.
    await expect(primary).toBeVisible();
    await expect(primary.locator('a[href="/company-record"]')).toHaveCount(0);
  });

  test('@a11y the populated record has no violations', async ({ page }) => {
    await mockAuth(page, 'INSURANCE_COMPANY');
    await mockRecord(page);
    await page.goto('/company-record');
    await expect(page.getByTestId('company-identity')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

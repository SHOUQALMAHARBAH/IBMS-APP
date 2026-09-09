import { expect, test, type Page } from '@playwright/test';

/**
 * Part H Phase 2 Verification — Bilingual Detail Pages Screenshots
 *
 * Captures both /leads/[id] and /policies/[id] detail pages in English and Arabic
 * to verify bilingual support, RTL rendering, status mapping, and field display.
 */

const ME_BASE = {
  id: 'user-1',
  email: 'officer@ibms.test',
  fullName: 'Placement Officer',
  languagePreference: 'EN',
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(page: Page, languagePreference: 'AR' | 'EN' = 'EN') {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'fake-access-token' } }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, languagePreference, roles: ['sales', 'manager'] },
    }),
  );
}

const LEAD_FIXTURE = {
  id: 'lead-1',
  fullName: 'Ali Mohammed Al-Hashimi',
  source: 'REFERRAL',
  status: 'QUALIFIED',
  contactPhone: '+962796123456',
  contactEmail: 'ali@customer.example',
  marketingConsentGranted: true,
  createdAt: '2026-01-15T10:30:00.000Z',
  updatedAt: '2026-02-20T14:45:00.000Z',
};

const POLICY_FIXTURE = {
  id: 'policy-1',
  policyNumber: 'POL-2026-000451',
  status: 'DELIVERED',
  inceptionDate: '2026-03-01T00:00:00.000Z',
  customer: {
    id: 'cust-1',
    legalName: 'Amman Trading Company LLC',
  },
  recommendation: {
    id: 'rec-1',
    recommendedQuotation: {
      premium: '15,000.00 JOD',
      insurer: { name: 'Jordan Insurance Co' },
      deductible: '500.00 JOD',
      commission: '1,500.00 JOD',
    },
  },
  createdAt: '2026-02-15T09:00:00.000Z',
  updatedAt: '2026-02-25T16:20:00.000Z',
};

test.describe('Part H — Detail Pages (Bilingual Verification)', () => {

  test('Lead detail page — English', async ({ page }) => {
    // Set English language before any navigation
    await page.addInitScript(() => {
      localStorage.setItem('ibms.languagePreference', 'EN');
    });

    // Mock auth endpoints first
    await mockAuth(page);

    // Mock lead detail endpoint
    await page.route('http://localhost:4000/leads/lead-1', (route) =>
      route.fulfill({ status: 200, json: LEAD_FIXTURE }),
    );

    // Navigate directly to detail page
    await page.goto('http://localhost:3000/leads/lead-1', { waitUntil: 'domcontentloaded' });

    // Wait for h1 to appear
    await page.waitForSelector('h1', { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // Verify page loaded with English text
    await expect(page.locator('h1')).toContainText('Lead Details', { timeout: 5000 });

    // Take screenshot
    await page.screenshot({
      path: 'test-results/part-h-screenshots/lead-en.png',
      fullPage: true,
    });
  });

  test('Lead detail page — Arabic', async ({ page }) => {
    // Set Arabic language before any navigation
    await page.addInitScript(() => {
      localStorage.setItem('ibms.languagePreference', 'AR');
    });

    // Mock auth endpoints
    await mockAuth(page, 'AR');

    // Mock lead detail endpoint
    await page.route('http://localhost:4000/leads/lead-1', (route) =>
      route.fulfill({ status: 200, json: LEAD_FIXTURE }),
    );

    // Navigate directly to detail page
    await page.goto('http://localhost:3000/leads/lead-1', { waitUntil: 'domcontentloaded' });

    // Wait for h1 to appear
    await page.waitForSelector('h1', { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // Verify page loaded with Arabic text
    await expect(page.locator('h1')).toContainText('تفاصيل العميل المرتقب', { timeout: 5000 });

    // Take screenshot
    await page.screenshot({
      path: 'test-results/part-h-screenshots/lead-ar.png',
      fullPage: true,
    });
  });

  test('Policy detail page — English', async ({ page }) => {
    // Set English language before any navigation
    await page.addInitScript(() => {
      localStorage.setItem('ibms.languagePreference', 'EN');
    });

    // Mock auth endpoints
    await mockAuth(page);

    // Mock policy detail endpoint
    await page.route('http://localhost:4000/policies/policy-1', (route) =>
      route.fulfill({ status: 200, json: POLICY_FIXTURE }),
    );

    // Navigate directly to detail page
    await page.goto('http://localhost:3000/policies/policy-1', { waitUntil: 'domcontentloaded' });

    // Wait for h1 to appear
    await page.waitForSelector('h1', { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // Verify page loaded with English text
    await expect(page.locator('h1')).toContainText('Policy Details', { timeout: 5000 });

    // Take screenshot
    await page.screenshot({
      path: 'test-results/part-h-screenshots/policy-en.png',
      fullPage: true,
    });
  });

  test('Policy detail page — Arabic', async ({ page }) => {
    // Set Arabic language before any navigation
    await page.addInitScript(() => {
      localStorage.setItem('ibms.languagePreference', 'AR');
    });

    // Mock auth endpoints
    await mockAuth(page, 'AR');

    // Mock policy detail endpoint
    await page.route('http://localhost:4000/policies/policy-1', (route) =>
      route.fulfill({ status: 200, json: POLICY_FIXTURE }),
    );

    // Navigate directly to detail page
    await page.goto('http://localhost:3000/policies/policy-1', { waitUntil: 'domcontentloaded' });

    // Wait for h1 to appear
    await page.waitForSelector('h1', { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // Verify page loaded with Arabic text
    await expect(page.locator('h1')).toContainText('تفاصيل الوثيقة', { timeout: 5000 });

    // Take screenshot
    await page.screenshot({
      path: 'test-results/part-h-screenshots/policy-ar.png',
      fullPage: true,
    });
  });
});

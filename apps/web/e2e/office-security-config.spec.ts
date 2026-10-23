import { expect, test, type Page } from '@playwright/test';
import { permissionsForRoles } from './fixtures/role-permissions';

/*
 * THE OFFICE'S OWN SESSION AND LOCKOUT POLICY — OWNER DECISION 47, THE READ HALF.
 *
 * Nothing was broken: `SecurityConfig` has a working default for every column, so sessions expire
 * and accounts lock correctly and always have. What an office could not do was ANSWER FOR IT —
 * asked by a CBJ inspector or a PDPL audit "what is your session and lockout policy?", the seven
 * numbers that govern it were readable only with database access. `GET /auth/security-config` and
 * `getSecurityConfig()` both existed and nothing called either.
 *
 * So these tests are about an ANSWERABLE QUESTION, not a new capability.
 */

const ME = {
  id: 'user-1',
  email: 'admin@ibms.test',
  fullName: 'System Security Administrator',
  languagePreference: 'EN',
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

/*
 * The api sends MORE than the seven — `id`, `organizationId`, `updatedByUserId`, `updatedAt` — and
 * the fixture carries them for that reason: a mock that sent only what the screen reads could not
 * catch a screen that started rendering `updatedByUserId`, which is a uuid and would raise the
 * rendered-identifier budget.
 */
const CONFIG = {
  id: 'cfg-1',
  organizationId: 'org-1',
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  accessTokenTtlMinutes: 15,
  refreshTokenTtlDays: 14,
  stepUpMaxAgeMinutes: 10,
  maxFailedLoginAttempts: 5,
  lockoutMinutes: 15,
  updatedByUserId: 'user-9',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

async function mockAuth(page: Page, roles: string[], language = 'EN') {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'fake-access-token' } }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME,
        languagePreference: language,
        roles,
        permissions: permissionsForRoles(roles),
      },
    }),
  );
  // The rest of `/settings/security`, so its other sections do not error over the one under test.
  await page.route('http://localhost:4000/notifications', (route) =>
    route.fulfill({ status: 200, json: { items: [], total: 0 } }),
  );
  await page.route('http://localhost:4000/auth/trusted-devices', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route('http://localhost:4000/security/encryption-keys', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
}

async function mockConfig(page: Page, status = 200) {
  await page.route('http://localhost:4000/auth/security-config', (route) =>
    route.fulfill({
      status,
      json: status === 200 ? CONFIG : { message: 'Could not load it' },
    }),
  );
}

test('renders all seven numbers, each with its unit and the owner’s own explanation', async ({
  page,
}) => {
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await mockConfig(page);

  await page.goto('/settings/security');
  const block = page.getByTestId('office-security-config');
  await expect(block).toBeVisible();

  /*
   * THE UNIT IS PART OF THE VALUE, and that is the owner's instruction — never a bare integer. A
   * bare `15` under "Idle timeout" reads as fifteen of something nobody states, and minutes, hours
   * and days are all plausible.
   */
  await expect(
    block.locator('[data-security-config-value="idleTimeoutMinutes"]'),
  ).toHaveText('15 minutes');
  await expect(
    block.locator('[data-security-config-value="refreshTokenTtlDays"]'),
  ).toHaveText('14 days');
  // The one that is not a duration: a COUNT, whose unit is the thing counted.
  await expect(
    block.locator('[data-security-config-value="maxFailedLoginAttempts"]'),
  ).toHaveText('5 attempts');

  // All seven present, so a field dropped from the map is a failure rather than a quiet gap.
  for (const field of [
    'idleTimeoutMinutes',
    'hardLogoutAfterIdleMinutes',
    'accessTokenTtlMinutes',
    'refreshTokenTtlDays',
    'stepUpMaxAgeMinutes',
    'maxFailedLoginAttempts',
    'lockoutMinutes',
  ]) {
    await expect(
      block.locator(`[data-security-config-field="${field}"]`),
    ).toHaveCount(1);
  }

  // And each number says what it MEANS, which is the half that makes the block answerable.
  await expect(block).toContainText('signed out if they leave the screen');
  await expect(block).toContainText('After this the account is locked');

  /*
   * NO EDIT AFFORDANCE, NOT EVEN A DISABLED ONE — `PUT /auth/security-config` stays unreached by
   * decision 47, and a disabled control is a promise with a date on it. Asserted as an absence
   * INSIDE the block, which is already proven visible above, so this cannot pass vacuously.
   */
  await expect(block.getByRole('button')).toHaveCount(0);
  await expect(block.getByRole('textbox')).toHaveCount(0);
});

test('renders the Arabic labels and the Arabic unit, with noun agreement following the figure', async ({
  page,
}) => {
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR'], 'AR');
  await mockConfig(page);

  await page.goto('/settings/security');
  const block = page.getByTestId('office-security-config');
  await expect(block).toBeVisible();

  // The owner's own label, verbatim.
  await expect(block).toContainText('مدّة الخمول');

  /*
   * ARABIC NOUN AGREEMENT, WHICH IS WHY THE UNIT IS A PLURAL KEY RATHER THAN A WORD. 15 falls in
   * CLDR's `many` (11-99, the singular accusative) and 10 in `few` (3-10, the broken plural), so
   * the two rows take DIFFERENT words for the same unit. A single hard-coded «دقيقة» would be
   * wrong for the step-up row and nobody reading English would ever see it.
   */
  await expect(
    block.locator('[data-security-config-value="idleTimeoutMinutes"]'),
  ).toHaveText('15 دقيقة');
  await expect(
    block.locator('[data-security-config-value="stepUpMaxAgeMinutes"]'),
  ).toHaveText('10 دقائق');
  await expect(
    block.locator('[data-security-config-value="refreshTokenTtlDays"]'),
  ).toHaveText('14 يوماً');
});

test('renders NOTHING for a reader without the code, not a refusal', async ({
  page,
}) => {
  /*
   * The same call `EncryptionKeyInventory` and `ConflictOfInterestRegister` made on this page, and
   * for the recorded reason: explain a refusal WHERE THE READER CAME FOR THE THING REFUSED. A Sales
   * Officer opened this page to pair an authenticator and has no reason to learn that an office
   * security policy exists and is closed to them.
   *
   * THE PAIR IS WHAT MAKES THIS MEANINGFUL: the absence alone would pass against a block nobody
   * ever sees, and the presence test above alone would pass against one everybody sees.
   */
  await mockAuth(page, ['SALES_RELATIONSHIP_OFFICER']);
  await mockConfig(page);

  await page.goto('/settings/security');
  // The anchor: the page rendered its own reason for existing before any absence is asserted.
  await expect(
    page.getByRole('heading', { name: 'Trusted devices' }),
  ).toBeVisible();
  await expect(page.getByTestId('office-security-config')).toHaveCount(0);
});

test('a failed load says what to do about it, rather than rendering a blank policy', async ({
  page,
}) => {
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await mockConfig(page, 500);

  await page.goto('/settings/security');
  const block = page.getByTestId('office-security-config');
  await expect(block).toBeVisible();
  /*
   * The fourth state, and what it asserts is STRUCTURAL rather than textual. A policy block that
   * renders its heading and nothing else is indistinguishable from an office with no policy —
   * which is the one thing this block exists to refute — so the rows must be ABSENT and an alert
   * must be present.
   *
   * It deliberately does NOT assert the wording: decision 90 says a screen renders the SERVER's own
   * sentence when there is one, so what shows here is whatever the api said and not
   * `secCfgLoadError`. That key carries the way forward in both languages and is gated by
   * `load-error-way-forward.py`, which is the layer that claim belongs in — asserting it here
   * would be asserting the mock.
   */
  await expect(block.getByRole('alert')).toBeVisible();
  await expect(
    block.locator('[data-security-config-field="idleTimeoutMinutes"]'),
  ).toHaveCount(0);
});

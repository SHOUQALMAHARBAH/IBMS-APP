import { expect, test, type Page } from '@playwright/test';
import { expectAbsentWithin } from './support/anchored';

/**
 * THE PRESENTER'S PATH: FROM «NOBODY MAY DECLARE» TO THE DECLARATION CONTROL, BY CLICKING.
 *
 * Message 46 §2.2 puts the demo's second office past its licence expiry with the renewal filed
 * and proved, and NO SEEDED ROLE holding `license-renewal.declare` — OWNER DECISION 131, which
 * DECISION 151 ruling 6 extends to the demo data in so many words: «لا يُزرَع دور يحملها».
 *
 * So the demonstration is the grant itself, performed live. What this file proves is the thing a
 * presenter cannot afford to discover in front of an audience: that the path is **continuous** —
 * every control exists, is reachable, and leads to the next one, with no dead end and no step
 * that needs a developer.
 *
 * ## The three steps, and why there are three rather than four
 *
 *   1. `/settings/roles` — create the role AND tick the permission. ONE form: the create form
 *      carries the permission matrix inside it, because (as that screen's own comment puts it)
 *      choosing what a role can do is part of making it, not an errand to be found later.
 *   2. `/settings/users` — grant the new role to the person who will declare.
 *   3. `/regulatory-compliance` — the declaration control is THERE, visible and enabled.
 *
 * ## ⚠️ What this proves and what it does not
 *
 * The API is mocked here, as it is in every Playwright spec in this repo, so this asserts the
 * SCREEN PATH and not that the server accepts the three writes. The server half is
 * `apps/api/test/license-renewal-awaiting-declaration.e2e-spec.ts`, which drives the real routes
 * against a real database and asserts the refusal sentence and that no role holds the code.
 * Neither file is sufficient alone: one proves the path can be walked, the other that walking it
 * does anything.
 *
 * ## And step 3 is gated on BOTH halves, which is why the last assertion is two assertions
 *
 * The control renders only when the caller holds `license-renewal.declare` AND the office is
 * `AWAITING_DECLARATION`. A test that asserted only its presence would pass against a build that
 * had dropped the permission check. So the final step also asserts it is ABSENT for the same
 * office when the caller lacks the code — which is the state the presenter starts in, and the
 * reason there is anything to demonstrate.
 */

const ME_BASE = {
  id: 'user-1',
  email: 'office.admin@ibms.test',
  fullName: 'Office Administrator',
  languagePreference: 'EN',
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

/** The code the whole demonstration turns on. Held by nobody until the presenter grants it. */
const DECLARE_CODE = 'license-renewal.declare';

const NEW_ROLE = {
  id: 'role-renewal-declarer',
  name: 'RENEWAL_DECLARER',
  nameEn: 'Renewal Declarer',
  nameAr: 'مُقِرّ التجديد',
  description: 'May record the standing declaration while the licence is under renewal.',
  status: 'ACTIVE' as const,
  isSystem: false,
  requiresMfaAlways: true,
  requiresHardwareToken: false,
  holderCount: 0,
  permissionCount: 1,
  insuranceLineCategory: null,
  scopeBranchCount: 0,
};

const CATALOGUE = [
  {
    code: DECLARE_CODE,
    module: 'compliance-risk',
    description:
      'Record the standing declaration that the office’s licence is under renewal',
  },
  { code: 'claim.read', module: 'claims', description: 'View a claim' },
];

/**
 * ⚠️ `language` ADDED 2026-11-19 (decision 153 §٢ row ٣), and it has to be here rather than in
 * `localStorage`: `language-context.tsx` treats `/auth/me`'s own `languagePreference` as the
 * source of truth and OVERWRITES the stored key with it on load. A test that set the key and
 * then signed in would be reading whatever the mocked account prefers, which is EN.
 *
 * It defaults to `ME_BASE`'s EN so the four tests above are untouched.
 */
async function mockAuth(
  page: Page,
  permissions: string[],
  language: 'AR' | 'EN' = 'EN',
) {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'fake-access-token' } }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        languagePreference: language,
        roles: ['OFFICE_ADMINISTRATOR'],
        permissions,
      },
    }),
  );
  /*
   * THE BELL, and it is not decoration here.
   *
   * Every authenticated page loads `/notifications`, and an unmocked one is CONNECTION REFUSED ->
   * `items.length` on undefined -> React unmounts -> Chrome's "This page couldn't load". That
   * surfaced as the declaration control being absent when it was the whole PAGE that was absent,
   * which is a broken MOCK reading exactly like a broken SCREEN. Found with a `pageerror`
   * listener rather than by guessing at the component.
   *
   * Envelope copied from `office-security-config.spec.ts`, which already mocks this endpoint.
   */
  await page.route('http://localhost:4000/notifications', (route) =>
    route.fulfill({ status: 200, json: { items: [], total: 0 } }),
  );
}

test('step 1 — the office administrator creates a role and ticks the declaration permission', async ({
  page,
}) => {
  /*
   * ⚠️ `permission.read` IS PART OF THE PATH, AND THE SCREEN SAYS SO ITSELF.
   *
   * Without it the create form renders but its permission matrix does not, replaced by: «The
   * permission matrix cannot be shown — your account does not hold permission.read. You can still
   * create the role, and someone who holds it can set its permissions.» Measured here by getting
   * the fixture wrong, which is the honest way to find a prerequisite.
   *
   * ⛔ Nothing is granted to make this pass: measured in the catalogue, `permission.read` is held
   * by ADMIN and OFFICE_ADMINISTRATOR, so the presenter — the office's own administrator — holds
   * it already. The fixture was short, not the role.
   */
  await mockAuth(page, [
    'role.read',
    'role.create',
    'role.update',
    'permission.read',
  ]);

  await page.route('http://localhost:4000/rbac/roles', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as {
        permissionCodes?: string[];
      };
      // THE GRANT IS IN THE CREATE. Asserted on the wire rather than inferred from the screen:
      // a form that ticks a box and posts without it looks identical to one that works.
      expect(body.permissionCodes).toContain(DECLARE_CODE);
      await route.fulfill({ status: 201, json: NEW_ROLE });
      return;
    }
    await route.fulfill({ status: 200, json: [] });
  });
  await page.route('http://localhost:4000/rbac/permissions', (route) =>
    route.fulfill({ status: 200, json: CATALOGUE }),
  );
  await page.route('http://localhost:4000/insurance-lines', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto('/settings/roles');
  await expect(
    page.getByRole('heading', { name: 'Create a role' }),
  ).toBeVisible();

  await page.locator('[data-create-name-en]').fill('Renewal Declarer');
  await page.locator('[data-create-name-ar]').fill('مُقِرّ التجديد');

  // The machine name is DERIVED and shown before anything is written — the screen's own rule.
  await expect(page.locator('[data-generated-machine-name]')).toHaveText(
    'RENEWAL_DECLARER',
  );

  /*
   * ⚠️ THE MATRIX OPENS COLLAPSED, and that is the screen working as intended: the real catalogue
   * is 234 codes, so the modules are `<details>` and nobody scrolls past a hundred rows to find
   * one. The presenter opens the module, then ticks — so the test does too. A spec that reached
   * straight for the checkbox would be asserting against a screen nobody uses.
   */
  const matrix = page.locator('[data-permission-matrix]').first();
  // SEARCH rather than expand, which is what a presenter does with 234 codes in front of them —
  // and the matrix opens whatever a search matched, by its own rule.
  await matrix.locator('[data-matrix-search]').fill('renewal');
  const declareBox = matrix.locator(`[data-code="${DECLARE_CODE}"]`);
  await expect(declareBox).toBeVisible();
  await declareBox.check();

  await page.getByRole('button', { name: 'Create role' }).click();
  // The POST route above is what asserts the permission travelled; reaching here means it did.
  await expect(page.locator('[data-create-name-en]')).toHaveValue('');
});

test('step 2 — the new role is grantable to a person from the users screen', async ({
  page,
}) => {
  await mockAuth(page, ['user.read', 'user.manage', 'role.read']);

  // ⛔ The envelope shapes below are COPIED from `users.spec.ts`'s own fixtures, not invented.
  // A mock whose shape differs from the endpoint crashes the component it feeds and surfaces as
  // Chrome's "This page couldn't load" — a broken MOCK that reads exactly like a broken SCREEN,
  // which this repository has paid for more than once.
  const PERSON = {
    id: 'user-9',
    fullName: 'Omar Saleh',
    email: 'omar@ibms.test',
    isActive: true,
    mfaEnabled: false,
    languagePreference: 'AR',
    lastLoginAt: null,
    accessValidFrom: null,
    accessValidUntil: null,
    createdAt: '2026-02-02T09:00:00.000Z',
    roles: [],
    employeeId: 'emp-2',
  };

  let granted: { roleId?: string } | null = null;
  await page.route('http://localhost:4000/admin/users**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, json: { users: [PERSON], total: 1 } });
      return;
    }
    if (route.request().url().endsWith('/user-9/roles')) {
      granted = route.request().postDataJSON() as { roleId?: string };
      await route.fulfill({ status: 201, json: {} });
      return;
    }
    await route.fallback();
  });
  await page.route('http://localhost:4000/admin/departments', (route) =>
    route.fulfill({
      status: 200,
      json: [
        { id: 'dept-1', name: 'Claims', nameAr: 'المطالبات', retiredAt: null },
      ],
    }),
  );
  await page.route('http://localhost:4000/admin/branches', (route) =>
    route.fulfill({
      status: 200,
      json: [
        { id: 'branch-1', name: 'Amman', nameAr: 'عمّان', retiredAt: null },
      ],
    }),
  );
  await page.route('http://localhost:4000/employees', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route('http://localhost:4000/rbac/roles', (route) =>
    route.fulfill({ status: 200, json: [NEW_ROLE] }),
  );

  await page.goto('/settings/users');

  // The person starts with NO role at all, which is the state a new office account is in and the
  // reason this step exists. Non-vacuity: if the badge were missing the grant below would be
  // proving nothing about a person who could already declare.
  await expect(page.locator('[data-no-roles]')).toBeVisible();

  const select = page.locator('[data-grant-select="user-9"]');
  await expect(select).toBeVisible();
  await select.selectOption(NEW_ROLE.id);
  await page.getByRole('button', { name: 'Grant' }).first().click();

  await expect
    .poll(() => (granted as { roleId?: string } | null)?.roleId)
    .toBe(NEW_ROLE.id);
});

/*
 * Step 3 is TWO tests, not one with two page loads.
 *
 * The first version reloaded `/regulatory-compliance` inside a single test with a second set of
 * `page.route` handlers over the first. The second load rendered Chrome's error page — the
 * screen had already mounted against the earlier auth payload — so the failure was about the
 * test's own re-entry, not about the product. A fresh page per state has no such question.
 */
function complianceFixtures() {
  /*
   * ⛔ COPIED FROM `regulatory-compliance.spec.ts`'s own `LICENSE`, field for field, with only the
   * dates moved into the past.
   *
   * The first version of this fixture carried five fields and the screen dereferences eleven —
   * `license.renewalDueBy.slice(0, 10)` threw, React unmounted, and Chrome showed "This page
   * couldn't load". That is a broken MOCK that reads exactly like a broken SCREEN, which is why
   * the rule here is to copy a proven fixture rather than shape one from the type.
   */
  const SERIES_AWAITING = {
    current: {
      id: 'b1f0c0de-0000-4000-8000-000000000001',
      licenseNumber: 'CBJ-DEMO-OFFICE-B-2026',
      scopeOfAuthorization: 'General insurance brokerage',
      issuedAt: '2023-01-01T00:00:00.000Z',
      // Past expiry — the state the whole demonstration rests on.
      expiresAt: '2026-10-19T00:00:00.000Z',
      isCurrentlyLapsed: true,
      certificateDocumentId: 'doc-certificate-1',
      // Filed and proved, on time: art. 11's 45 days before 2026-10-19 is 2026-09-04.
      renewalRequestedAt: '2026-08-20T00:00:00.000Z',
      renewalDueBy: '2026-09-04T00:00:00.000Z',
      renewalFiledOnTime: true,
      // FALSE, and that is the point of this screen's own sentence: «قيد التجديد» is not «ساري».
      validPendingRenewalDecision: false,
      expiryIsEndOfCalendarYear: false,
      expectedExpiryForThreeYearTerm: '2025-12-31T00:00:00.000Z',
      expiryMatchesThreeYearTerm: false,
    },
    terms: [],
    standing: {
      status: 'EXPIRED',
      mayPractise: false,
      standingActDecisionRef: null,
      deemedCancelledUnderArticle14C: false,
      renewalUnderStudy: { state: 'AWAITING_DECLARATION' },
    },
    renewalNotice: {
      stage: 'OVERDUE',
      daysToExpiry: -30,
      expiresAt: '2026-10-19T00:00:00.000Z',
      applicationDueBy: '2026-09-04T00:00:00.000Z',
      renewalFiled: true,
    },
  };

  return SERIES_AWAITING;
}

async function openCompliance(
  page: Page,
  permissions: string[],
  language: 'AR' | 'EN' = 'EN',
) {
  await mockAuth(page, permissions, language);
  /*
   * The SCOPE envelope, copied from `regulatory-compliance.spec.ts`'s own `SCOPE`. The first
   * version here was `{ insuranceTypes: [] }` -- a field the endpoint does not have -- so the
   * screen read `.length` off `undefined` and the page unmounted. Same class as the licence
   * fixture above, found the same way.
   */
  await page.route('http://localhost:4000/broker-license/scope', (route) =>
    route.fulfill({
      status: 200,
      json: {
        brokerLicenseId: 'b1f0c0de-0000-4000-8000-000000000001',
        types: ['GENERAL'],
        branches: [],
        branchCountByType: { GENERAL: 0 },
        staffing: {
          requiredApprovedStaff: 1,
          currentApprovedStaff: 0,
          meetsRequirement: false,
        },
        brokerKind: 'CORPORATE',
        capital: {
          requiredCapital: '5000.000',
          paidUpCapital: null,
          shortfall: null,
          meetsRequirement: false,
          capitalIsUnrecorded: true,
        },
      },
    }),
  );
  await page.route('http://localhost:4000/broker-license', (route) =>
    route.fulfill({ status: 200, json: complianceFixtures() }),
  );
  await page.route('http://localhost:4000/insurance-lines', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  // The screen loads its calendar too; without this route it never finishes rendering and every
  // assertion reports "element not found" about a page that simply did not load.
  await page.route('http://localhost:4000/compliance-calendar**', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto('/regulatory-compliance');
}

test('step 3a — BEFORE the grant the office is told why, and there is nothing to press', async ({
  page,
}) => {
  await openCompliance(page, ['license.manage']);
  // Decision 136(ب)'s sentence is shown to a reader who CANNOT declare, so this is not an empty
  // screen — it is a screen that explains itself and has no control on it. That is the state the
  // presenter starts from, and the reason there is anything to demonstrate.
  //
  // 🔴 §T2 — AND «a reader who cannot declare» IS THE WHOLE CONDITION NOW. This caller holds
  // `license.manage` and not the declaration code, which is exactly who the sentence is for;
  // step 3b below asserts the other half, that the holder does NOT meet it.
  await expect(
    page.locator('[data-renewal-awaiting-declaration]'),
  ).toBeVisible();
  await expect(page.locator('[data-renewal-declare]')).toHaveCount(0);
});

test('step 3b — AFTER the grant the declaration control is there, with its oath beside it', async ({
  page,
}) => {
  await openCompliance(page, ['license.manage', DECLARE_CODE]);
  const declare = page.locator('[data-renewal-declare]');
  await expect(declare).toBeVisible();
  await expect(declare).toBeEnabled();
  // ⛔ AND THE OATH IS SHOWN BESIDE IT, never as the button's label — that screen's own rule, and
  // what makes the control a declaration rather than a button somebody pressed.
  await expect(
    page.locator('[data-renewal-declaration-sentence]'),
  ).toBeVisible();

  /*
   * 🔴 §T2 — AND DECISION 136(ب)'s SENTENCE IS GONE FOR THIS READER.
   *
   * It ends «راجع مسؤول النظام في مكتبك», and standing beside the button sends the one person
   * who can end the state to go and ask themselves for the act they are looking at the control
   * for. The owner's second walk reported exactly that.
   *
   * NON-VACUOUS BY ITS ANCHOR: the declaration control above is visible in this same render, so
   * the absence is read off a screen that demonstrably loaded — and step 3a proves the same
   * sentence IS shown to a caller who cannot declare, so this is about the CALLER and not about
   * the sentence having been deleted.
   */
  await expect(
    page.locator('[data-renewal-awaiting-declaration]'),
  ).toHaveCount(0);
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 OWNER DECISION 153 §٢ ROW ٣ — EACH CONTROL CARRIES ITS OWN NAME.
 *
 * Her second walk (§T1): this screen rendered `rcRecordRenewalButton` — «تسجيل تقديم طلب
 * التجديد» — on BOTH the control that FILES the renewal application and the control that
 * records the DECLARATION. Two acts, one name.
 *
 * ## ⚠️ AND THEY CANNOT BOTH BE ON THE SCREEN AT ONCE, WHICH IS MEASURED RATHER THAN ASSUMED
 *
 * The message asks for «both labels on the same screen, each on its own control». They are
 * mutually exclusive by construction, and the product is right:
 *
 *   - the FILING block renders on `canManage && !license.renewalRequestedAt` (`:665`);
 *   - the DECLARATION block renders on `AWAITING_DECLARATION`, which `deriveRenewalUnderStudy`
 *     only ever returns PAST a timely filing — its own comment says so in as many words:
 *     *«`renewalRequestedAt` is non-null here — `renewalFiledOnTime` returned true»*.
 *
 * ⟶ So the strongest TRUE assertion is the one that actually protects the ruling: each label
 *   appears on its own control in its own state, and NEITHER leaks into the other's screen. A
 *   test demanding both at once would need a fixture the product cannot produce, and would be
 *   pinning a state no office is ever in.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

test('decision 153 §٢ row ٣ — the declaration control says «تسجيل الإقرار», and the filing label is nowhere on that screen', async ({
  page,
}) => {
  await openCompliance(page, ['license.manage', DECLARE_CODE], 'AR');

  const declare = page.locator('[data-renewal-declare]');
  await expect(declare).toBeVisible();
  await expect(declare).toHaveText('تسجيل الإقرار');

  // NON-VACUOUS BY ITS ANCHOR: the control above is visible in this same render, so the absence
  // below is read off a screen that demonstrably loaded.
  await expect(page.locator('[data-renewal-file]')).toHaveCount(0);
  await expectAbsentWithin(page.locator('main'), (main) =>
    main.getByText('تسجيل تقديم طلب التجديد', { exact: true }),
  );
});

test('decision 153 §٢ row ٣ — and the FILING control keeps its own label, with no declaration control beside it', async ({
  page,
}) => {
  /*
   * The same proven fixture with ONE field moved: no renewal filed yet. That is the only
   * difference that matters — it is what turns the filing block on and the declaration block
   * off — and moving one field rather than shaping a second fixture from the type is this
   * file's own rule, written after an invented fixture rendered «This page couldn't load» and
   * read exactly like a broken screen.
   */
  await mockAuth(page, ['license.manage', DECLARE_CODE], 'AR');
  await page.route('http://localhost:4000/broker-license/scope', (route) =>
    route.fulfill({
      status: 200,
      json: {
        brokerLicenseId: 'b1f0c0de-0000-4000-8000-000000000001',
        types: ['GENERAL'],
        branches: [],
        branchCountByType: { GENERAL: 0 },
        staffing: {
          requiredApprovedStaff: 1,
          currentApprovedStaff: 0,
          meetsRequirement: false,
        },
        brokerKind: 'CORPORATE',
        capital: {
          requiredCapital: '5000.000',
          paidUpCapital: null,
          shortfall: null,
          meetsRequirement: false,
          capitalIsUnrecorded: true,
        },
      },
    }),
  );
  await page.route('http://localhost:4000/broker-license', (route) => {
    const base = complianceFixtures();
    route.fulfill({
      status: 200,
      json: {
        ...base,
        current: {
          ...base.current,
          renewalRequestedAt: null,
          renewalFiledOnTime: false,
        },
        standing: {
          ...base.standing,
          renewalUnderStudy: { state: 'NO_PROOF' },
        },
      },
    });
  });
  await page.route('http://localhost:4000/insurance-lines', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route('http://localhost:4000/compliance-calendar**', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto('/regulatory-compliance');

  const file = page.locator('[data-renewal-file]');
  await expect(file).toBeVisible();
  await expect(file).toHaveText('تسجيل تقديم طلب التجديد');

  // And the renamed control is not on this screen at all — the rename did not leak sideways.
  await expect(page.locator('[data-renewal-declare]')).toHaveCount(0);
  await expectAbsentWithin(page.locator('main'), (main) =>
    main.getByText('تسجيل الإقرار', { exact: true }),
  );
});

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { permissionsForRoles } from './fixtures/role-permissions';

const ME_BASE = {
  id: 'user-1',
  email: 'dpo@ibms.test',
  fullName: 'Data Protection Officer',
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
      json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) },
    }),
  );
}

const SCHEDULE = [
  {
    id: 'rsi-1',
    recordCategory: 'AuditLogEntry',
    retentionPeriodMonths: 120,
    legalBasis: 'DRAFT, unconfirmed.',
    confirmedByLegalCounselAt: null,
    isConfirmed: false,
  },
];

const HOLDS = [
  {
    id: 'lh-1',
    scope: 'Customer XYZ file — litigation ABC-2026-123',
    reason: 'Active litigation pending discovery.',
    placedAt: '2026-09-01T00:00:00.000Z',
    nextReviewDueAt: '2027-03-01T00:00:00.000Z',
    releasedAt: null,
    retentionScheduleItemId: 'rsi-1',
    customerId: null,
    insuredPersonId: null,
    isActive: true,
  },
  {
    id: 'lh-2',
    scope: 'Litigation hold on a named customer',
    reason: 'Active litigation pending discovery.',
    placedAt: '2026-09-01T00:00:00.000Z',
    nextReviewDueAt: '2027-03-01T00:00:00.000Z',
    releasedAt: null,
    retentionScheduleItemId: null,
    customerId: 'cust-12345678-e2e',
    insuredPersonId: null,
    isActive: true,
  },
];

const BATCHES = [
  {
    id: 'db-1',
    retentionScheduleItemId: 'rsi-1',
    status: 'DPO_APPROVED',
    nominatedByUserId: 'user-2',
    managerApprovedAt: '2026-09-05T00:00:00.000Z',
    dpoApprovedByUserId: 'user-1',
    // The endpoint returns this now. Null here, and the fixture is ALREADY the ordinary case:
    // nominated by user-2 and approved by user-1 — two different people.
    combinedDutyAct: null,
    dpoApprovedAt: '2026-09-06T00:00:00.000Z',
    method: null,
    executedAt: null,
    slaDueAt: '2026-10-06T00:00:00.000Z',
    createdAt: '2026-09-04T00:00:00.000Z',
    hasCertificateOfDestruction: false,
  },
];

async function mockRegister(
  page: Page,
  opts: { scheduleStatus?: number; batches?: unknown[] } = {},
) {
  await page.route('http://localhost:4000/retention-schedule**', (route) => {
    if (opts.scheduleStatus && opts.scheduleStatus !== 200) {
      return route.fulfill({
        status: opts.scheduleStatus,
        json: {
          message:
            'You do not hold a permission required to perform this action',
        },
      });
    }
    return route.fulfill({ status: 200, json: SCHEDULE });
  });
  await page.route('http://localhost:4000/legal-holds**', (route) =>
    route.fulfill({ status: 200, json: HOLDS }),
  );
  await page.route('http://localhost:4000/disposal-batches**', (route) =>
    route.fulfill({ status: 200, json: opts.batches ?? BATCHES }),
  );
}

test('lists the retention schedule, Legal Holds, and disposal batches with their per-row actions', async ({
  page,
}) => {
  await mockAuth(page, ['DATA_PROTECTION_OFFICER']);
  await mockRegister(page);

  await page.goto('/retention-disposal');
  await expect(
    page.getByRole('heading', { name: 'Retention & Disposal' }),
  ).toBeVisible();

  await expect(page.getByRole('cell', { name: 'AuditLogEntry' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible();

  await expect(
    page.getByText('Customer XYZ file', { exact: false }),
  ).toBeVisible();
  // Two Legal Holds are fixtured (one bare, one naming a customer) — each
  // row gets its own Release/Record review pair.
  await expect(
    page.getByRole('button', { name: 'Release' }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Record review' }).first(),
  ).toBeVisible();

  await expect(page.getByRole('cell', { name: 'DPO approved' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Record execution' }),
  ).toBeVisible();
});

test("shows a Legal Hold's named subject and lets a DPO place a new hold naming a customer", async ({
  page,
}) => {
  await mockAuth(page, ['DATA_PROTECTION_OFFICER']);
  await mockRegister(page);

  // The customer is chosen from a FIELD now — one that completes names as you type, not a search box
  // plus a select. So this mocks `GET /customers/search`, a different route from the list, returning a
  // NARROW row: the field needs a name to show and an id to submit, and nothing else.
  await page.route('http://localhost:4000/customers/search**', (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: 'cust-new',
          legalName: 'Al-Ufuq Trading Co.',
          customerType: 'CORPORATE',
          status: 'ACTIVE',
          registrationNumber: 'REG-1001',
          taxRegistrationNumber: null,
        },
      ],
    }),
  );

  await page.goto('/retention-disposal');
  await expect(page.getByText('Customer cust-123…')).toBeVisible();

  let lastCreateBody: Record<string, unknown> | null = null;
  await page.route('http://localhost:4000/legal-holds', (route) => {
    if (route.request().method() === 'POST') {
      lastCreateBody = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      return route.fulfill({
        status: 201,
        json: {
          id: 'lh-3',
          scope: 'New hold',
          reason: 'New reason',
          placedAt: '2026-09-07T00:00:00.000Z',
          nextReviewDueAt: '2027-03-07T00:00:00.000Z',
          releasedAt: null,
          retentionScheduleItemId: null,
          customerId: 'cust-new',
          insuredPersonId: null,
          isActive: true,
        },
      });
    }
    return route.fulfill({ status: 200, json: HOLDS });
  });

  await page.getByLabel('Legal hold scope').fill('New hold');
  await page.getByLabel('Legal hold reason').fill('New reason');
  // Typed, then picked. `selectOption` cannot drive this any more — it is an `<input role="combobox">`
  // rather than a `<select>`, which is the whole of the owner's one-field decision. Three characters is
  // the server-enforced floor, so a shorter term would search nothing.
  await page.getByLabel('Customer (optional)').fill('Al-Ufuq');
  await page.locator('[data-entity-search-option="cust-new"]').click();
  await page.getByRole('button', { name: 'Place hold' }).click();

  await expect.poll(() => lastCreateBody).not.toBeNull();
  expect(lastCreateBody).toMatchObject({
    scope: 'New hold',
    reason: 'New reason',
    customerId: 'cust-new',
  });
});

test('a user without the schedule permission sees the translated 403 message', async ({
  page,
}) => {
  await mockAuth(page, ['PLACEMENT_TECHNICAL_OFFICER']);
  await mockRegister(page, { scheduleStatus: 403 });

  await page.goto('/retention-disposal');
  // The screen's own translated 403 copy, not the API's English message.
  // This page used to pass `err.message` straight through, so the raw
  // server string reached the user in both languages — and this test
  // asserted exactly that. The absence check is what makes it a proof:
  // without it the old behaviour satisfies the new assertion too.
  await expect(
    page.getByText('view the retention and disposal register', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('You do not hold a permission required', { exact: false }),
  ).toHaveCount(0);
});

test('retention-disposal screen has no serious/critical accessibility violations @a11y', async ({
  page,
}) => {
  await mockAuth(page, ['DATA_PROTECTION_OFFICER']);
  await mockRegister(page);

  await page.goto('/retention-disposal');
  await expect(page.getByRole('cell', { name: 'AuditLogEntry' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    ),
  ).toEqual([]);
});

/*
 * THE COMBINED-DUTY ACT ON A DISPOSAL BATCH — Part 4 step 5.
 *
 * `DisposalBatch_maker_checker_distinct` requires that whoever NOMINATES records for destruction is not
 * whoever approves it. **This is the pair that authorises irreversible destruction of personal data** —
 * no undo behind it, and a certificate of destruction issued afterwards — so whether two people agreed
 * is the most load-bearing fact on the row.
 *
 * And the status column reads `DPO_APPROVED` either way, which is why the ordinary-case test asserts
 * that status IS shown beside the absent declaration rather than asserting silence.
 */

/** Nominated AND approved by the same person, with the reason they gave. */
const SELF_APPROVED_BATCH = {
  ...BATCHES[0],
  id: 'db-2',
  dpoApprovedByUserId: 'user-2',
  combinedDutyAct: {
    id: 'cda-db-1',
    at: '2026-09-06T00:00:00.000Z',
    actorUserId: 'user-2',
    reason:
      'Retention period expired and the DPO was the only officer present that week.',
    pair: 'DisposalBatch_maker_checker_distinct',
    roles: ['DATA_PROTECTION_OFFICER'],
    hatAmbiguous: false,
  },
};

test('shows that one person both nominated and approved a disposal batch, and why', async ({
  page,
}) => {
  await mockAuth(page, ['DATA_PROTECTION_OFFICER']);
  await mockRegister(page, { batches: [SELF_APPROVED_BATCH] });
  await page.goto('/retention-disposal');

  const declared = page.getByTestId('combined-duty-disposal-db-2');
  await expect(declared).toContainText('DATA_PROTECTION_OFFICER');
  await expect(declared).toContainText('only officer present');
  // Tied to the database rule it excuses, so the record and the constraint cannot drift apart.
  await expect(declared).toHaveAttribute(
    'data-combined-duty-pair',
    'DisposalBatch_maker_checker_distinct',
  );
});

test('shows DPO approved and declares nothing when two people agreed', async ({
  page,
}) => {
  await mockAuth(page, ['DATA_PROTECTION_OFFICER']);
  await mockRegister(page);
  await page.goto('/retention-disposal');

  // The POSITIVE claim is the anchor: the status cell says DPO approved either way, so asserting
  // silence alone would pass on a cell that had stopped rendering the declaration at all.
  await expect(
    page.getByText('DPO approved', { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByTestId('combined-duty-disposal-db-1')).toHaveCount(0);
});

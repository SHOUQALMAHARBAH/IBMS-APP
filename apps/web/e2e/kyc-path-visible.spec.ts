import { expect, test, type Page } from '@playwright/test';
import { permissionsForRoles } from './fixtures/role-permissions';
import { expectNone } from './support/anchored';

/**
 * THE KYC PATH, MADE FOLLOWABLE — the four defects `docs/kyc-path.md` measured.
 *
 * The owner ran the system herself and could not follow the KYC path on the frontend. Every step worked;
 * the path was invisible. Defects 1 and 2 together left a customer who is NEVER ACTIVATED — work
 * stopped, not work annoyed — which is why they came first.
 *
 *   1. `/customers/[id]` showed the CUSTOMER's status and nothing about the KYC record: no stage, no
 *      link. So the wizard's "submit for review" landed on a page that said nothing about what had just
 *      happened.
 *   3. The queue's nav entry was gated on `customer.360-view.read` rather than on the codes its route
 *      requires — wrong in both directions.
 *   4. A clean screening result rendered NOTHING, so "clean" was inferred from two absences.
 *
 * Defect 2 — the notification keyed on who may ACT rather than on the customer's owner — is asserted in
 * `apps/api/test/notification.e2e-spec.ts`, because it is a server-side count and a mocked bell would be
 * asserting the mock.
 */
const ME_BASE = {
  id: 'user-1',
  email: 'officer@ibms.test',
  fullName: 'Sales Officer',
  languagePreference: 'EN',
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

const CUSTOMER = {
  id: 'cus-1',
  prospectId: null,
  customerType: 'INDIVIDUAL',
  legalName: 'Ahmad Al-Test',
  givenName: 'Ahmad',
  fatherName: null,
  grandfatherName: null,
  familyName: 'Al-Test',
  dateOfBirth: '1980-01-01',
  nationality: 'JO',
  nationalId: '••••1234',
  registrationNumber: null,
  taxRegistrationNumber: null,
  registeredAddress: null,
  natureOfBusiness: null,
  contactPhone: '••••1111',
  contactEmail: '••••@example.test',
  languagePreference: 'AR',
  preferredContactChannel: null,
  status: 'PENDING_KYC',
  source: 'PLATFORM',
  classification: null,
  ownerUserId: 'user-1',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const KYC_RECORD = {
  id: 'kyc-1',
  customerId: 'cus-1',
  status: 'SUBMITTED',
  isEdd: false,
  createdByUserId: 'user-1',
  approvedByUserId: null,
  approvedAt: null,
  submittedAt: '2026-09-02T00:00:00.000Z',
  nextReviewDueAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  // The FULL nested shape, not an approximation. `customerType` was missing in the first version and
  // the row rendered nothing at all — a Playwright mock whose shape differs from the endpoint's crashes
  // the component, and the browser then shows its own error page rather than a React error. Recorded
  // trap; copy the shape from `kyc-queue-duty.spec.ts`, which already mocks this endpoint.
  customer: { legalName: 'Ahmad Al-Test', customerType: 'INDIVIDUAL' },
  combinedDutyAct: null,
};

/**
 * THE SIDEBAR, by its accessible name — never `page.locator('nav').first()`.
 *
 * There are TWO `<nav>` landmarks: this sidebar and the top navbar, each with its own accessible name
 * because they are two landmarks. `.first()` picks whichever is first in the DOM, which is the NAVBAR —
 * and a navbar contains no destination links, so an absence assertion against it PASSES WHATEVER THE
 * GATING DOES. My first version of the defect-3 tests did exactly that: the Executive absence passed
 * vacuously while the Compliance presence failed, which is the only reason the mistake surfaced.
 *
 * The same shape `sidebar-manager.spec.ts` uses, and the same trap § 1.61 records for nav assertions.
 */
function sidebar(page: Page) {
  return page.getByRole('navigation', { name: /^(Primary|التنقّل الرئيسي)$/ });
}

async function openCustomer(
  page: Page,
  roles: string[],
  opts: { records?: unknown[]; kycFails?: boolean } = {},
) {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'token' } }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) },
    }),
  );
  await page.route('http://localhost:4000/customers/cus-1', (route) =>
    route.fulfill({ status: 200, json: CUSTOMER }),
  );
  await page.route('http://localhost:4000/customers/cus-1/ubos', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route('http://localhost:4000/customers/cus-1/documents', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route('http://localhost:4000/kyc-records?**', (route) =>
    opts.kycFails
      ? route.fulfill({ status: 403, json: { message: 'nope' } })
      : route.fulfill({ status: 200, json: opts.records ?? [KYC_RECORD] }),
  );
  await page.route('http://localhost:4000/consent**', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route('http://localhost:4000/privacy-notices**', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto('/customers/cus-1');
}

test('DEFECT 1 — the customer page names the KYC stage and links to the queue', async ({
  page,
}) => {
  // The officer who has just submitted for review is sent to this page. Before this it said
  // "Pending KYC" and nothing else, so the one screen a person opens could not answer "where is it".
  await openCustomer(page, ['SALES_RELATIONSHIP_OFFICER']);

  const stage = page.locator('[data-kyc-stage]');
  await expect(stage).toBeVisible();
  await expect(stage).toHaveAttribute('data-kyc-stage', 'SUBMITTED');
  // The STAGE in words, not the raw enum — an eight-value vocabulary rendered raw is the § 1.45 failure.
  await expect(stage).toContainText('Submitted');
  await expect(stage).not.toContainText('SUBMITTED');
  // And a way to act on it, because the stage without the queue is a dead end.
  await expect(page.locator('[data-kyc-queue-link]')).toBeVisible();
});

test('DEFECT 1 — a decided file shows its stage WITHOUT a queue link', async ({ page }) => {
  // The link is for a file somebody still has to act on. An APPROVED file offering "open the queue"
  // sends a reader to look for work that is finished — the same dead-end click the customer-read split
  // fixed on the list rows.
  await openCustomer(page, ['SALES_RELATIONSHIP_OFFICER'], {
    records: [{ ...KYC_RECORD, status: 'APPROVED' }],
  });

  const stage = page.locator('[data-kyc-stage]');
  await expect(stage).toHaveAttribute('data-kyc-stage', 'APPROVED');
  await expect(stage).toContainText('Approved');
  // Anchored on the stage being visible above, so this cannot pass on a page that rendered nothing.
  await expectNone(page.locator('[data-kyc-queue-link]'), stage);
});

test('DEFECT 1 — a customer with no KYC file SAYS SO, rather than rendering nothing', async ({
  page,
}) => {
  // A real state: a customer imported from a back-book has no file until somebody opens one. Rendering
  // nothing for it would reproduce the defect for exactly those customers.
  await openCustomer(page, ['SALES_RELATIONSHIP_OFFICER'], { records: [] });

  const stage = page.locator('[data-kyc-stage]');
  await expect(stage).toHaveAttribute('data-kyc-stage', 'none');
  await expect(stage).toContainText('No KYC file');
});

test('DEFECT 1 — a reader without the KYC codes still gets the page, and no stage', async ({
  page,
}) => {
  // `GET /kyc-records` requires `kyc.capture` OR `kyc.approve`. A Manager holds the 360 read and
  // neither, so the section is absent — NOT a refusal sentence: the rule is to explain a refusal where
  // the reader came for the thing refused, and a Manager opening a customer file did not come for the
  // KYC stage. What must not happen is the 403 closing the whole screen, which is why the fetch has its
  // own effect.
  await openCustomer(page, ['BRANCH_DEPARTMENT_MANAGER'], { kycFails: true });

  // ANCHORED on the page having loaded: the customer's name and its own status are both there.
  const heading = page.getByRole('heading', { name: 'Ahmad Al-Test' });
  await expect(heading).toBeVisible();
  await expect(page.getByText('Pending KYC', { exact: false })).toBeVisible();
  await expectNone(page.locator('[data-kyc-stage]'), heading);
});

test('DEFECT 3 — the queue nav entry follows the codes its ROUTE requires', async ({ page }) => {
  // Gated on `customer.360-view.read` before this, which is a different code. An Executive holds the
  // 360 read and neither KYC code, so they were offered a nav entry leading to a refusal.
  await openCustomer(page, ['EXECUTIVE_MANAGEMENT'], { kycFails: true });

  const nav = sidebar(page);
  // ANCHORED on a destination this role DOES hold, inside the same sidebar — so the absence below is
  // the gating rather than a nav that never rendered its links. Anchoring on the landmark alone is what
  // made the first version of this test vacuous.
  const anchor = nav.locator('a[href="/customers"]');
  await expect(anchor).toHaveCount(1);
  await expectNone(nav.locator('a[href="/customers/kyc-queue"]'), anchor);
});

test('DEFECT 3 — and a holder of kyc.approve DOES get it', async ({ page }) => {
  // The other direction, which is what stops the fix being "hide it from everybody". Without this the
  // test above would pass on a nav entry that had simply been deleted.
  await openCustomer(page, ['COMPLIANCE_OFFICER']);

  await expect(sidebar(page).locator('a[href="/customers/kyc-queue"]')).toHaveCount(1);
});

/**
 * The KYC queue, for defect 4. Mocked at the hold endpoint because that is what decides what the row
 * says, and the hold is computed server-side from the screening results.
 */
async function openQueue(
  page: Page,
  roles: string[],
  hold: { level: string; reasons?: unknown[]; configurationProblems?: string[] },
) {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'token' } }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) },
    }),
  );
  // BOTH paths, as `kyc-queue-duty.spec.ts` does: the queue calls `/kyc-records` with no query string,
  // and a querystring variant exists for the filtered reads.
  // `SCREENING`, non-EDD. The hold is fetched for DECIDABLE rows only — `(SCREENING && !isEdd) || EDD`
  // — which is exactly the set where the approve/reject controls appear, so it is where a reader needs
  // to know whether anything is holding the file. A `COMPLIANCE_REVIEW` row fetches no hold at all,
  // which is what my first version of these two tests used, and why they found nothing.
  const queue = [{ ...KYC_RECORD, status: 'SCREENING', isEdd: false }];
  await page.route('http://localhost:4000/kyc-records', (route) =>
    route.fulfill({ status: 200, json: queue }),
  );
  await page.route('http://localhost:4000/kyc-records?*', (route) =>
    route.fulfill({ status: 200, json: queue }),
  );
  // The EXACT path, no wildcard: `**/kyc-records**` would also swallow this one, and the row would
  // then render against the queue's own payload. `kyc-queue-duty.spec.ts` records that trap.
  await page.route('http://localhost:4000/kyc-records/kyc-1/screening-hold', (route) =>
    route.fulfill({
      status: 200,
      json: {
        kycRecordId: 'kyc-1',
        level: hold.level,
        releasable: hold.level === 'REVIEW_REQUIRED',
        reasons: hold.reasons ?? [],
        releases: [],
        lastScreenedAt: '2026-09-03T00:00:00.000Z',
        configurationProblems: hold.configurationProblems ?? [],
      },
    }),
  );
  await page.goto('/customers/kyc-queue');
}

test('DEFECT 4 — a clean screening result SAYS so, rather than rendering nothing', async ({
  page,
}) => {
  // `NO_HOLD` rendered nothing, so "clean" was two absences: no badge, and a status that had moved on.
  //
  // The sentence is safe to write only because of a chain worth stating: the built-in provider returns
  // `UNABLE_TO_SCREEN` on an empty table — never `NO_MATCH`, with its own comment that "answering
  // NO_MATCH from an empty table is false assurance" — and that outcome raises `UNRESOLVED_SCREENING`,
  // which is `REVIEW_REQUIRED`. So `NO_HOLD` cannot occur against an empty list. Without that, this
  // would be the forbidden claim.
  await openQueue(page, ['COMPLIANCE_OFFICER'], { level: 'NO_HOLD' });

  const said = page.locator('[data-testid="kyc-no-hold-kyc-1"]');
  await expect(said).toBeVisible();
  await expect(said).toContainText('no matches');
  // And it says WHAT it checked against, so the sentence is not bare reassurance.
  await expect(said).toContainText('populated list');
});

test('DEFECT 4 — a HELD file shows its hold and NOT the clean sentence', async ({ page }) => {
  // The other direction. Without it, a screen that printed "no matches" unconditionally would pass the
  // test above while telling a Compliance Officer a blocked file was clean — which is worse than the
  // silence being fixed.
  await openQueue(page, ['COMPLIANCE_OFFICER'], {
    level: 'BLOCKED',
    reasons: [
      { condition: 'CONFIRMED_SANCTIONS_MATCH', level: 'BLOCKED', detail: 'A reviewer confirmed a match.' },
    ],
  });

  const badge = page.locator('[data-testid="kyc-hold-kyc-1"]');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('data-hold-level', 'BLOCKED');
  // Anchored on the hold badge, so this cannot pass on a row that never rendered.
  await expectNone(page.locator('[data-testid="kyc-no-hold-kyc-1"]'), badge);
});

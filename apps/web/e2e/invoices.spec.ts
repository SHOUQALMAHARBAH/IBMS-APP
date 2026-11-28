import { expect, test, type Page } from '@playwright/test';
import { expectNone } from './support/anchored';
import { permissionsForRoles } from './fixtures/role-permissions';

/*
 * 🔴 THE FINANCE INVOICE SCREEN — DECISION 167/13.
 *
 * ## What it closes
 *
 * Ahmad works in finance. A customer paid JOD 1,100 and he has to record the receipt, then later
 * the remittance. Until this screen the only place to do either was the finance block inside
 * `/opportunities/[id]` — a page finance is refused on, because it needs `opportunity.read`.
 *
 * ⛔ AND FINANCE WAS NOT GIVEN THAT CODE. One of these tests asserts the opportunity page STILL
 * refuses them, naming WHICH refusal — so the fix cannot later be mistaken for a widening.
 *
 * ## The roles here are the REAL seeded ones
 *
 * `permissionsForRoles` resolves the office's actual grid rather than a convenient superset.
 * Measured 2026-11-28 on the live database: `FINANCE_COLLECTIONS_OFFICER` holds
 * `client-accounting.read`, `receipt.record` and `remittance.record`; `EXTERNAL_AUDITOR` holds the
 * read ALONE, which is what makes the gating tests non-vacuous.
 */

const ME_BASE = {
  id: 'user-1',
  email: 'finance@ibms.test',
  fullName: 'Finance Officer',
  languagePreference: 'EN',
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(
  page: Page,
  roles: string[],
  languagePreference: 'AR' | 'EN' = 'EN',
  /**
   * 🔴 AN EXPLICIT PERMISSION SET, FOR THE ONE CASE NO SEEDED ROLE CAN PRODUCE.
   *
   * Measured 2026-11-28 on the live database: `receipt.record` and `remittance.record` are held by
   * `FINANCE_COLLECTIONS_OFFICER` and by nobody else, so NO seeded role holds one without the
   * other — which is exactly why the dead remit control never bit in the demo seed.
   *
   * ⚠️ AND A REAL NEW OFFICE HOLDS NEITHER until it grants them (decision 131), so a custom role
   * with one and not the other is reachable the day an office defines one. ⟶ The set is
   * CONSTRUCTED here and said out loud, which is how message 47 §8 handled the same problem (it
   * assigned two roles rather than inventing one). ⛔ Not used anywhere a seeded role would do.
   */
  permissions?: string[],
) {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'fake-access-token' } }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        roles,
        roleNames: roles.map((r) => ({ ar: r, en: r })),
        languagePreference,
        permissions: permissions ?? permissionsForRoles(roles),
      },
    }),
  );
  await page.route('http://localhost:4000/notifications', (route) =>
    route.fulfill({ status: 200, json: { items: [], total: 0 } }),
  );
}

/*
 * ⚠️ THE FIXTURE CARRIES THE THREE DISPLAY FIELDS THE SERVER RESOLVES, and a row with a genuinely
 * LATIN insurer name beside a DIFFERENT Arabic one — the message-45 §2 lesson: a fixture that puts
 * Arabic in the Latin field makes an Arabic-render assertion pass against a screen that never read
 * the pair.
 */
const INVOICE = {
  id: 'inv-1',
  policyId: 'pol-1',
  customerId: 'cust-1',
  invoiceType: 'new_business_premium',
  premiumAmount: '1100.000',
  taxAmount: '0.000',
  feesAmount: '0.000',
  commissionDeducted: '110.000',
  totalAmount: '1100.000',
  currency: 'JOD',
  dueDate: '2026-12-31T00:00:00.000Z',
  status: 'INVOICED' as const,
  createdAt: '2026-11-01T00:00:00.000Z',
  netRemittance: '990.000',
  receipts: [],
  receipt: null,
  collectedAmount: '0.000',
  outstandingAmount: '1100.000',
  fullyCollected: false,
  remittance: null,
  customerLegalName: 'Nasser Trading Co',
  policyNumber: 'POL-2026-0451',
  insurerId: 'ins-1',
  insurerName: 'Jordan Insurance Co',
  insurerNameAr: 'وادي رم التعاونية',
};

const paged = <T,>(items: T[]) => ({
  items,
  total: items.length,
  page: 0,
  pageSize: 50,
});

async function mockInvoices(
  page: Page,
  invoices: unknown[] = [INVOICE],
  opts: { status?: number } = {},
) {
  await page.route('http://localhost:4000/invoices**', (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: 'no' } });
    }
    return route.fulfill({ status: 200, json: paged(invoices) });
  });
}

test('⛔ the row NAMES its customer, policy and insurer — no uuid is a display value', async ({
  page,
}) => {
  await mockAuth(page, ['FINANCE_COLLECTIONS_OFFICER']);
  await mockInvoices(page);

  await page.goto('/invoices');
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();

  await expect(page.locator('[data-invoice-customer="inv-1"]')).toHaveText(
    'Nasser Trading Co',
  );
  await expect(page.locator('[data-invoice-policy="inv-1"]')).toHaveText(
    'POL-2026-0451',
  );
  await expect(page.locator('[data-invoice-insurer="inv-1"]')).toHaveText(
    'Jordan Insurance Co',
  );

  /*
   * ⛔ AND THE ID IS NOWHERE ON THE PAGE, which is the whole of decision 167/13 and of message B.
   * Asserted over the rendered text rather than cell by cell, because the defect is a uuid
   * appearing ANYWHERE a reader can see it.
   */
  await expect(page.locator('main')).not.toContainText('inv-1');
  await expect(page.locator('main')).not.toContainText('pol-1');
  await expect(page.locator('main')).not.toContainText('cust-1');
});

test('the insurer name reads in ARABIC for an Arabic reader', async ({
  page,
}) => {
  // The pair is resolved on the server and rendered through `insurerDisplayName`. ⚠️ The fixture's
  // Latin and Arabic names are DIFFERENT, so this cannot pass by falling back.
  await mockAuth(page, ['FINANCE_COLLECTIONS_OFFICER'], 'AR');
  await mockInvoices(page);

  await page.goto('/invoices');
  await expect(page.locator('[data-invoice-insurer="inv-1"]')).toHaveText(
    'وادي رم التعاونية',
  );
});

test('a finance officer records a RECEIPT from this screen, with her word on the button', async ({
  page,
}) => {
  await mockAuth(page, ['FINANCE_COLLECTIONS_OFFICER']);
  await mockInvoices(page);
  let body: Record<string, unknown> | null = null;
  await page.route('http://localhost:4000/invoices/inv-1/receipt', (route) => {
    body = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 201, json: INVOICE });
  });

  await page.goto('/invoices');
  await page.getByLabel('Instalment amount').fill('1100.000');
  await page.getByLabel('Payment reference').fill('BANK-77120');
  // HER WORD — «تسجيل قبض» / its English mirror, on the invoice screen.
  await page.getByRole('button', { name: 'Record a receipt' }).click();

  await expect.poll(() => body?.amount).toBe('1100.000');
  // THE REFERENCE IS THE IDEMPOTENCY KEY, so it must reach the server.
  await expect.poll(() => body?.reference).toBe('BANK-77120');
});

test('a finance officer records a REMITTANCE once the invoice is RECONCILED', async ({
  page,
}) => {
  await mockAuth(page, ['FINANCE_COLLECTIONS_OFFICER']);
  await mockInvoices(page, [{ ...INVOICE, status: 'RECONCILED' }]);
  let called = false;
  await page.route(
    'http://localhost:4000/invoices/inv-1/remittance',
    (route) => {
      called = true;
      return route.fulfill({ status: 201, json: INVOICE });
    },
  );

  await page.goto('/invoices');
  await page.getByRole('button', { name: 'Record a remittance' }).click();
  await expect.poll(() => called).toBe(true);
});

test('⛔ each act is gated on its OWN code — the read alone offers neither', async ({
  page,
}) => {
  /*
   * 🔴 THE DEAD CONTROL THIS BATCH FOUND. `FinanceSection` gated the remit button on
   * `receipt.record` while the route requires `remittance.record`, so a holder of one and not the
   * other saw a button that could only 403.
   *
   * `EXTERNAL_AUDITOR` holds `client-accounting.read` and NEITHER write code — measured on the
   * live database — so it is the real seeded role that proves the gating.
   */
  await mockAuth(page, ['EXTERNAL_AUDITOR']);
  await mockInvoices(page, [{ ...INVOICE, status: 'RECONCILED' }]);

  await page.goto('/invoices');
  // The row still RENDERS: the read is what they hold.
  const customer = page.locator('[data-invoice-customer="inv-1"]');
  await expect(customer).toHaveText('Nasser Trading Co');
  // AND NEITHER ACT IS OFFERED. Anchored on the row, which is outside the set asserted absent.
  await expectNone(page.locator('[data-record-receipt="inv-1"]'), customer);
  await expectNone(page.locator('[data-record-remittance="inv-1"]'), customer);
  await expectNone(page.locator('[data-reconcile="inv-1"]'), customer);
});

test('🔴 the REMIT control needs `remittance.record`, not the receipt code', async ({
  page,
}) => {
  /*
   * 🔴 THIS TEST EXISTS BECAUSE A PLANT DID NOT BITE WITHOUT IT.
   *
   * The gating test above uses `EXTERNAL_AUDITOR`, which holds NEITHER write code — so restoring
   * the dead control (gating remit on `receipt.record` again) left it green. A plant that fails to
   * bite reads exactly like a guard that works, which is the recorded lesson from message 49 §26
   * and message 51 §20.
   *
   * ⟶ So the distinguishing case is a reader holding `receipt.record` and NOT
   *   `remittance.record`. No seeded role is in that state (see `mockAuth`), so the set is
   *   constructed — and a custom office role can be in it the day an office defines one.
   */
  await mockAuth(page, ['FINANCE_COLLECTIONS_OFFICER'], 'EN', [
    'client-accounting.read',
    'receipt.record',
    // ⛔ `remittance.record` DELIBERATELY ABSENT — that is the whole subject.
  ]);
  await mockInvoices(page, [{ ...INVOICE, status: 'RECONCILED' }]);

  await page.goto('/invoices');
  const customer = page.locator('[data-invoice-customer=\"inv-1\"]');
  await expect(customer).toHaveText('Nasser Trading Co');

  // ⛔ NO REMIT BUTTON. Gated on the receipt code it would render here and 403 on press.
  await expectNone(page.locator('[data-record-remittance=\"inv-1\"]'), customer);
});

test('… and the SAME reader still gets the receipt control, so the test above is not vacuous', async ({
  page,
}) => {
  /*
   * NON-VACUITY, and it is the half that matters: a screen that rendered NO controls at all would
   * satisfy the absence above. This proves the reader is enabled for the act they DO hold — so the
   * absence is about the code and not about the screen being broken.
   */
  await mockAuth(page, ['FINANCE_COLLECTIONS_OFFICER'], 'EN', [
    'client-accounting.read',
    'receipt.record',
  ]);
  await mockInvoices(page);

  await page.goto('/invoices');
  await expect(page.locator('[data-record-receipt=\"inv-1\"]')).toBeVisible();
});

test('the sidebar offers Invoices to finance, and hides it without the read', async ({
  page,
}) => {
  await mockAuth(page, ['FINANCE_COLLECTIONS_OFFICER']);
  await mockInvoices(page);
  await page.goto('/invoices');
  await expect(
    page.getByRole('link', { name: 'Invoices', exact: true }),
  ).toBeVisible();

  // A role with no `client-accounting.read` never sees the entry — the control does not exist on
  // their screen rather than being rendered and then refused. BY HREF, because the group holding
  // the current route is the only one expanded.
  await page.unroute('**/auth/me');
  await mockAuth(page, ['CLAIMS_OFFICER']);
  await page.goto('/claims');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expectNone(nav.locator('a[href="/invoices"]'), nav);
});

test('⛔ and the opportunity page STILL refuses finance — no code was granted', async ({
  page,
}) => {
  /*
   * 🔴 THE HALF THAT PROVES THE FIX WAS NOT A WIDENING. Decision 167/13's own words: «بلا فتح
   * الفرص» — without opening the opportunities. The standing rule is that no role is granted a
   * permission code to make a screen work, so finance must still be refused here.
   *
   * ⚠️ AND IT ASSERTS WHICH REFUSAL, not merely that something went wrong: the sentence must name
   * the permission the reader lacks, or a 500 would satisfy this test.
   */
  await mockAuth(page, ['FINANCE_COLLECTIONS_OFFICER']);
  /*
   * ⚠️ THE 403 IS MOCKED, because without it the screen shows its generic load error and this
   * test would pass against a network failure rather than against a refusal. My first version did
   * exactly that — it asserted the sentence named `opportunity.read`, and the screen never says
   * that; it answered «Could not load this opportunity — try again.»
   */
  await page.route('http://localhost:4000/opportunities/opp-1', (route) =>
    route.fulfill({ status: 403, json: { message: 'forbidden' } }),
  );
  await page.goto('/opportunities/opp-1');

  /*
   * ⚠️ AND THE REFUSAL IS `oppDetailNotFound`, WHICH THIS SCREEN DELIBERATELY SHOWS FOR BOTH 403
   * AND 404 — «it may not exist, or you may not have access to it». ⟶ So «which refusal» here is
   * that sentence and not a named code: the screen does not name `opportunity.read`, and asserting
   * a code it never prints is what my first version got wrong.
   */
  await expect(page.locator('main [role="alert"]')).toContainText(
    'you may not have access to it',
  );
  // ⛔ AND THE FINANCE BLOCK IS NOT THERE, which is the half that proves nothing was opened up.
  await expectNone(
    page.locator('[data-collection-form="inv-1"]'),
    page.locator('main [role="alert"]'),
  );
});

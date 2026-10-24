import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { permissionsForRoles } from './fixtures/role-permissions';
import { anchoredTexts, expectAbsentWithin } from './support/anchored';

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
    // No decided floor governs this category, which is why it ships with the number it has.
    floor: null,
  },
  /*
   * MODULE 0-ب — A FLOORED CATEGORY AS THE TEMPLATE SHIPS IT: no period, and the floor on the wire
   * so the screen can show the ARTICLE and the MINIMUM where the number would be.
   *
   * Shaped from the endpoint rather than approximated — these interfaces are hand-copied over HTTP
   * and nothing checks them against the view, which is how a result panel once threw during render.
   */
  {
    id: 'rsi-2',
    recordCategory: 'KYCRecord',
    retentionPeriodMonths: null,
    legalBasis: 'A STATUTORY FLOOR GOVERNS THIS CATEGORY, so no period ships.',
    confirmedByLegalCounselAt: null,
    isConfirmed: false,
    floor: {
      instrument:
        'Anti-Money Laundering and Counter-Terrorism Financing Law No. 20 of 2021',
      article: 'art. 17/a (المادة ١٧/أ)',
      operativeText:
        'customer due-diligence records and account files must be kept for at least five years',
      floorMonths: 60,
    },
  },
];

const NOTICES = [
  {
    recordCategory: 'CommissionLedgerEntry',
    retentionPeriodMonths: 120,
    // MODULE 0-ب: `actionable` is a DIFFERENT question from `resolvable` — this category can
    // never produce a notice vs it cannot produce one YET. Both are on the wire.
    actionable: true,
    inertReason: null,
    resolvable: true,
    unresolvableReason: null,
    elapsedCount: 3,
    elapsedRecordIds: ['cle-1', 'cle-2', 'cle-3'],
    heldCount: 0,
    extendedCount: 0,
    floor: {
      instrument: 'Commercial Law No. 12 of 1966',
      article: 'art. 19 (المادة ١٩)',
      operativeText: 'financial and commercial records must be kept for ten years',
    },
    countedFrom: 'the date the commission was paid, which closes that transaction',
    noLegalHoldStatement: 'No legal hold stands on any of these records.',
  },
  {
    // THE ROW THAT SAYS SO. An office that set a period for a category it named itself and is never
    // alerted will believe the system is watching it — decision 28's family, and the reason this
    // fixture carries an unresolvable row rather than only a happy one.
    recordCategory: 'AuditLogEntry',
    retentionPeriodMonths: 120,
    // MODULE 0-ب: `actionable` is a DIFFERENT question from `resolvable` — this category can
    // never produce a notice vs it cannot produce one YET. Both are on the wire.
    actionable: true,
    inertReason: null,
    resolvable: false,
    unresolvableReason:
      'This system has not been told which records this category name means, so it cannot count them and will never raise a notice for it. The period you set is recorded and the statutory floor still applies to it — but nothing here is watching the clock.',
    elapsedCount: 0,
    elapsedRecordIds: [],
    heldCount: 0,
    extendedCount: 0,
    floor: null,
    countedFrom: null,
    noLegalHoldStatement:
      'No records are counted for this category, so no legal hold has been checked.',
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
    // A hold that names NO customer — a real state (`hasAtMostOneSubjectReference` allows neither),
    // so the api sends no name and the cell falls back to its em dash.
    customerName: null,
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
    // Batch six item 2 — the api resolves the name now, so the Subject column renders this rather
    // than eight characters of a uuid.
    customerName: 'شركة اليرموك للتأمين',
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
  opts: {
    scheduleStatus?: number;
    holdsStatus?: number;
    batchesStatus?: number;
    batches?: unknown[];
    noticesStatus?: number;
    notices?: unknown[];
    retrievalsStatus?: number;
    retrievals?: unknown[];
    extensionsStatus?: number;
    extensions?: unknown[];
    basesStatus?: number;
    bases?: unknown[];
  } = {},
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
  const RETRIEVALS = [
    {
      id: 'retrieval-1',
      recordCategory: 'CommissionLedgerEntry',
      recordId: 'entry-1',
      basis: 'JUDICIAL_REQUEST',
      note: 'Amman Court of First Instance, case 123 of 2026.',
      retrievedAt: '2026-10-21T08:00:00.000Z',
      retrievedByUserId: 'u-1',
      retrievedByName: 'Compliance Officer',
    },
  ];
  /*
   * THE EXTENSION REGISTER — owner decision 43. One row per `RetentionExtension`, which is NOT the
   * notice list: an extended record leaves the notices by design, so this is the only place the
   * extension itself is readable.
   */
  const EXTENSIONS = [
    {
      id: 'ext-1',
      recordCategory: 'Receipt',
      recordId: 'receipt-7',
      extendedUntil: '2029-03-31T00:00:00.000Z',
      basis: 'LEGAL_HOLD_OR_DISPUTE',
      note: 'Held pending the Amman dispute, file 404 of 2026.',
      legislativeInstrument: null,
      legislativeArticle: null,
      legalHold: {
        id: 'hold-9',
        scope: 'Customer file — Al-Yarmouk',
        reason: 'Litigation reasonably in prospect',
      },
      consentRecordId: null,
      consentDuration: null,
      consentPurpose: null,
      extendedByUserId: 'u-1',
      extendedByName: 'Compliance Officer',
      extendedAt: '2026-10-22T09:00:00.000Z',
      /*
       * WHICH RECORD — owner decision 44. A `Receipt`, so the handle is the client's own bank
       * reference and the state is RECORDED. The other three states are proven in
       * `retention-resolution.config.spec.ts`, where the input can be chosen: two of them are
       * states no fixture can reach (a record destroyed under a surviving extension row, and a
       * category whose records cannot be named and therefore has nothing to show a value for).
       */
      recordHandle: {
        state: 'RECORDED',
        value: 'BANK-TRF-8812',
        description: 'the client payment, bank or voucher reference',
      },
    },
  ];
  /*
   * WHICH BASES EXIST, from the route rather than from the screen. The default is the real FOUR
   * since owner decision 45; a test that wants a fifth passes its own list, which is the whole
   * point of reading it.
   *
   * `meaning` IS GONE FROM THE ROW, and removing it here in the same commit is the rule rather than
   * tidiness: a fixture that keeps supplying a field the api has stopped sending is green against a
   * shape that no longer exists, which is exactly what hid the customer-import crash for three
   * weeks. The meanings are the owner's Arabic and live in the i18n tree.
   */
  const BASES = [
    { basis: 'JUDICIAL_REQUEST' },
    { basis: 'CBJ_AUDIT' },
    { basis: 'AMLU_REQUEST' },
    { basis: 'OTHER' },
  ];
  const REFUSED = {
    message: 'You do not hold a permission required to perform this action',
  };
  await page.route('http://localhost:4000/legal-holds**', (route) =>
    opts.holdsStatus && opts.holdsStatus !== 200
      ? route.fulfill({ status: opts.holdsStatus, json: REFUSED })
      : route.fulfill({ status: 200, json: HOLDS }),
  );
  await page.route('http://localhost:4000/retention-notices**', (route) =>
    opts.noticesStatus && opts.noticesStatus !== 200
      ? route.fulfill({ status: opts.noticesStatus, json: REFUSED })
      : route.fulfill({ status: 200, json: opts.notices ?? NOTICES }),
  );
  await page.route(
    'http://localhost:4000/retention-archive/retrievals**',
    (route) =>
      opts.retrievalsStatus && opts.retrievalsStatus !== 200
        ? route.fulfill({ status: opts.retrievalsStatus, json: REFUSED })
        : route.fulfill({ status: 200, json: opts.retrievals ?? RETRIEVALS }),
  );
  await page.route('http://localhost:4000/disposal-batches**', (route) =>
    opts.batchesStatus && opts.batchesStatus !== 200
      ? route.fulfill({ status: opts.batchesStatus, json: REFUSED })
      : route.fulfill({ status: 200, json: opts.batches ?? BATCHES }),
  );
  /*
   * REGISTERED LAST, AND THAT IS LOAD-BEARING. `/retention-notices**` above also matches
   * `/retention-notices/register`, and Playwright gives precedence to the handler registered LAST
   * — so this must come after it or the register read would be served the notice array, which
   * would render as a table of undefined cells rather than failing.
   */
  await page.route('http://localhost:4000/retention-notices/register**', (route) =>
    opts.extensionsStatus && opts.extensionsStatus !== 200
      ? route.fulfill({ status: opts.extensionsStatus, json: REFUSED })
      : route.fulfill({ status: 200, json: opts.extensions ?? EXTENSIONS }),
  );
  await page.route('http://localhost:4000/retention-archive/bases**', (route) =>
    opts.basesStatus && opts.basesStatus !== 200
      ? route.fulfill({ status: opts.basesStatus, json: REFUSED })
      : route.fulfill({ status: 200, json: opts.bases ?? BASES }),
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

  // SCOPED to the schedule table: the notice table added by batch 5 group 7b also names this
  // category, so a page-wide cell query is a strict-mode violation. Scoping is the fix; loosening
  // the assertion would let it pass against the wrong element.
  await expect(
    page
      .getByTestId('retention-schedule-table')
      .getByRole('cell', { name: 'AuditLogEntry' }),
  ).toBeVisible();
  /*
   * SCOPED TO ITS OWN ROW, because module 0-ب's categories batch added a SECOND unconfirmed row to
   * this fixture (a floored category shipping with no period) and `getByRole` then resolved to two
   * buttons — a strict-mode violation.
   *
   * Scoped at the cause rather than weakened with `.first()`: a `.first()` here would keep passing
   * if the row it is about lost its button and a different row kept one.
   */
  await expect(
    page
      .getByTestId('retention-schedule-table')
      .getByRole('row', { name: /AuditLogEntry/ })
      .getByRole('button', { name: 'Confirm' }),
  ).toBeVisible();

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
  /*
   * RE-POINTED 2026-10-23 (batch six item 2) WITH THE REVERSAL STATED. This asserted
   * `Customer cust-123…` — the uuid rendering — which was correct until the api started resolving
   * the hold's customer by name. The property the test is about is unchanged and is in its own
   * title: a hold shows WHOSE records it freezes. What changed is that the answer is now a name.
   *
   * Both halves, because a screen that rendered the id BESIDE the name would pass a name-only
   * assertion: the name is present AND the uuid is gone.
   */
  await expect(
    page.getByRole('cell', { name: 'شركة اليرموك للتأمين', exact: true }).first(),
  ).toBeVisible();
  // On the CELL rather than page-wide — `check:absence` bans the page-wide `getByText` shape, and
  // `exact: true` additionally fails on a name with the old `Customer ` prefix still attached.
  await expect(page.getByRole('cell', { name: /cust-12345678-e2e/ })).toHaveCount(0);

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
          customerName: 'Al-Ufuq Trading Co.',
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

test('a user holding NONE of the three permissions sees the translated 403 message', async ({
  page,
}) => {
  await mockAuth(page, ['PLACEMENT_TECHNICAL_OFFICER']);
  // ITEM 8 — all three, which is what this reader really gets. The three panels sit behind THREE
  // different codes, so refusing one is a genuine partial state (the test below) and the all-of
  // refusal belongs to the reader who holds none of them. This test used to refuse the schedule
  // alone and still expect the three-code sentence, because `Promise.all` made one refusal look
  // like three.
  await mockRegister(page, {
    scheduleStatus: 403,
    holdsStatus: 403,
    batchesStatus: 403,
    // FOUR panels now, so the all-of sentence needs the fourth refusal too — otherwise this test
    // would assert a message the screen can no longer reach.
    noticesStatus: 403,
  });

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

test('OWNER DECISION 43 — a reader holding none of the three acts gets no extension register', async ({
  page,
}) => {
  /*
   * The register is gated on the notice's own ANY-OF, so the reader who is refused all three acts
   * sees no section at all rather than a refusal sentence — the frontend directive's rule, and the
   * same treatment the retrieval section gets one code over.
   *
   * THE ANCHOR IS THE REFUSAL ITSELF, from the same render: without something positive asserted
   * first, `toHaveCount(0)` passes on its first poll against a page that has not hydrated.
   */
  await mockAuth(page, ['SALES_RELATIONSHIP_OFFICER']);
  await mockRegister(page, {
    scheduleStatus: 403,
    holdsStatus: 403,
    batchesStatus: 403,
    noticesStatus: 403,
  });

  await page.goto('/retention-disposal');
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'You do not hold',
  );
  await expect(
    page.getByTestId('retention-extension-section'),
  ).toHaveCount(0);
});

test('ITEM 8 — one refused panel is NAMED and the other two still render', async ({
  page,
}) => {
  await mockAuth(page, ['DATA_PROTECTION_OFFICER']);
  // Only the schedule refuses. This is the case the old shape got wrong: a reader holding
  // `legal-hold.manage` saw an empty screen and a sentence listing three codes, two of which
  // they held.
  await mockRegister(page, { scheduleStatus: 403 });

  await page.goto('/retention-disposal');
  // Scoped to `main`: Next renders its own empty `role="alert"` route announcer, and a page-wide
  // `.first()` matches THAT — the trap IMPROVEMENTS § 1.85 records.
  const alert = page.locator('main p[role="alert"]');
  await expect(alert).toContainText('the retention schedule');
  // The non-vacuity half: a panel the reader DOES hold is on screen.
  await expect(page.getByRole('heading', { name: 'Legal holds' })).toBeVisible();
  // NOT the all-of refusal: naming three codes to somebody who holds two of them sends them to
  // ask for grants they already have.
  await expect(
    page.getByText('view the retention and disposal register', {
      exact: false,
    }),
  ).toHaveCount(0);
});

test('retention-disposal screen has no serious/critical accessibility violations @a11y', async ({
  page,
}) => {
  await mockAuth(page, ['DATA_PROTECTION_OFFICER']);
  await mockRegister(page);

  await page.goto('/retention-disposal');
  // SCOPED to the schedule table: the notice table added by batch 5 group 7b also names this
  // category, so a page-wide cell query is a strict-mode violation. Scoping is the fix; loosening
  // the assertion would let it pass against the wrong element.
  await expect(
    page
      .getByTestId('retention-schedule-table')
      .getByRole('cell', { name: 'AuditLogEntry' }),
  ).toBeVisible();
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

test('THE SILENT CASE — the office is shown the notice before the save, the tick is not pre-ticked, and the sentence it saw is what gets sent', async ({
  page,
}) => {
  /*
   * Batch 5 group 6. A category this system knows no statutory minimum for is ACCEPTED, and the
   * office declares why. The screen holds no copy of the floor list, deliberately — it attempts the
   * save, and the SERVER answers `NO_FLOOR_DECLARATION_REQUIRED`.
   */
  await mockAuth(page, ['DATA_PROTECTION_OFFICER']);
  await mockRegister(page);

  const bodies: Array<Record<string, unknown>> = [];
  let asked = false;
  await page.route('http://localhost:4000/retention-schedule', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    if (!asked) {
      asked = true;
      return route.fulfill({
        status: 422,
        json: {
          code: 'NO_FLOOR_DECLARATION_REQUIRED',
          message:
            'This system does not know a statutory minimum for a record category named "Customer".',
          reasonMinLength: 10,
        },
      });
    }
    return route.fulfill({ status: 201, json: { id: 'rsi-new' } });
  });

  await page.goto('/retention-disposal');
  // BY ROLE, not by label: these inputs carry BOTH a wrapping <label> and an `aria-label`, so
  // `getByLabel` resolves two matches and Playwright refuses in strict mode. A role query dedupes
  // them, where a `.first()` would weaken the locator to make the ambiguity go away.
  // `exact: true`, because `getByRole(name)` matches case-insensitive SUBSTRINGS — recorded in
  // CLAUDE.md — and "Record category" is a substring of this screen's "Legal hold record category
  // ID". Two inputs, one query, strict-mode refusal.
  await page
    .getByRole('textbox', { name: 'Record category', exact: true })
    .fill('Customer');
  await page
    .getByRole('spinbutton', { name: 'Retention period (months)' })
    .fill('6');
  await page.getByRole('button', { name: 'Add category' }).click();

  // ---------------------------------------------- THE NOTICE IS SHOWN, before anything is saved
  const block = page.getByTestId('retention-no-floor-declaration');
  await expect(block).toBeVisible();
  const notice = page.getByTestId('retention-no-floor-notice');
  // The clause that carries the whole point: the SYSTEM does not know a minimum. It must never say
  // the LAW sets none — and the sentence says both halves out loud.
  await expect(notice).toContainText('does not know a statutory minimum');
  await expect(notice).toContainText('does not mean the law sets none');
  // BOTH known floors, by instrument and article. The naming IS the mechanism: it is how somebody
  // saving due-diligence records under another name recognises what they are doing.
  await expect(notice).toContainText('No. 20 of 2021');
  await expect(notice).toContainText('art. 17/a');
  await expect(notice).toContainText('No. 12 of 1966');
  await expect(notice).toContainText('art. 19');

  // ---------------------------------------------- THE TICK IS AN ACT, NOT A FIELD
  const tick = block.getByRole('checkbox');
  await expect(tick).not.toBeChecked();
  const save = block.getByRole('button', {
    name: 'Save with this declaration',
  });
  await expect(save).toBeDisabled();

  // A ticked box with a SHORT reason is still refused by the screen, so it never sends a request it
  // knows the server will refuse. Nine characters, not zero — zero cannot tell a ten-character
  // floor from a non-empty check.
  await tick.check();
  const reasonBox = block.getByRole('textbox', {
    name: 'Why you chose this period',
  });
  await reasonBox.fill('too short');
  await expect(save).toBeDisabled();
  await expect(block).toContainText('at least ten characters');

  // ---------------------------------------------- AND THE SENTENCE IT SAW IS WHAT GETS SENT
  const reason = 'No statute identified for this category; reviewed with counsel.';
  await reasonBox.fill(reason);
  await expect(save).toBeEnabled();
  /*
   * CAPTURED BEFORE THE CLICK. A successful save clears the ask and the block unmounts, so reading
   * the notice afterwards times out — which is how I learned the screen tidies up properly. The
   * comparison below is still against the RENDERED text, which is the point: it proves the sent
   * sentence is the one the office actually saw.
   */
  const rendered = ((await notice.textContent()) ?? '').trim();
  await save.click();

  await expect.poll(() => bodies.length).toBe(2);
  const declared = bodies[1].noFloorDeclaration as {
    noticeShown: string;
    reason: string;
    acknowledged: boolean;
  };
  expect(declared.reason).toBe(reason);
  expect(declared.acknowledged).toBe(true);
  // VERBATIM AS RENDERED — read off the real request body against the real rendered text, because
  // the record exists to say what the office SAW, and a sentence re-derived at submit answers a
  // different question.
  expect(declared.noticeShown).toBe(rendered);
  // The first attempt carried none, which is what made the server ask.
  expect(bodies[0].noFloorDeclaration).toBeUndefined();
});

test('BATCH 5 GROUP 7b — the notice explains itself, an unwatched category says so, and consent is offered-but-disabled with its reason', async ({
  page,
}) => {
  /*
   * Three things only a browser can see, and each is a claim the brief makes explicitly.
   */
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegister(page);
  await page.goto('/retention-disposal');

  // ---------------------------------------------- IT EXPLAINS ITSELF
  const resolved = page.locator('[data-notice-for="CommissionLedgerEntry"]');
  await expect(resolved).toBeVisible();
  // The article, the instrument and the operative text — the same ones the refusal cites.
  await expect(resolved).toContainText('Commercial Law No. 12 of 1966');
  await expect(resolved).toContainText('art. 19');
  await expect(resolved).toContainText('ten years');
  // What the count ran from, in words rather than as a column name.
  await expect(resolved).toContainText('the date the commission was paid');
  // And that no hold stands, stated rather than implied.
  await expect(resolved).toContainText('No legal hold stands');
  await expect(resolved).toContainText('3');

  // ---------------------------------------------- THE UNWATCHED CATEGORY SAYS SO, ON ITS OWN ROW
  /*
   * Decision 28's family: silence here is the defect. Asserted on the ROW rather than page-wide,
   * because a page-wide text assertion is the one shape that can match an unrelated element — the
   * trap this repo has paid for four times.
   */
  const unwatched = page.getByTestId('retention-unwatched-AuditLogEntry');
  await expect(unwatched).toBeVisible();
  await expect(unwatched).toContainText('has not been told');
  await expect(unwatched).toContainText('nothing here is watching the clock');

  // ---------------------------------------------- THE BACKUP LIMIT, where destruction is offered
  const backup = page.getByTestId('retention-backup-limit');
  await expect(backup).toBeVisible();
  await expect(backup).toContainText('not destruction while a backup holds');

  // ---------------------------------------------- EXTEND: THE TICKLESS FORM AND THE DEAD OPTION
  await resolved.getByRole('button', { name: 'Extend' }).click();
  const form = page.getByTestId('retention-extend-form');
  await expect(form).toBeVisible();

  // CONSENT IS PRESENT AND DISABLED, with its reason. Removing it silently would leave a reader
  // wondering whether consent is a basis at all — a worse confusion than being told why not.
  const consentOption = form.locator('option[value="CUSTOMER_EXPLICIT_CONSENT"]');
  // `toBeDisabled` does not apply to an <option>; the attribute is what the markup carries.
  await expect(consentOption).toHaveAttribute('disabled', '');
  await expect(page.getByTestId('retention-consent-unavailable')).toContainText(
    'no duration',
  );

  // The submit stays disabled until the note reaches the shared ten-character minimum, so the
  // screen never sends a request it already knows the server will refuse. Nine characters, not
  // zero — zero cannot tell a floor from a non-empty check.
  const submit = form.getByRole('button', { name: 'Record the extension' });
  await expect(submit).toBeDisabled();
  await form.getByRole('spinbutton', { name: 'Extend by (months)' }).fill('24');
  await form
    .getByRole('textbox', { name: 'What the office is actually relying on' })
    .fill('too short');
  await expect(submit).toBeDisabled();
  await form
    .getByRole('textbox', { name: 'What the office is actually relying on' })
    .fill('Retained for the pending examination of the commission file.');
  await expect(submit).toBeEnabled();
});

test('BATCH 5 GROUP 7c — the blocked phase is explained where the notice is read, and the scoping limit says the customer file cannot enter it', async ({
  page,
}) => {
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegister(page);

  await page.goto('/retention-disposal');

  // ---------------------------------------------- THE FOUR CONDITIONS, ON THE SCREEN
  // Scoped to the paragraph's own hook, never page-wide: a page-wide text assertion is the one
  // shape that can match an unrelated element, which this repository has paid for four times.
  // ---------------------------------------------- TWO CHOICES, NOT THREE, SAID OUT LOUD
  /*
   * The owner's accepted consequence of anonymisation being held. Asserted because the quiet
   * failure mode is a reader who sees only an Extend button and assumes the third choice lives
   * somewhere else on the screen — and because a product that lists an act it cannot perform is
   * the claim family this module spent a week removing.
   */
  const two = page.getByTestId('retention-two-choices');
  await expect(two).toBeVisible();
  await expect(two).toContainText('TWO choices here, not three');
  await expect(two).toContainText('NOT available in this system');
  // AND IT SAYS WHAT IS LEFT, rather than only what is missing.
  await expect(two).toContainText('the only route after a period elapses is destruction');

  const what = page.getByTestId('retention-blocked-what');
  await expect(what).toBeVisible();
  await expect(what).toContainText('no ongoing processing');
  await expect(what).toContainText('not visible to ordinary employees');
  await expect(what).toContainText('judicial request');
  await expect(what).toContainText('Central Bank of Jordan');
  await expect(what).toContainText('erasure is refused in this phase even if the customer asks');

  // ---------------------------------------------- THE SCOPING LIMIT, STATED NOT IMPLIED
  /*
   * The brief's own instruction: "This state applies only to categories in the resolution table.
   * For the rest, say so rather than implying a protection that is not running." The customer file
   * is the one that matters, because the adviser's conditions read as being about personal data and
   * it is exactly the category whose clock this system cannot measure.
   */
  const limit = page.getByTestId('retention-blocked-scope-limit');
  await expect(limit).toBeVisible();
  await expect(limit).toContainText('customer file');
  await expect(limit).toContainText('no date for a relationship ending');
  // AND IT MUST NOT CLAIM THE PROTECTION IS RUNNING FOR THEM.
  await expect(limit).toContainText('never described as blocked');
});

test('BATCH 5 GROUP 7c — the retrieval section is offered on its own code, takes a closed basis and a note, and shows the append-only register', async ({
  page,
}) => {
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegister(page);

  await page.goto('/retention-disposal');

  const section = page.getByTestId('retention-retrieve-section');
  await expect(section).toBeVisible();
  await expect(section).toContainText('cannot be edited or deleted once written');

  /*
   * A CLOSED FOUR SINCE OWNER DECISION 45 — AND THE REVERSAL IS STATED RATHER THAN RENUMBERED.
   * This block used to read *"A CLOSED TWO, AND NO INTERNAL OPTION"*, on the reasoning that an
   * office retrieving a blocked record for its own purposes is not retrieving it on a basis, it is
   * processing it. `OTHER` now lists an internal review and the office's own annual auditor among
   * its kinds, so that rule has moved and the owner moved it; what survives is the `note` floor,
   * which is NOT NULL for every basis and is what makes a declared internal retrieval answerable
   * instead of recorded under a judicial request nobody made.
   */
  const basis = page.getByTestId('retrieve-basis');
  await expect(basis).toBeEnabled();
  await expect(basis.locator('option')).toHaveCount(4);
  await expect(basis.locator('option[value="JUDICIAL_REQUEST"]')).toHaveCount(1);
  await expect(basis.locator('option[value="CBJ_AUDIT"]')).toHaveCount(1);
  await expect(basis.locator('option[value="AMLU_REQUEST"]')).toHaveCount(1);
  await expect(basis.locator('option[value="OTHER"]')).toHaveCount(1);

  // ---------------------------------------------- THE REGISTER RENDERS WHAT IT RECORDED
  const row = page.locator('[data-retrieval-for="entry-1"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('A judicial request');
  await expect(row).toContainText('Amman Court of First Instance');
  await expect(row).toContainText('Compliance Officer');

  // ---------------------------------------------- AND IT POSTS WHAT THE OFFICER TYPED
  let posted: Record<string, unknown> | null = null;
  await page.route(
    'http://localhost:4000/retention-archive/retrievals',
    async (route) => {
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ status: 201, json: { retrievals: [] } });
      }
      return route.fulfill({ status: 200, json: [] });
    },
  );
  await page.getByTestId('retrieve-category').fill('CommissionLedgerEntry');
  // Pasted out of a court letter, with a trailing comma — the shape an officer actually produces.
  await page.getByTestId('retrieve-records').fill('entry-1, entry-2,');
  await page
    .getByTestId('retrieve-note')
    .fill('Amman Court of First Instance, case 123 of 2026.');
  await page.getByTestId('retrieve-submit').click();

  await expect(page.getByTestId('retrieve-done')).toBeVisible();
  // THE TRAILING COMMA DID NOT BECOME AN EMPTY RECORD ID — which the server would refuse by name
  // for a reason the officer could not see on screen.
  expect(posted).toMatchObject({
    recordCategory: 'CommissionLedgerEntry',
    recordIds: ['entry-1', 'entry-2'],
    basis: 'JUDICIAL_REQUEST',
  });
});

test('BATCH 5 GROUP 7c — a reader who may nominate a disposal but may NOT retrieve sees the explanation and no retrieval section', async ({
  page,
}) => {
  /*
   * The distinction the any-of/one-code split exists for. A Branch/Department Manager holds
   * `retention.dispose.nominate` and not `retention.archive.retrieve`, so they read the same notice
   * list and are offered no retrieval control — and they are NOT shown a refusal, because they came
   * to this screen for the schedule and the batches.
   */
  await mockAuth(page, ['BRANCH_DEPARTMENT_MANAGER']);
  await mockRegister(page);

  await page.goto('/retention-disposal');

  // The ANCHOR first, from the same render: without it the absence below is satisfied by a page
  // that has not hydrated, and `toHaveCount(0)` passes on its first poll.
  await expect(page.getByTestId('retention-blocked-what')).toBeVisible();
  await expect(
    page.getByTestId('retention-retrieve-section'),
  ).toHaveCount(0);

  // AND NO "could not load" NOISE: the retrievals list is not even requested for this reader, so
  // the partial-load branch must not tell them a list failed.
  await expect(page.locator('main')).not.toContainText('did not load');
});

test('MODULE 0-ب — a FLOORED category with no period shows its ARTICLE and its FLOOR, not a blank', async ({
  page,
}) => {
  /*
   * Decision 32 on screen. The row is not an error state: the product ships it that way, because a
   * period shipped beside an article number would read as a legal opinion from us.
   *
   * What makes the empty field ACTIONABLE is the sentence beside it — "no period set, this article
   * requires at least 60 months, set yours above it". A blank is not actionable; that is.
   */
  await mockAuth(page, ['COMPLIANCE_OFFICER', 'DATA_PROTECTION_OFFICER']);
  await mockRegister(page);
  await page.goto('/retention-disposal');

  const row = page.locator('[data-no-period="KYCRecord"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('No period set');
  // THE ARTICLE AND THE FLOOR — read through the floors config by the api, so the screen cannot
  // name a different statute from the one that refused a shorter period an hour earlier.
  await expect(row).toContainText('art. 17/a');
  await expect(row).toContainText('60 months');
  // AND THAT NOTHING IS MEASURED, because an office that sees a category listed and is never
  // alerted about it will believe the system is watching.
  await expect(row).toContainText('Nothing is measured');
});

test('MODULE 0-ب — a category WITH a period shows no such notice', async ({
  page,
}) => {
  // The other half. Anchored on a positive read from the same render first.
  await mockAuth(page, ['COMPLIANCE_OFFICER', 'DATA_PROTECTION_OFFICER']);
  await mockRegister(page);
  await page.goto('/retention-disposal');

  await expect(page.locator('[data-no-period="KYCRecord"]')).toBeVisible();
  await expect(
    page.locator('[data-no-period="AuditLogEntry"]'),
  ).toHaveCount(0);
});

test('OWNER DECISION 43 — the extension register is the only place an extension is readable, and it names the basis, the hold and who', async ({
  page,
}) => {
  /*
   * THE HOLE THIS CLOSES. `GET /retention-notices` returns records whose period has ELAPSED, and an
   * extended record LEAVES that list by design — that is what an extension does. So before this
   * section existed an office could extend retention and nobody, a regulator asking *what did you
   * extend and why* included, could see the list: the write recorded the record, the basis, the
   * note, the instrument and the hold faithfully, and nothing read any of it back.
   *
   * Group 7b's own rule is that an extension is a DECISION, NOT AN EXIT, and that the register must
   * name WHICH records were extended. What that rule gets here is everything except the record's own
   * handle — see the last assertion.
   */
  await mockAuth(page, ['DATA_PROTECTION_OFFICER']);
  await mockRegister(page);

  await page.goto('/retention-disposal');

  const row = page.locator('[data-extension-for="receipt-7"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Receipt');
  // The date the EXTENDED clock elapses — the one fact that says when the same notice comes back.
  await expect(row).toContainText('2029-03-31');
  // The basis as a WORD, through the total label map, not the stored member name.
  await expect(row).toContainText('A live legal hold or dispute');
  await expect(row).toContainText('Amman dispute, file 404 of 2026');
  // THE HOLD'S SCOPE AND REASON, never its id: a reader checking whether an extension is justified
  // needs to know what was held and why, and a uuid tells them neither.
  await expect(row).toContainText('Customer file — Al-Yarmouk');
  await expect(row).toContainText('Litigation reasonably in prospect');
  await expect(row).toContainText('Compliance Officer');
  await expect(row).toContainText('2026-10-22');

  /*
   * AND THE RECORD'S OWN ID IS NOT RENDERED — rule 2, and the honest limit of this register.
   * Measured for the retrieval register next door: of the four blockable models only
   * `Receipt.reference` and `CommissionLedgerEntry.paymentReference` carry anything a person could
   * recognise, so there is no readable handle to show, and rendering the uuid would raise the
   * rendered-identifier budget. It stays in the response and in this row's own attribute, which is
   * what this locator just used to find it.
   */
  await expectAbsentWithin(page.getByTestId('retention-extension-table'), (scope) =>
    scope.getByText('receipt-7'),
  );
});

test('OWNER DECISION 43 — an office that has extended nothing is told so, rather than shown an empty table', async ({
  page,
}) => {
  await mockAuth(page, ['DATA_PROTECTION_OFFICER']);
  await mockRegister(page, { extensions: [] });

  await page.goto('/retention-disposal');

  await expect(page.getByTestId('retention-extension-none')).toContainText(
    'has recorded an extension yet',
  );
  // The TABLE is absent, not merely empty: a header row with nothing under it reads as a list that
  // failed to load. Anchored on the empty state, which is from the same render.
  await expect(page.getByTestId('retention-extension-table')).toHaveCount(0);
});

test('OWNER DECISION 45 — the chosen basis explains itself in three named parts, and the shared line renders under all four', async ({
  page,
}) => {
  /*
   * THE WORDING HALF of the bases route, which register entry 122 left open: the meanings existed in
   * English only, nothing in the i18n tree could derive Arabic from them, and shipping an English
   * sentence into an Arabic screen as a placeholder is worse than the gap. The owner has written
   * them.
   *
   * THREE NAMED PARTS AND NOT ONE STRING, which is the thing worth asserting: a definition does not
   * help a reader choose and a selection condition does, so each part is asserted SEPARATELY. One
   * `toContainText` of the whole block would pass against a reword that dropped the example, which
   * is the part a well-meaning edit cuts first for being long.
   */
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegister(page);

  await page.goto('/retention-disposal');

  const basis = page.getByTestId('retrieve-basis');
  await expect(basis).toBeEnabled();

  /*
   * THE FIRST BASIS THE SERVER NAMED IS ALREADY SELECTED, so its words are already on screen — the
   * screen defaults to `offered[0]` rather than to an empty choice, which is a decision batch four
   * took and this test had to be corrected to match: my first version asserted that NOTHING was
   * explained before a choice was made, and failed on a correct screen because a choice is made for
   * the reader the moment the list arrives. The absence that IS real is tested below, on a basis
   * whose words nobody has written.
   */
  await expect(basis).toHaveValue('JUDICIAL_REQUEST');
  const meaning = page.getByTestId('retrieve-basis-meaning');
  await expect(meaning).toBeVisible();
  // WHEN it is chosen — the selection condition, in the impersonal voice the owner wrote it in.
  await expect(meaning).toContainText('Choose this basis when');
  await expect(meaning).toContainText('the public prosecution');
  // WHAT goes in the box.
  await expect(meaning).toContainText('In the box, record');
  await expect(meaning).toContainText('the case number if there is one');
  // AND THE EXAMPLE, asserted on its own hook so a reword that drops it fails here rather than
  // passing a block-wide text check.
  await expect(meaning.locator('[data-basis-example]')).toContainText(
    'letter no. 1234',
  );
  // The shared line, which is one fact about every retrieval rather than four.
  await expect(meaning.locator('[data-basis-shared]')).toContainText(
    'after its retention period had ended',
  );

  // IT FOLLOWS THE SELECTION. Without this the test would pass against an implementation that
  // rendered the first basis's words whatever was chosen — the `SelectedValueDescription` defect.
  await basis.selectOption('AMLU_REQUEST');
  await expect(meaning).toContainText('Anti-Money Laundering');
  await expect(meaning).not.toContainText('the public prosecution');

  /*
   * `OTHER` CARRIES A FOURTH PART, and it is the reason the shape has named parts at all: its text
   * lists six kinds before saying what to write, and folding that into the selection condition would
   * bury the list the list exists to be.
   */
  await basis.selectOption('OTHER');
  await expect(meaning).toContainText('Among its kinds');
  await expect(meaning).toContainText('reopened by the insurer');
  // AND THE ONE EXAMPLE DELIBERATELY LEFT OUT — a potential dispute raised by the office's own
  // lawyer. A legal hold already covers that, and two mechanisms for one fact is what this codebase
  // refuses; asserted as an absence so nobody adds it back to be helpful.
  await expect(meaning).not.toContainText('lawyer');
});

test('OWNER DECISION 45 — a basis whose words nobody has written shows NO meaning block, rather than an empty one', async ({
  page,
}) => {
  /*
   * THE REAL ABSENCE, and the one the conditional exists for. A fifth basis added server-side is
   * selectable by design (decision 43) and has no words until somebody decides them — so the block
   * must not render at all. An empty bordered box under the select would read as a meaning that
   * failed to load, and the `aria-describedby` would then name an id that is not in the document,
   * which is itself an accessibility violation.
   */
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegister(page, { bases: [{ basis: 'REGULATORY_INSPECTION' }] });

  await page.goto('/retention-disposal');

  const basis = page.getByTestId('retrieve-basis');
  await expect(basis).toBeEnabled();
  // The option IS offered and IS selected — which is what makes the absence below meaningful rather
  // than the state of a screen that simply has no basis chosen.
  await expect(basis).toHaveValue('REGULATORY_INSPECTION');
  await expectAbsentWithin(page.getByTestId('retention-retrieve-section'), (s) =>
    s.getByTestId('retrieve-basis-meaning'),
  );
  // AND THE SELECT DESCRIBES NOTHING, which is the half axe would otherwise fail on.
  await expect(basis).not.toHaveAttribute('aria-describedby', /./);
});

test('OWNER DECISION 44 — the extension register names WHICH record, and never its id', async ({
  page,
}) => {
  /*
   * The half of group 7b's rule that register entry 94 recorded as open: *the register must name
   * WHICH records*. The handle is the real reference the RECORD carries — resolved by the api per
   * category — and the id is still not rendered, so the rendered-identifier budget does not move.
   */
  await mockAuth(page, ['DATA_PROTECTION_OFFICER']);
  await mockRegister(page);

  await page.goto('/retention-disposal');

  const row = page.locator('[data-extension-for="receipt-7"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('BANK-TRF-8812');
  // AND THE ID IS NOT ON THE ROW. `receipt-7` is the record id and it is the row's own test hook, so
  // this is asserted on the row's TEXT rather than on the element — the hook must survive and the
  // rendering must not.
  await expect(row).not.toContainText('receipt-7');
});

test('OWNER DECISION 44 — a record that cannot be named says WHICH of the reasons applies, never an em dash', async ({
  page,
}) => {
  /*
   * The three absent states are different answers to a regulator and an em dash is none of them:
   * "nobody wrote the reference down" is a gap somebody can still close, "this kind of record has
   * none" never will be, and "the record is gone" is a third thing again. A single dash for all
   * three is what makes a register look complete while saying nothing.
   */
  await mockAuth(page, ['DATA_PROTECTION_OFFICER']);
  await mockRegister(page, {
    extensions: [
      {
        id: 'ext-none',
        recordCategory: 'Settlement',
        recordId: 'settle-3',
        extendedUntil: '2029-03-31T00:00:00.000Z',
        basis: 'LEGISLATIVE_PROVISION',
        note: 'Pending examination by the tax department.',
        legislativeInstrument: 'Commercial Law No. 12 of 1966',
        legislativeArticle: 'art. 19',
        legalHold: null,
        consentRecordId: null,
        consentDuration: null,
        consentPurpose: null,
        extendedByUserId: 'u-1',
        extendedByName: 'Compliance Officer',
        extendedAt: '2026-10-22T09:00:00.000Z',
        recordHandle: {
          state: 'CATEGORY_HAS_NO_REFERENCE',
          reason: 'a settlement carries no reference of its own',
        },
      },
      {
        id: 'ext-gap',
        recordCategory: 'CommissionLedgerEntry',
        recordId: 'entry-9',
        extendedUntil: '2029-03-31T00:00:00.000Z',
        basis: 'LEGISLATIVE_PROVISION',
        note: 'Pending examination by the tax department.',
        legislativeInstrument: 'Commercial Law No. 12 of 1966',
        legislativeArticle: 'art. 19',
        legalHold: null,
        consentRecordId: null,
        consentDuration: null,
        consentPurpose: null,
        extendedByUserId: 'u-1',
        extendedByName: 'Compliance Officer',
        extendedAt: '2026-10-22T09:00:00.000Z',
        recordHandle: {
          state: 'NOT_RECORDED',
          description: 'the commission payment reference',
        },
      },
    ],
  });

  await page.goto('/retention-disposal');

  const noneRow = page.locator('[data-extension-for="settle-3"]');
  await expect(noneRow).toBeVisible();
  await expect(noneRow).toContainText('No reference exists for this kind');
  const gapRow = page.locator('[data-extension-for="entry-9"]');
  await expect(gapRow).toContainText('No reference recorded');
  /*
   * AND THE TWO SENTENCES ARE DIFFERENT, asserted both ways. Each row alone would pass against an
   * implementation that rendered one sentence for every absent state, which is the collapse this
   * decision is about.
   */
  await expect(noneRow).not.toContainText('No reference recorded');
  await expect(gapRow).not.toContainText('for this kind');
});

test('OWNER DECISION 43 — the retrieval bases come from the SERVER, and one the web has no word for is still offered under its own name', async ({
  page,
}) => {
  /*
   * THE STRUCTURAL HALF of the bases route. This screen used to carry its own copy of the closed two
   * as a hardcoded pair of `<option>`s and a `useState('JUDICIAL_REQUEST')` default, while
   * `GET /retention-archive/bases` existed so that *"the screen renders them rather than restating
   * them"* — its controller's own words — and reached no caller at all.
   *
   * The proof is a THIRD basis the server offers and this build has never heard of. It must be
   * SELECTABLE (the capability is the server's to grant) and labelled by its own member name, which
   * is visibly unfinished — the same decision the eighteen workflow-entity labels made for a member
   * with no word, and the opposite of `t(undefined)`, which renders nothing at all.
   */
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegister(page, {
    bases: [
      { basis: 'JUDICIAL_REQUEST' },
      { basis: 'CBJ_AUDIT' },
      { basis: 'REGULATORY_INSPECTION' },
    ],
  });

  await page.goto('/retention-disposal');

  const basis = page.getByTestId('retrieve-basis');
  /*
   * THE ANCHOR IS THE SELECT BEING ENABLED, and it had to be: my first version anchored on the
   * select merely being VISIBLE, which it is from the first paint with no options in it at all, so
   * `anchoredTexts` read an empty list and the test failed on a correct screen. The select is
   * DISABLED until the server's list arrives, which makes "enabled" the one signal that proves the
   * fetch resolved — a semantic anchor rather than a count of the thing being asserted.
   */
  await expect(basis).toBeEnabled();
  const texts = await anchoredTexts(basis.locator('option'), basis);
  expect(texts).toHaveLength(3);
  // The two this build knows are WORDS, not member names.
  expect(texts[0]).toBe('A judicial request');
  expect(texts[1]).toBe('A Central Bank audit');
  // The third renders its own member name: unfinished and obviously so, rather than blank.
  expect(texts[2]).toBe('REGULATORY_INSPECTION');
  await expect(
    basis.locator('option[value="REGULATORY_INSPECTION"]'),
  ).toHaveCount(1);

  // AND IT IS SELECTABLE AND SENDS ITS OWN VALUE — the server is the validator here
  // (`@IsIn(ARCHIVE_RETRIEVAL_BASES)` answers 400 on anything it did not offer), so the screen
  // narrowing the list a second time would only stop a third basis working.
  let posted: Record<string, unknown> | null = null;
  await page.route(
    'http://localhost:4000/retention-archive/retrievals',
    async (route) => {
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ status: 201, json: { retrievals: [] } });
      }
      return route.fulfill({ status: 200, json: [] });
    },
  );
  await basis.selectOption('REGULATORY_INSPECTION');
  await page.getByTestId('retrieve-category').fill('Receipt');
  await page.getByTestId('retrieve-records').fill('receipt-7');
  await page.getByTestId('retrieve-note').fill('Inspection reference 2026/11.');
  await page.getByTestId('retrieve-submit').click();

  await expect(page.getByTestId('retrieve-done')).toBeVisible();
  expect(posted).toMatchObject({ basis: 'REGULATORY_INSPECTION' });
});

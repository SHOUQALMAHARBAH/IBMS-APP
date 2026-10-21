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

const NOTICES = [
  {
    recordCategory: 'CommissionLedgerEntry',
    retentionPeriodMonths: 120,
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
  opts: {
    scheduleStatus?: number;
    holdsStatus?: number;
    batchesStatus?: number;
    batches?: unknown[];
    noticesStatus?: number;
    notices?: unknown[];
    retrievalsStatus?: number;
    retrievals?: unknown[];
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

  // ---------------------------------------------- A CLOSED TWO, AND NO "INTERNAL" OPTION
  const basis = page.getByTestId('retrieve-basis');
  await expect(basis.locator('option')).toHaveCount(2);
  await expect(basis.locator('option[value="JUDICIAL_REQUEST"]')).toHaveCount(1);
  await expect(basis.locator('option[value="CBJ_AUDIT"]')).toHaveCount(1);

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

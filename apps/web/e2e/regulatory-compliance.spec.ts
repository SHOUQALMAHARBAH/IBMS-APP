import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { permissionsForRoles } from './fixtures/role-permissions';

const ME_BASE = {
  id: 'user-1',
  email: 'compliance@ibms.test',
  fullName: 'Compliance Officer',
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

const LICENSE = {
  // A uuid-shaped id, not "the-broker-license": Module 0 item (c) retired that constant, which had
  // been the table's PRIMARY KEY and therefore allowed one licence row per PLATFORM.
  id: 'b1f0c0de-0000-4000-8000-000000000001',
  licenseNumber: 'CBJ-2026-001',
  scopeOfAuthorization: 'General insurance brokerage',
  issuedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
  // `status` IS GONE from the api view — module 0-ب's licence batch dropped the column. It was the
  // third of three answers to whether the office may practise, and this screen rendered it BESIDE
  // the live-derived `isCurrentlyLapsed` in one cell.
  isCurrentlyLapsed: false,
  certificateDocumentId: 'doc-certificate-1',
  renewalRequestedAt: null,
  // Module 0 item (d). Shaped from the endpoint: art. 11's deadline is 45 calendar days before
  // expiry, and 2027-01-01 minus 45 days is 2026-11-17.
  renewalDueBy: '2026-11-17T00:00:00.000Z',
  renewalFiledOnTime: false,
  validPendingRenewalDecision: false,
  expiryIsEndOfCalendarYear: false,
  expectedExpiryForThreeYearTerm: '2028-12-31T00:00:00.000Z',
  // FALSE, and accurate rather than convenient: this fixture's term runs 2026-01-01 to
  // 2027-01-01, which is neither a 31 December nor the three-year term art. 10/b requires.
  expiryMatchesThreeYearTerm: false,
};

/*
 * THE ENVELOPE `GET /broker-license` ACTUALLY RETURNS since Module 0 item (c): the current term
 * plus the series.
 *
 * Shaped from the endpoint rather than approximated. A mock whose shape differs from the real
 * response crashes the component it feeds and surfaces as Chrome's own "This page couldn't load"
 * rather than a React error — which this project has been bitten by three times — and the screen
 * reads `series.current`, so a flat body would leave it `undefined`.
 */
/**
 * THE DERIVED STANDING — the ONE answer, which `LicenseGateService` also refuses on.
 *
 * ACTIVE here, because every test below but one is about a licensed office. `mayPractise` is read
 * by the screen rather than the label, exactly as the gate does, so the two cannot disagree.
 */
const STANDING_ACTIVE = {
  status: 'ACTIVE',
  mayPractise: true,
  standingActDecisionRef: null,
  deemedCancelledUnderArticle14C: false,
};

/** Far from the expiry, so the renewal series is silent — `NONE` renders nothing at all, which is
 *  deliberate: a panel that says "nothing due" every day is one a reader stops looking at. */
const NOTICE_NONE = {
  stage: 'NONE',
  daysToExpiry: 400,
  expiresAt: '2027-01-01T00:00:00.000Z',
  applicationDueBy: '2026-11-17T00:00:00.000Z',
  renewalFiled: false,
};

const LICENSE_SERIES = {
  current: LICENSE,
  terms: [LICENSE],
  standing: STANDING_ACTIVE,
  renewalNotice: NOTICE_NONE,
};

/** Module 0 item (e). `code` is null for an office's own line; `isStandard` decides which id the
 *  screen sends, because the two catalogues are addressed by different fields. */
const LINES = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'MOTOR_COMPREHENSIVE',
    nameEn: 'Motor comprehensive',
    nameAr: 'تأمين المركبات الشامل',
    category: 'GENERAL',
    isStandard: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    code: 'LIFE_INDIVIDUAL',
    nameEn: 'Individual life',
    nameAr: 'تأمين الحياة الفردي',
    category: 'LIFE',
    isStandard: true,
  },
];

const SCOPE = {
  brokerLicenseId: LICENSE.id,
  types: ['GENERAL'],
  branches: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      brokerLicenseId: LICENSE.id,
      insuranceLineId: LINES[0].id,
      officeInsuranceLineId: null,
      category: 'GENERAL',
      nameEn: LINES[0].nameEn,
      nameAr: LINES[0].nameAr,
      code: LINES[0].code,
    },
  ],
  branchCountByType: { GENERAL: 1 },
  // Module 0 item (f). ONE type, so one approved person is required — and the office records none,
  // which is db-test's measured real state and the one the warning exists for.
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
};

const CALENDAR_ITEMS = [
  {
    id: 'item-1',
    obligationName: 'Annual AML training attestation',
    ownerUserId: 'user-1',
    dueDate: '2026-01-01T00:00:00.000Z',
    evidenceOfSubmissionRef: null,
    submittedAt: null,
    isSubmitted: false,
    isOverdue: true,
  },
  {
    id: 'item-2',
    obligationName: 'Quarterly CBJ prudential return',
    ownerUserId: 'user-1',
    dueDate: '2026-12-01T00:00:00.000Z',
    evidenceOfSubmissionRef: 'doc://ref-1',
    submittedAt: '2026-11-15T00:00:00.000Z',
    isSubmitted: true,
    isOverdue: false,
  },
];

async function mockRegulatoryCompliance(
  page: Page,
  opts: {
    licenseStatus?: number;
    calendarStatus?: number;
    /** Module 0 item (c) — override the series to exercise a different licence state. */
    licenseSeries?: unknown;
    /** Module 0 item (e) — override the scope to exercise a different capital or art. 3/a state. */
    scope?: unknown;
  } = {},
) {
  await page.route('http://localhost:4000/insurance-lines', (route) =>
    route.fulfill({ status: 200, json: LINES }),
  );
  await page.route('http://localhost:4000/broker-license/scope', (route) =>
    route.fulfill({ status: 200, json: opts.scope ?? SCOPE }),
  );
  await page.route('http://localhost:4000/broker-license', (route) => {
    if (opts.licenseStatus && opts.licenseStatus !== 200) {
      return route.fulfill({
        status: opts.licenseStatus,
        json: { message: 'no' },
      });
    }
    return route.fulfill({
      status: 200,
      json: opts.licenseSeries ?? LICENSE_SERIES,
    });
  });
  await page.route('http://localhost:4000/compliance-calendar**', (route) => {
    if (opts.calendarStatus && opts.calendarStatus !== 200) {
      return route.fulfill({
        status: opts.calendarStatus,
        json: { message: 'no' },
      });
    }
    return route.fulfill({ status: 200, json: CALENDAR_ITEMS });
  });
}

test('shows the broker license status and the compliance calendar with the create forms', async ({
  page,
}) => {
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page);

  await page.goto('/regulatory-compliance');
  await expect(
    page.getByRole('heading', { name: 'Regulatory compliance' }),
  ).toBeVisible();
  await expect(page.getByText('CBJ-2026-001')).toBeVisible();
  /*
   * RE-POINTED, not relaxed. This asserted a **Mark lapsed** button — one click, no body, which
   * flipped a two-value `BrokerLicense.status` column. The office's record of a CBJ suspension
   * therefore carried no basis, no effective date, no decision reference and no letter, and the
   * derivation read it as SUSPENDED with a NULL reference.
   *
   * What the control IS now is a form that records the DECISION, so what is asserted is the form
   * and the fields that make the row answerable a year later.
   */
  const actForm = page.locator('[data-regulatory-action-form]');
  await expect(actForm).toBeVisible();
  await expect(
    actForm.getByRole('button', { name: 'Record the decision' }),
  ).toBeVisible();
  await expect(actForm.getByLabel('Decision reference')).toBeVisible();
  // AND IT REFUSES RATHER THAN SENDING A REQUEST IT KNOWS WILL 400 — the reference is NOT NULL in
  // the database and required by the DTO, so the button is disabled on an empty form.
  await expect(
    actForm.getByRole('button', { name: 'Record the decision' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('cell', { name: 'Annual AML training attestation' }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Quarterly CBJ prudential return' }),
  ).toBeVisible();
  await expect(page.getByLabel('License number')).toBeVisible();
  await expect(page.getByLabel('Obligation')).toBeVisible();
  // the overdue, unsubmitted item shows a record-submission control; the
  // already-submitted one does not
  await expect(
    page.getByRole('button', { name: 'Record submission' }),
  ).toHaveCount(1);
});

test('a user without either permission sees friendly messages', async ({
  page,
}) => {
  await mockAuth(page, ['SALES_RELATIONSHIP_OFFICER']);
  await mockRegulatoryCompliance(page, {
    licenseStatus: 403,
    calendarStatus: 403,
  });

  await page.goto('/regulatory-compliance');
  await expect(
    page.getByText('(license.manage)', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('(compliance-calendar.manage)', { exact: false }),
  ).toBeVisible();
});

test('regulatory compliance screen has no serious/critical accessibility violations @a11y', async ({
  page,
}) => {
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page);

  await page.goto('/regulatory-compliance');
  await expect(page.getByText('CBJ-2026-001')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    ),
  ).toEqual([]);
});

test('an office with NO licence term is told so, and told that new business is blocked', async ({
  page,
}) => {
  /*
   * Module 0 item (c). This is the state that MATTERS most on this screen and the one that could
   * not be rendered before: the route used to 404 for an office with no licence, which a reader
   * cannot tell apart from a broken page.
   *
   * It is also the state that now BLOCKS new business, so the screen has to say that rather than
   * just showing an empty panel — otherwise Compliance sees nothing wrong here and the refusal
   * surfaces later, on a placement, as an unexplained 422.
   */
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page, {
    licenseSeries: {
      current: null,
      terms: [],
      // NO_TERM_ON_RECORD is a real standing and the one that BLOCKS under art. 21/a/9 — and there
      // is no term to hang it on, which is why the standing is a fact about the OFFICE rather than
      // a column on a term.
      standing: {
        status: 'NO_TERM_ON_RECORD',
        mayPractise: false,
        standingActDecisionRef: null,
        deemedCancelledUnderArticle14C: false,
      },
      // Silent: there is no date to count down to, and inventing one would give a reader a
      // countdown to an expiry nobody recorded.
      renewalNotice: {
        stage: 'NONE',
        daysToExpiry: null,
        expiresAt: null,
        applicationDueBy: null,
        renewalFiled: false,
      },
    },
  });
  await page.goto('/regulatory-compliance');

  const alert = page.locator('main').getByRole('alert');
  await expect(alert).toContainText('no licence term on record');
  // The refusal names the REGULATION, not just the fact. A reader who is told only "no licence"
  // has to guess whether it matters.
  await expect(alert).toContainText('art. 21/a/9');

  // The form is still offered — this is a screen for fixing the problem, not only reporting it.
  await expect(
    page.getByLabel('Certificate file name', { exact: true }),
  ).toBeVisible();
});

test('the licence is a SERIES: earlier terms stay visible, with the current one marked', async ({
  page,
}) => {
  // The claim the old implementation could not satisfy. Renewal was an updateMany over one row, so
  // the previous term was erased and the office could not show a regulator what it once held.
  const previous = {
    ...LICENSE,
    id: 'b1f0c0de-0000-4000-8000-000000000000',
    licenseNumber: 'CBJ-2023-OLD',
    expiresAt: '2025-12-31T00:00:00.000Z',
    // NO `status` — the column is gone, and A TERM HAS NO STATUS OF ITS OWN. `pickCurrentTerm`
    // decides which term governs by LATEST EXPIRY, so a superseded term needs no flag to stop
    // governing, and the office's STANDING is one answer about the office rather than a column per
    // row.
    isCurrentlyLapsed: true,
  };
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page, {
    licenseSeries: {
      current: LICENSE,
      terms: [LICENSE, previous],
      standing: STANDING_ACTIVE,
      renewalNotice: NOTICE_NONE,
    },
  });
  await page.goto('/regulatory-compliance');

  // Scoped by test id, not by position: this screen renders three tables and `.last()`
  // silently followed the compliance calendar.
  const terms = page.getByTestId('licence-terms');
  await expect(terms.getByText('CBJ-2023-OLD')).toBeVisible();
  // Which term is in force has to be legible, not inferred from row order.
  await expect(terms.getByText(/CBJ-2026-001 \(Current term\)/)).toBeVisible();
});

test('an expiry that is not a 31 December WARNS and does not block (art. 10/b)', async ({
  page,
}) => {
  /*
   * Module 0 item (d). The requirement is precise about this: the date is entered as printed on the
   * certificate, the certificate is the authority, and the system asks a human to verify rather
   * than refusing. So the assertion is a PAIR — the warning is present AND the term is still
   * treated as usable.
   */
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page);
  await page.goto('/regulatory-compliance');

  const warning = page.locator('[data-expiry-not-end-of-year]');
  await expect(warning).toContainText('not a 31 December');
  await expect(warning).toContainText('art. 10/b');
  // Not refused: the entry stands and the licence still reads active.
  await expect(warning).toContainText('was not refused');
  await expect(page.locator('main')).toContainText('CBJ-2026-001');
});

test('an expiry that is not the three-year term WARNS, and names the part-year rule (art. 10/b)', async ({
  page,
}) => {
  /*
   * Correction 0.3. Module 0 item (d) surfaced the expected expiry and deliberately warned about
   * NOTHING, on the stated ground that "three calendar years" was ambiguous for a term issued
   * mid-year. Art. 10/b answers it in its own sentence — part of a calendar year counts as a year —
   * so the ambiguity was never there and the screen now says when the dates disagree.
   *
   * Same pair as the sibling above: the warning appears AND nothing is refused.
   */
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page);
  await page.goto('/regulatory-compliance');

  const warning = page.locator('[data-expiry-not-three-year-term]');
  await expect(warning).toContainText('art. 10/b');
  // The RULE, not just the article number — an officer reading "does not match art. 10/b" with no
  // explanation cannot tell whether the entry or the regulation is being described.
  await expect(warning).toContainText('part of a calendar year counts as a year');
  await expect(warning).toContainText('was not refused');
  await expect(page.locator('main')).toContainText('CBJ-2026-001');
});

test('NO three-year warning when the issue date was never recorded — a blank field is not a discrepancy', async ({
  page,
}) => {
  /*
   * THE THREE-STATE HALF, and the one that would rot silently. `expiryMatchesThreeYearTerm` is
   * null when no issue date is on record, and collapsing that into `false` would accuse every
   * office that left the field blank of disagreeing with the regulation.
   *
   * The absence is anchored on a positive read from the SAME render — without it an unhydrated
   * page satisfies the absence and the test passes proving nothing.
   */
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page, {
    licenseSeries: {
      standing: STANDING_ACTIVE,
      renewalNotice: NOTICE_NONE,
      current: {
        ...LICENSE,
        issuedAt: null,
        expectedExpiryForThreeYearTerm: null,
        expiryMatchesThreeYearTerm: null,
      },
      terms: [LICENSE],
    },
  });
  await page.goto('/regulatory-compliance');

  // Anchor: the page rendered and the term is on it.
  await expect(page.locator('main')).toContainText('CBJ-2026-001');
  await expect(page.locator('[data-expiry-not-three-year-term]')).toHaveCount(0);
});

test('an expired term with a timely application says it is still valid, and does NOT cite art. 11', async ({
  page,
}) => {
  // Without this the screen would show an expiry in the past beside a licence the system is
  // content with, and explain neither.
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  const extended = {
    ...LICENSE,
    expiresAt: '2026-12-31T00:00:00.000Z',
    expiryIsEndOfCalendarYear: true,
    renewalRequestedAt: '2026-11-16T00:00:00.000Z',
    renewalFiledOnTime: true,
    validPendingRenewalDecision: true,
    isCurrentlyLapsed: false,
  };
  await mockRegulatoryCompliance(page, {
    licenseSeries: {
      current: extended,
      terms: [extended],
      // RENEWAL_PENDING — and `mayPractise` is TRUE, which is the whole reason that state exists
      // separately from EXPIRED: both are past the printed expiry and only one may trade.
      standing: {
        status: 'RENEWAL_PENDING',
        mayPractise: true,
        standingActDecisionRef: null,
        deemedCancelledUnderArticle14C: false,
      },
      // AND THE SERIES IS STILL RUNNING even though the application is filed, which is the
      // brief's own instruction: a filing is not a decision, so `renewalFiled` is reported BESIDE
      // the stage rather than suppressing it.
      renewalNotice: {
        stage: 'CONTINUING',
        daysToExpiry: 5,
        expiresAt: '2026-12-31T00:00:00.000Z',
        applicationDueBy: '2026-11-16T00:00:00.000Z',
        renewalFiled: true,
      },
    },
  });
  await page.goto('/regulatory-compliance');

  const notice = page.locator('[data-valid-pending-renewal-decision]');
  // The rule still holds and the notice still explains it.
  await expect(notice).toContainText('treated as still valid');
  await expect(notice).toContainText('filed on time');
  // AND IT NO LONGER CLAIMS A LEGAL AUTHORITY IT DOES NOT HAVE. This is the half that would
  // rot silently: the behaviour is unchanged, so only an assertion on the ABSENCE of the
  // citation can catch somebody putting it back.
  await expect(notice).not.toContainText('art. 11');
  await expect(notice).not.toContainText('by operation of law');
  await expect(notice).toContainText('no provision of Instructions No. 9 of 2026');
  // And the two warnings are distinct states, not one: a 31-December expiry raises no art. 10/b
  // warning even while this one is showing.
  await expect(page.locator('[data-expiry-not-end-of-year]')).toHaveCount(0);
});

test('an application filed AFTER the deadline is called out while there is still time', async ({
  page,
}) => {
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  const late = {
    ...LICENSE,
    expiresAt: '2026-12-31T00:00:00.000Z',
    expiryIsEndOfCalendarYear: true,
    renewalRequestedAt: '2026-12-20T00:00:00.000Z',
    renewalFiledOnTime: false,
    validPendingRenewalDecision: false,
  };
  await mockRegulatoryCompliance(page, {
    licenseSeries: {
      current: late,
      terms: [late],
      standing: STANDING_ACTIVE,
      // The series IS running here — this term expires inside 30 days — and the filing is on
      // record but LATE, which is the thing the test is about. The notice carries the filing as a
      // fact; `[data-renewal-filed-late]` is the separate art. 11 consequence.
      renewalNotice: {
        stage: 'CONTINUING',
        daysToExpiry: 20,
        expiresAt: late.expiresAt,
        applicationDueBy: '2026-11-16T00:00:00.000Z',
        renewalFiled: true,
      },
    },
  });
  await page.goto('/regulatory-compliance');

  const notice = page.locator('[data-renewal-filed-late]');
  await expect(notice).toContainText('after the deadline');
  // The consequence, not just the fact: the extension will not apply.
  await expect(notice).toContainText('will not remain valid');
});

test('the licence scope shows derived TYPES and its branches', async ({
  page,
}) => {
  // Module 0 item (e). The type is never sent or stored — it is the category of the branch — so
  // what the screen shows is the derivation's output.
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page);
  await page.goto('/regulatory-compliance');

  await expect(page.locator('[data-licence-types]')).toContainText('General');
  // The count beside the type, because art. 4/a's requirement is driven by it.
  await expect(page.locator('[data-licence-types]')).toContainText('(1)');
  await expect(page.locator('[data-licence-branches]')).toContainText(
    'Motor comprehensive',
  );
  await expect(page.locator('[data-required-capital]')).toContainText(
    '5000.000',
  );
});

test('capital has THREE states, and unrecorded is not the same as too low', async ({
  page,
}) => {
  /*
   * The distinction the config insists on, asserted on screen: "nobody has typed a capital figure"
   * is a missing fact about the office, while "the figure is below the requirement" is a finding
   * about its capital. A screen that conflated them would tell an office it is undercapitalised
   * when nobody has entered anything.
   */
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page);
  await page.goto('/regulatory-compliance');
  await expect(page.locator('[data-capital-unrecorded]')).toContainText(
    'No paid-up capital is recorded',
  );
  // And it says it blocks nothing — a warning that reads like a refusal gets escalated.
  await expect(page.locator('[data-capital-unrecorded]')).toContainText(
    'blocks nothing',
  );
  await expect(page.locator('[data-capital-shortfall]')).toHaveCount(0);
  await expect(page.locator('[data-capital-ok]')).toHaveCount(0);

  // Recorded and SHORT -> a different warning.
  await mockRegulatoryCompliance(page, {
    scope: {
      ...SCOPE,
      capital: {
        requiredCapital: '5000.000',
        paidUpCapital: '3000.000',
        shortfall: '2000.000',
        meetsRequirement: false,
        capitalIsUnrecorded: false,
      },
    },
  });
  await page.reload();
  await expect(page.locator('[data-capital-shortfall]')).toContainText(
    'below what art. 4/a requires',
  );
  await expect(page.locator('[data-capital-unrecorded]')).toHaveCount(0);

  // Recorded and SUFFICIENT -> no warning at all.
  await mockRegulatoryCompliance(page, {
    scope: {
      ...SCOPE,
      capital: {
        requiredCapital: '5000.000',
        paidUpCapital: '5000.000',
        shortfall: '0.000',
        meetsRequirement: true,
        capitalIsUnrecorded: false,
      },
    },
  });
  await page.reload();
  await expect(page.locator('[data-capital-ok]')).toBeVisible();
  await expect(page.locator('[data-capital-shortfall]')).toHaveCount(0);
  await expect(page.locator('[data-capital-unrecorded]')).toHaveCount(0);
});

test('a sole establishment is told the one-type limit BEFORE it hits the refusal', async ({
  page,
}) => {
  // Art. 3/a. The api refuses a second type with a 422, but a screen that only surfaces the
  // refusal teaches the limit by failure. This says it while the form is still empty.
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page, {
    scope: { ...SCOPE, brokerKind: 'NATURAL_PERSON' },
  });
  await page.goto('/regulatory-compliance');

  const note = page.locator('[data-sole-establishment]');
  await expect(note).toContainText('sole establishment');
  await expect(note).toContainText('art. 3/a');

  // And it is absent for a corporate broker, which may hold both.
  await mockRegulatoryCompliance(page);
  await page.reload();
  await expect(page.locator('[data-sole-establishment]')).toHaveCount(0);
});

test('the one-type refusal DECLARES ITS BASIS — that the rule is applied however the office brokes', async ({
  page,
}) => {
  /*
   * REGISTER ENTRY 20, DECLARED RATHER THAN RESOLVED (owner's instruction, 2026-10-16).
   *
   * Art. 3/a's refusal is keyed on `brokerKind === 'NATURAL_PERSON'` and reads nothing about
   * `brokerageKind`, so it fires on a reinsurance broker exactly as on a direct one — while whether
   * Instructions No. 9 of 2026 govern a reinsurance broker at all is unresolved, and that column's
   * own comment once claimed these guards "must not fire" for one. Entry 20 stays open; what this
   * asserts is that the refusal is no longer SILENT about the basis on which it is being applied.
   *
   * THE THREE CLAUSES ARE ASSERTED SEPARATELY because each is a different promise, and a single
   * `toContainText` of the whole sentence would pass against a reword that dropped any one of them:
   * that it applies to EVERY office, WHY (no separate text for reinsurance brokerage), and that the
   * question is NOT SETTLED here. The last is the one a well-meaning edit would delete as hedging.
   */
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page, {
    scope: { ...SCOPE, brokerKind: 'NATURAL_PERSON' },
  });
  await page.goto('/regulatory-compliance');

  const basis = page.locator('[data-one-type-basis]');
  await expect(basis).toBeVisible();
  await expect(basis).toContainText('every brokerage office');
  await expect(basis).toContainText('reinsurance brokerage');
  await expect(basis).toContainText('not settled here');

  /*
   * IT IS NOT A SECOND REFUSAL, and that is a visibility property rather than a wording one: the
   * sole-establishment note states the limit and this states the basis of it, so both must be on the
   * page together. A basis rendered where the limit is not would explain a rule nobody was told about.
   */
  await expect(page.locator('[data-sole-establishment]')).toBeVisible();

  // Absent for a corporate broker, because the refusal cannot fire there and a basis with no refusal
  // behind it is an unexplained paragraph about reinsurance on an unrelated office's screen.
  await mockRegulatoryCompliance(page);
  await page.reload();
  // ANCHORED: the licence types are read from the same response, so this proves the scope section
  // rendered before the two absences below are read as absences rather than as an unmounted page.
  await expect(page.locator('[data-licence-types]')).toBeVisible();
  await expect(page.locator('[data-sole-establishment]')).toHaveCount(0);
  await expect(page.locator('[data-one-type-basis]')).toHaveCount(0);
});

test('the minimum-staff requirement is stated BEFORE the refusal, with both numbers', async ({
  page,
}) => {
  /*
   * Module 0 item (f). The refusal only fires on the branch that would add a SECOND insurance type,
   * so a screen that waited for it would teach the rule by failure — and the one-type shortfall
   * would never be mentioned at all, because it is reported rather than refused.
   */
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page);
  await page.goto('/regulatory-compliance');

  // Both numbers, because a warning that states only the requirement cannot be acted on.
  await expect(page.locator('[data-staffing]')).toContainText('1');
  await expect(page.locator('[data-staffing]')).toContainText('0');
  await expect(page.locator('[data-staffing-short]')).toContainText(
    'one approved person for one insurance type, two for both',
  );
  // It names WHERE the fact is recorded — a warning that does not is a dead end.
  await expect(page.locator('[data-staffing-short]')).toContainText(
    'employee record',
  );
  await expect(page.locator('[data-staffing-ok]')).toHaveCount(0);
});

test('a staffed office is told so, and gets no warning', async ({ page }) => {
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page, {
    scope: {
      ...SCOPE,
      staffing: {
        requiredApprovedStaff: 2,
        currentApprovedStaff: 2,
        meetsRequirement: true,
      },
    },
  });
  await page.goto('/regulatory-compliance');

  await expect(page.locator('[data-staffing-ok]')).toContainText(
    'meets the minimum approved staff',
  );
  await expect(page.locator('[data-staffing-short]')).toHaveCount(0);
});

/*
 * MODULE 0-ب, THE LICENCE — the screen shows the DERIVED standing and the renewal series.
 *
 * Both are hand-copied over HTTP, so a dropped field is invisible to `tsc` and to every unit test;
 * these two tests plus the api e2e's response-body assertion are the only layers that can see it.
 */

test('the licence panel shows the DERIVED six-state standing, and names the CBJ decision behind it', async ({
  page,
}) => {
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page, {
    licenseSeries: {
      current: LICENSE,
      terms: [LICENSE],
      // A recorded CBJ suspension against an otherwise perfectly current term — the case that used
      // to be invisible, because the derivation knew about it and the gate never asked.
      standing: {
        status: 'SUSPENDED',
        mayPractise: false,
        standingActDecisionRef: 'CBJ/2026/77',
        deemedCancelledUnderArticle14C: false,
      },
      renewalNotice: NOTICE_NONE,
    },
  });
  await page.goto('/regulatory-compliance');

  const standing = page.getByTestId('rc-standing');
  await expect(standing).toContainText('Suspended');
  // CITABLE — the whole difference from the two-value flag this replaced, whose suspension carried
  // no reference at all and which the derivation's own comment called "the finding".
  await expect(standing).toContainText('CBJ/2026/77');

  // AND THE BLOCK NAMES WHAT IS AND IS NOT AFFECTED. The second half is not decoration: an office
  // told only that it is blocked has no way to know whether it may still collect a premium, and an
  // over-wide reading of the block is a worse defect than the block missing.
  const block = page.locator('[data-standing-may-not-practise]');
  await expect(block).toContainText('may not place new business');
  await expect(block).toContainText('Collection');
  await expect(block).toContainText('claims');

  // The standing is DERIVED, and the screen says so rather than letting a reader take it for a
  // stored field somebody can correct.
  await expect(page.locator('main')).toContainText('not stored as a field');
});

test('the renewal notice fires 45 days out, and a FILED application does not quieten it', async ({
  page,
}) => {
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page, {
    licenseSeries: {
      current: { ...LICENSE, renewalRequestedAt: '2026-11-16T00:00:00.000Z' },
      terms: [LICENSE],
      standing: STANDING_ACTIVE,
      renewalNotice: {
        stage: 'FIRST',
        daysToExpiry: 45,
        expiresAt: '2027-01-01T00:00:00.000Z',
        applicationDueBy: '2026-11-17T00:00:00.000Z',
        // FILED. The brief forbids this suppressing the series, and the direction of the error is
        // the reason: a filing is not a decision, so the office that applied on time and heard
        // nothing is the one that most needs to keep being told.
        renewalFiled: true,
      },
    },
  });
  await page.goto('/regulatory-compliance');

  const notice = page.locator('[data-renewal-notice]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('45 days');
  await expect(notice).toContainText('art. 11');
  // The filing is reported BESIDE the stage, saying plainly that it does not lift the block.
  await expect(page.locator('[data-renewal-notice-filing]')).toContainText(
    'does NOT lift the block',
  );
  // AND THE 30-DAY POINT DECLARES THAT IT RESTS ON NO PROVISION. A number shown beside a citation
  // it does not have is this product telling a broker the law says something it does not.
  await expect(notice).toContainText('rests on no provision');
});

test('the renewal notice is SILENT while the expiry is far off', async ({
  page,
}) => {
  // NONE renders nothing at all, deliberately: a panel that says "nothing due" every day is one a
  // reader learns to skip, and this one has to be believed on the day it changes.
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await mockRegulatoryCompliance(page, { licenseSeries: LICENSE_SERIES });
  await page.goto('/regulatory-compliance');

  // Anchored on something positive from the SAME render, or an unhydrated page satisfies the
  // absence and the test passes proving nothing.
  await expect(page.getByTestId('rc-standing')).toContainText('Current');
  await expect(page.locator('[data-renewal-notice]')).toHaveCount(0);
});

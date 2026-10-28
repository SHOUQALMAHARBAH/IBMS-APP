import { expect, test, type Page } from '@playwright/test';
import { expectAbsentWithin } from './support/anchored';
import AxeBuilder from '@axe-core/playwright';
import { permissionsForRoles } from './fixtures/role-permissions';

const ME_BASE = {
  id: 'user-1',
  email: 'officer@ibms.test',
  fullName: 'Sales Officer',
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

/*
 * `promptAr` is REQUIRED on the api's question type since the thirteen Arabic prompts landed.
 * The Arabic BELOW IS FIXTURE TEXT, deliberately not the owner's wording: hers lives in
 * `needs-assessment.config.ts` and is pinned there by sha256, and a mock carrying it would be a
 * second copy of her prose free to drift from the pinned one. What a fixture has to prove is
 * WHICH FIELD the screen reads, and distinct nonsense proves that better than a faithful copy.
 */
const QUESTIONNAIRE = {
  questions: [
    {
      id: 'ownsOrLeasesPremises',
      prompt: 'Own or lease premises?',
      promptAr: 'سؤالُ المقرِّ للاختبار',
      type: 'boolean',
    },
    {
      id: 'employeeCount',
      prompt: 'How many staff?',
      promptAr: 'سؤالُ العددِ للاختبار',
      type: 'number',
    },
    {
      id: 'handlesPersonalOrPaymentData',
      prompt: 'Holds card data?',
      promptAr: 'سؤالُ البياناتِ للاختبار',
      type: 'boolean',
    },
  ],
  coverageLines: ['Property All Risks (Fire)', 'Workers Compensation', 'Cyber'],
};

const DRAFT_ASSESSMENT = {
  id: 'na-1',
  riskProfileId: 'rp-1',
  customerId: 'cust-1',
  questionnaireAnswers: {
    ownsOrLeasesPremises: true,
    employeeCount: 10,
    handlesPersonalOrPaymentData: false,
  },
  recommendedCoverageLines: [
    'Property All Risks (Fire)',
    'Workers Compensation',
  ],
  status: 'DRAFT',
  createdByUserId: 'user-1',
  reviewedByUserId: null,
  approvedByUserId: null,
  // The endpoint returns both now. Null on a DRAFT: nothing has reviewed or approved it.
  reviewerCombinedDutyAct: null,
  approverCombinedDutyAct: null,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
};

async function mockQuestionnaire(page: Page) {
  await page.route('**/needs-assessments/questionnaire', (route) =>
    route.fulfill({ status: 200, json: QUESTIONNAIRE }),
  );
}

test('renders the needs assessments list and opens a detail on click', async ({
  page,
}) => {
  await mockAuth(page, ['SALES_RELATIONSHIP_OFFICER']);
  await mockQuestionnaire(page);
  await page.route('http://localhost:4000/needs-assessments', (route) =>
    route.fulfill({ status: 200, json: [DRAFT_ASSESSMENT] }),
  );
  await page.route('http://localhost:4000/needs-assessments/na-1', (route) =>
    route.fulfill({ status: 200, json: DRAFT_ASSESSMENT }),
  );
  await page.route('http://localhost:4000/consent-records**', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route('http://localhost:4000/privacy-notices/current**', (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );

  await page.goto('/needs-assessments');
  await expect(
    page.getByRole('heading', { name: 'Needs assessments' }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'View the needs assessment recorded on 01/02/2026',
    })
    .click();

  await expect(page).toHaveURL('/needs-assessments/na-1');
  await expect(page.getByText('Property All Risks (Fire)')).toBeVisible();
});

test('shows an empty state when there are none', async ({ page }) => {
  await mockAuth(page, ['SALES_RELATIONSHIP_OFFICER']);
  await page.route('http://localhost:4000/needs-assessments', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto('/needs-assessments');
  await expect(page.getByText('No needs assessments yet.')).toBeVisible();
});

test('shows a friendly message when the user lacks read permission', async ({
  page,
}) => {
  await mockAuth(page, ['CLAIMS_OFFICER']);
  await page.route('http://localhost:4000/needs-assessments', (route) =>
    route.fulfill({
      status: 403,
      json: {
        message: 'You do not hold a permission required to perform this action',
      },
    }),
  );

  await page.goto('/needs-assessments');
  await expect(page.locator('p[role="alert"]')).toContainText(
    "(needs-assessment.read)",
  );
});

test('the new-assessment flow: pick a risk profile, answer the questionnaire, land on the detail', async ({
  page,
}) => {
  await mockAuth(page, ['SALES_RELATIONSHIP_OFFICER']);
  await mockQuestionnaire(page);
  await page.route('**/risk-profiles*', (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: 'rp-1',
          customerId: 'cust-1',
          siteLabel: 'Head office',
          priorClaimsHistorySummary: null,
          createdAt: '',
          updatedAt: '',
        },
      ],
    }),
  );
  await page.route('http://localhost:4000/needs-assessments', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 201, json: DRAFT_ASSESSMENT });
    }
    return route.fulfill({ status: 200, json: [] });
  });
  await page.route('http://localhost:4000/needs-assessments/na-1', (route) =>
    route.fulfill({ status: 200, json: DRAFT_ASSESSMENT }),
  );
  await page.route('http://localhost:4000/consent-records**', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route('http://localhost:4000/privacy-notices/current**', (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );

  await page.goto('/needs-assessments/new?customerId=cust-1');
  await expect(
    page.getByRole('heading', { name: 'New needs assessment' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Risk questionnaire' }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: 'Save draft & see recommended cover' })
    .click();
  await expect(page).toHaveURL('/needs-assessments/na-1');
  await expect(page.getByText('Recommended coverage')).toBeVisible();
});

test('a manager sees the review panel for an assessment pending review', async ({
  page,
}) => {
  await mockAuth(page, ['BRANCH_DEPARTMENT_MANAGER']);
  await mockQuestionnaire(page);
  const pending = {
    ...DRAFT_ASSESSMENT,
    status: 'PENDING_REVIEW',
    createdByUserId: 'someone-else',
  };
  await page.route('http://localhost:4000/needs-assessments/na-1', (route) =>
    route.fulfill({ status: 200, json: pending }),
  );
  await page.route('http://localhost:4000/consent-records**', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route('http://localhost:4000/privacy-notices/current**', (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );

  await page.goto('/needs-assessments/na-1');
  await expect(
    page.getByRole('heading', { name: 'Review & approval' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Mark reviewed' }),
  ).toBeVisible();
});

test('needs assessment list and detail screens have no serious/critical accessibility violations @a11y', async ({
  page,
}) => {
  await mockAuth(page, ['SALES_RELATIONSHIP_OFFICER']);
  await mockQuestionnaire(page);
  await page.route('http://localhost:4000/needs-assessments', (route) =>
    route.fulfill({ status: 200, json: [DRAFT_ASSESSMENT] }),
  );
  await page.route('http://localhost:4000/needs-assessments/na-1', (route) =>
    route.fulfill({ status: 200, json: DRAFT_ASSESSMENT }),
  );
  await page.route('http://localhost:4000/consent-records**', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route('http://localhost:4000/privacy-notices/current**', (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );

  await page.goto('/needs-assessments');
  await expect(page.getByText('Status: DRAFT')).toBeVisible();
  const listResults = await new AxeBuilder({ page }).analyze();
  expect(
    listResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    ),
  ).toEqual([]);

  await page.goto('/needs-assessments/na-1');
  await expect(page.getByText('Recommended coverage')).toBeVisible();
  const detailResults = await new AxeBuilder({ page }).analyze();
  expect(
    detailResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    ),
  ).toEqual([]);
});

test("the questionnaire's first control is reachable via keyboard", async ({
  page,
}) => {
  await mockAuth(page, ['SALES_RELATIONSHIP_OFFICER']);
  await mockQuestionnaire(page);
  await page.route('**/risk-profiles*', (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: 'rp-1',
          customerId: 'cust-1',
          siteLabel: 'Head office',
          priorClaimsHistorySummary: null,
          createdAt: '',
          updatedAt: '',
        },
      ],
    }),
  );
  await page.route('http://localhost:4000/needs-assessments', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto('/needs-assessments/new?customerId=cust-1');
  const firstRadio = page.getByRole('radio', { name: 'Yes' }).first();
  await firstRadio.focus();
  await expect(firstRadio).toBeFocused();
});

/*
 * THE TWO COMBINED-DUTY ACTS ON A NEEDS ASSESSMENT — Part 4 step 5, pairs fourteen and fifteen.
 *
 * `NeedsAssessment` is the ONLY table of the sixteen carrying two pairs:
 * `NeedsAssessment_reviewer_maker_checker_distinct` (the capturer is not the reviewer) and
 * `NeedsAssessment_approver_maker_checker_distinct` (the capturer is not the approver). It therefore has
 * two escape columns, deliberately — one shared column would let a declared combined REVIEW excuse a
 * self-APPROVAL, which is why there are fifteen columns and not fourteen.
 *
 * **So the record shows them SEPARATELY**, and the test that matters is the third one below: a declared
 * review on an assessment whose approval was ordinary must declare under the REVIEWER row and stay silent
 * under the approver row. A single merged field would pass the first two tests and fail that one.
 */

const REVIEWER_ACT = {
  id: 'cda-na-rev',
  at: '2026-02-03T00:00:00.000Z',
  actorUserId: 'user-1',
  reason:
    'Sole officer covering this branch; the client needed the programme the same week.',
  pair: 'NeedsAssessment_reviewer_maker_checker_distinct',
  roles: ['BRANCH_DEPARTMENT_MANAGER'],
  hatAmbiguous: false,
};

const APPROVER_ACT = {
  id: 'cda-na-app',
  at: '2026-02-04T00:00:00.000Z',
  actorUserId: 'user-1',
  reason:
    'Same officer approved it; no second senior officer is employed in this office.',
  pair: 'NeedsAssessment_approver_maker_checker_distinct',
  roles: ['BRANCH_DEPARTMENT_MANAGER'],
  hatAmbiguous: false,
};

async function openAssessment(page: Page, over: Record<string, unknown>) {
  const assessment = { ...DRAFT_ASSESSMENT, ...over };
  await mockQuestionnaire(page);
  await page.route('http://localhost:4000/needs-assessments', (route) =>
    route.fulfill({ status: 200, json: [assessment] }),
  );
  await page.route('http://localhost:4000/needs-assessments/na-1', (route) =>
    route.fulfill({ status: 200, json: assessment }),
  );
  await page.route('http://localhost:4000/consent-records**', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route('http://localhost:4000/privacy-notices/current**', (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );
  await page.goto('/needs-assessments/na-1');
}

test('shows that one person both captured and reviewed an assessment, and why', async ({
  page,
}) => {
  await mockAuth(page, ['SALES_RELATIONSHIP_OFFICER']);
  await openAssessment(page, {
    status: 'REVIEWED',
    reviewedByUserId: 'user-1',
    reviewerCombinedDutyAct: REVIEWER_ACT,
  });

  const declared = page.getByTestId('combined-duty-assessment-reviewer');
  await expect(declared).toContainText('BRANCH_DEPARTMENT_MANAGER');
  await expect(declared).toContainText('Sole officer covering this branch');
  await expect(declared).toHaveAttribute(
    'data-combined-duty-pair',
    'NeedsAssessment_reviewer_maker_checker_distinct',
  );
});

test('shows that one person both captured and approved an assessment, and why', async ({
  page,
}) => {
  await mockAuth(page, ['SALES_RELATIONSHIP_OFFICER']);
  await openAssessment(page, {
    status: 'APPROVED',
    reviewedByUserId: 'user-9',
    approvedByUserId: 'user-1',
    approverCombinedDutyAct: APPROVER_ACT,
  });

  const declared = page.getByTestId('combined-duty-assessment-approver');
  await expect(declared).toContainText('no second senior officer');
  await expect(declared).toHaveAttribute(
    'data-combined-duty-pair',
    'NeedsAssessment_approver_maker_checker_distinct',
  );
});

test('a declared REVIEW does not declare anything about the approval', async ({
  page,
}) => {
  await mockAuth(page, ['SALES_RELATIONSHIP_OFFICER']);
  await openAssessment(page, {
    status: 'APPROVED',
    // The capturer reviewed her own assessment and said why; somebody ELSE approved it.
    reviewedByUserId: 'user-1',
    reviewerCombinedDutyAct: REVIEWER_ACT,
    approvedByUserId: 'user-9',
    // Decision 48's resolved name. The api sends it; the screen renders it INSTEAD of the
    // id, which is the whole of group 7.
    approvedByName: 'Layla Al-Checker',
    approverCombinedDutyAct: null,
  });

  // THIS IS WHAT THE TWO COLUMNS ARE FOR. The reviewer row declares; the approver row does not. A single
  // merged field would satisfy the two tests above and fail here — it would report the approval as
  // doubled up when a second person really did approve it.
  await expect(
    page.getByTestId('combined-duty-assessment-reviewer'),
  ).toBeVisible();
  await expect(
    page.getByTestId('combined-duty-assessment-approver'),
  ).toHaveCount(0);
  /*
   * RE-POINTED, and this one is a REAL REVERSAL rather than a moved selector. It asserted
   * `getByText('user-9')` — the uuid — as a READY ANCHOR from the same read, which worked
   * only because the uuid WAS the text in that cell. That is the defect the owner read with
   * her own eyes under «اعتمده», and `rendered-identifiers.py` reported this screen clean
   * because its ternary exclusion treated `??` as a ternary.
   *
   * The anchor's JOB is unchanged — prove the approver row rendered, from the same read, so
   * the absence assertion above cannot pass against an unhydrated page. What changed is that
   * the cell now holds a NAME, and the id is additionally asserted ABSENT, because an anchor
   * that merely moved would not catch the fallback coming back.
   */
  const approverCell = page.locator('[data-approver-value]');
  await expect(approverCell).toContainText('Layla Al-Checker');
  // SCOPED, not page-wide: `check:absence` refuses the page-wide form and was right to
  // here, because the fixture's own `approvedByUserId` is still on the wire and a
  // page-wide match could find it in a `data-*` attribute rather than in the cell.
  await expectAbsentWithin(approverCell, (s) => s.getByText('user-9'));
});

/*
 * ONE TEST, THREE RENDER SITES, AND THE SPLIT I FIRST WROTE WAS BASED ON A MISREADING.
 *
 * I had two tests on the belief that the read-back answer list was APPROVED-only. It is not:
 * `assessment.status === 'APPROVED' && !isPlacement` gates a NOTE above it, and the answers
 * section renders unconditionally. A DRAFT therefore shows the FORM and the ANSWER LIST at once,
 * which Playwright reported as a strict-mode violation — the third prompt resolving to a
 * `<legend>` and an `<li>` — rather than my reading catching it.
 *
 * SO EACH HALF IS SCOPED TO ITS OWN SURFACE. Two legitimate elements carrying one string is not
 * a defect, and `.first()` would have hidden which surface was being asserted about.
 *
 * The sites, all three of which printed `{q.prompt}` unconditionally before this:
 *   the form's number branch   a <label>
 *   the form's boolean branch  a <legend>
 *   the read-back answer list  an <li>
 *
 * NO GATE COULD SEE ANY OF THEM: these strings arrive from the API at runtime and
 * `hardcoded-ui-english.py` reads SOURCE, so it is blind to every server-supplied display
 * string in the product. The questionnaire is the instance that was found, not the class.
 *
 * A PAIR PER SURFACE: the Arabic present AND the English gone. Presence alone passes against a
 * screen rendering both; absence alone passes against one rendering neither.
 */
const AR_FIXTURE_PROMPTS = [
  'سؤالُ المقرِّ للاختبار',
  'سؤالُ العددِ للاختبار',
  'سؤالُ البياناتِ للاختبار',
];
const EN_FIXTURE_PROMPTS = [
  'Own or lease premises?',
  'How many staff?',
  'Holds card data?',
];

async function mockAuthAr(page: Page, roles: string[]) {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'fake-access-token' } }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        languagePreference: 'AR',
        roles,
        permissions: permissionsForRoles(roles),
      },
    }),
  );
}

test('asks the questions in Arabic at all three render sites, and answers them in Arabic too', async ({
  page,
}) => {
  await mockAuthAr(page, ['SALES_RELATIONSHIP_OFFICER']);
  // A DRAFT the viewer created: the only state that renders the form, and it renders the
  // answer list beside it.
  await openAssessment(page, {});

  const form = page.locator('main form');
  // `main ul` is AMBIGUOUS here: the recommended-coverage list is a `<ul>` too, which
  // Playwright reported as a strict-mode violation rather than my reading catching it.
  const answers = page.getByTestId('assessment-answers');

  for (const ar of AR_FIXTURE_PROMPTS) {
    await expect(form.getByText(ar)).toBeVisible();
    await expect(answers.getByText(ar)).toBeVisible();
  }
  for (const english of EN_FIXTURE_PROMPTS) {
    await expectAbsentWithin(form, (scope) => scope.getByText(english));
    await expectAbsentWithin(answers, (scope) => scope.getByText(english));
  }

  /*
   * AND THE ANSWERS THEMSELVES — found while converting the prompts, on the same row.
   * `Yes`/`No` were hardcoded English in that `<li>`, so an Arabic question was answered in
   * English while `commonYes`/`commonNo` had shipped in both languages for months. Asserted as
   * a pair for the same reason the prompts are.
   */
  // EXACT, and the reason is the fixture's own text: «لا» is a SUBSTRING of «للاختبار», so a
  // substring match resolved to three elements. Playwright reported it; my reading did not.
  await expect(answers.getByText('لا', { exact: true })).toBeVisible();
  await expect(answers.getByText('نعم', { exact: true })).toBeVisible();
  for (const english of ['Yes', 'No']) {
    await expectAbsentWithin(answers, (scope) =>
      scope.getByText(english, { exact: true }),
    );
  }
});

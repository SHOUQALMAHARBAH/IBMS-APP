import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { permissionsForRoles } from './fixtures/role-permissions';

const ME_BASE = {
  id: 'user-1',
  email: 'admin@ibms.test',
  fullName: 'Security Admin',
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

const EMPLOYEE_ROW = {
  id: 'emp-1',
  fullName: 'Jane Employee',
  position: 'Placement Officer',
  hireDate: '2020-06-01T00:00:00.000Z',
  terminationDate: null,
  // NOT a CBJ approval any more. Module 0 item (g) moved that fact into a structured marker and
  // the api REFUSES CBJ-ish text here, so a fixture carrying it would be a state the real endpoint
  // can no longer produce — and a mock that cannot happen is a screen tested against fiction.
  licensedRole: 'Chartered Insurance Institute, Dip CII',
};

const EMPLOYEE_DETAIL = {
  ...EMPLOYEE_ROW,
  nationalId: '***4321',
  confidentialityAgreementSignedAt: null,
  backgroundCheckCompletedAt: null,
  createdAt: '2020-06-01T09:00:00.000Z',
  updatedAt: '2020-06-01T09:00:00.000Z',
  trainings: [
    {
      id: 'trn-1',
      employeeId: 'emp-1',
      trainingName: 'Phishing awareness',
      dueAt: null,
      completedAt: null,
    },
  ],
  deprovisioningChecklist: null,
  // Module 0 item (g). Shaped from the endpoint, not approximated: `types` is DERIVED by the server
  // from the branches' categories, which is why LIFE is listed second here even though the LIFE
  // branch is first in the list.
  cbjApproval: {
    status: 'CURRENT',
    approvalDate: '2024-09-15',
    types: ['GENERAL', 'LIFE'],
    branches: [
      {
        id: 'br-life',
        insuranceLineId: 'line-life',
        officeInsuranceLineId: null,
        category: 'LIFE',
        nameEn: 'Individual life',
        nameAr: 'تأمين الحياة الفردي',
        code: 'LIFE_INDIVIDUAL',
      },
      {
        id: 'br-motor',
        insuranceLineId: 'line-motor',
        officeInsuranceLineId: null,
        category: 'GENERAL',
        nameEn: 'Motor comprehensive',
        nameAr: 'تأمين المركبات الشامل',
        code: 'MOTOR_COMPREHENSIVE',
      },
    ],
    countsTowardMinimumStaff: true,
  },
};

/** The catalogue the approval panel's add-a-branch select reads. */
const INSURANCE_LINES = [
  {
    id: 'line-motor',
    code: 'MOTOR_COMPREHENSIVE',
    nameEn: 'Motor comprehensive',
    nameAr: 'تأمين المركبات الشامل',
    category: 'GENERAL',
    isStandard: true,
  },
];

/**
 * An EXACT permission set rather than a role's.
 *
 * `employee.read` and `employee.update` are held by the same three seeded roles, so "may read the
 * record and may not correct it" is a state NO ROLE NAME describes — and it is precisely what an
 * office creates the first time it uses the Role screen. Same reason `sla-policies.spec.ts` has
 * one of these.
 */
async function mockAuthWithCodes(page: Page, permissions: string[]) {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'fake-access-token' } }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        roles: ['SYSTEM_SECURITY_ADMINISTRATOR'],
        permissions,
      },
    }),
  );
}

/** The detail read plus the two sibling reads the page makes, so no request escapes. */
async function mockDetail(page: Page, detail: Record<string, unknown>) {
  await page.route('http://localhost:4000/employees/emp-1', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, json: detail });
  });
  await page.route(
    'http://localhost:4000/employees/emp-1/deprovisioning-checklist',
    (route) => route.fulfill({ status: 200, json: null }),
  );
  // Module 0 item (g)'s panel reads the line catalogue for its add-a-branch select. Named with the
  // API ORIGIN, not `**/insurance-lines`: a bare pattern also matches a PAGE path that shares the
  // noun, and Playwright then serves the mocked JSON as the document — item (e) was bitten by
  // exactly that and the page rendered raw JSON with no error.
  await page.route('http://localhost:4000/insurance-lines', (route) =>
    route.fulfill({ status: 200, json: INSURANCE_LINES }),
  );
}

/*
 * CORRECTING AN EMPLOYEE RECORD — `PATCH /employees/:id`, which had no web caller, so a person
 * could be registered and never corrected. Only the nested training and de-provisioning paths were
 * reachable.
 */

test('prefills the correction from the record, because these values are not masked', async ({
  page,
}) => {
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await mockDetail(page, EMPLOYEE_DETAIL);
  await page.goto('/employees/emp-1');

  await page.getByTestId('correct-employee-open').click();
  // The contrast with the customer contact correction, which prefills NOTHING: a customer's phone
  // arrives masked, so prefilling would write the mask back as their phone number. These arrive in
  // the clear, so the current value is the right starting point — retyping a field you are not
  // changing is how an unrelated field gets changed by accident.
  await expect(page.getByTestId('correct-position')).toHaveValue(
    'Placement Officer',
  );
  await expect(page.getByTestId('correct-licensed-role')).toHaveValue(
    'Chartered Insurance Institute, Dip CII',
  );
});

test('sends ONLY the field that changed', async ({ page }) => {
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await mockDetail(page, EMPLOYEE_DETAIL);

  let body: unknown = null;
  await page.route('http://localhost:4000/employees/emp-1', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    body = route.request().postDataJSON();
    return route.fulfill({ status: 200, json: EMPLOYEE_DETAIL });
  });
  await page.goto('/employees/emp-1');

  await page.getByTestId('correct-employee-open').click();
  await page
    .getByTestId('correct-position')
    .fill('  Senior Placement Officer  ');
  await page.getByTestId('correct-employee-save').click();
  await expect(page.getByTestId('correct-employee-form')).toHaveCount(0);

  expect(body).toEqual({ position: 'Senior Placement Officer' });
  // The licensed role and both compliance dates must be ABSENT, not resent. A PATCH that resends
  // every field re-stamps an undertaking date because somebody fixed a job title.
  expect(body).not.toHaveProperty('licensedRole');
  expect(body).not.toHaveProperty('confidentialityAgreementSignedAt');
  expect(body).not.toHaveProperty('backgroundCheckCompletedAt');
});

test('refuses to save while nothing has changed', async ({ page }) => {
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await mockDetail(page, EMPLOYEE_DETAIL);
  await page.goto('/employees/emp-1');

  await page.getByTestId('correct-employee-open').click();
  // "Nothing to correct" and "corrected" must not look the same to somebody who came to fix a
  // record — the same reason the customer correction answers an empty patch with a 422.
  await expect(page.getByTestId('correct-employee-save')).toBeDisabled();

  await page.getByTestId('correct-position').fill('Senior Placement Officer');
  await expect(page.getByTestId('correct-employee-save')).toBeEnabled();

  // Typing the ORIGINAL value back is not a change either, so the button must go quiet again.
  await page.getByTestId('correct-position').fill('Placement Officer');
  await expect(page.getByTestId('correct-employee-save')).toBeDisabled();
});

test('neither compliance date can be set in the future', async ({ page }) => {
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await mockDetail(page, EMPLOYEE_DETAIL);
  await page.goto('/employees/emp-1');

  await page.getByTestId('correct-employee-open').click();
  // The server refuses a future value outright — these are records of something that already
  // happened — so the control says so rather than letting the reader find out through a 422.
  const today = new Date().toISOString().slice(0, 10);
  await expect(page.getByTestId('correct-confidentiality')).toHaveAttribute(
    'max',
    today,
  );
  await expect(page.getByTestId('correct-background-check')).toHaveAttribute(
    'max',
    today,
  );
});

test('a reader who may see the record but not correct it is offered no control', async ({
  page,
}) => {
  await mockAuthWithCodes(page, ['employee.read']);
  await mockDetail(page, EMPLOYEE_DETAIL);
  await page.goto('/employees/emp-1');

  // Anchored on the record rendering, so the absence cannot pass on a page that never mounted.
  await expect(page.getByText('Placement Officer')).toBeVisible();
  await expect(page.getByTestId('correct-employee-open')).toHaveCount(0);
});

test('renders the employee list with the create form', async ({ page }) => {
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await page.route('http://localhost:4000/employees', (route) =>
    route.fulfill({ status: 200, json: [EMPLOYEE_ROW] }),
  );

  await page.goto('/employees');
  await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Jane Employee' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Record a new employee' }),
  ).toBeVisible();
});

test('a user without the permission sees a friendly message', async ({
  page,
}) => {
  await mockAuth(page, ['SALES_RELATIONSHIP_OFFICER']);
  await page.route('http://localhost:4000/employees', (route) =>
    route.fulfill({ status: 403, json: { message: 'no' } }),
  );

  await page.goto('/employees');
  await expect(
    page.getByText('(employee.read)', { exact: false }),
  ).toBeVisible();
});

test('employee detail: ticks a checklist item, and hides the reveal from an administrator', async ({
  page,
}) => {
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);

  interface Checklist {
    id: string;
    employeeId: string;
    triggeredAt: string;
    systemAccessRevokedAt: string | null;
    physicalAccessRevokedAt: string | null;
    deviceReturnedAt: string | null;
    knowledgeTransferDoneAt: string | null;
    completedAt: string | null;
  }
  let checklist: Checklist = {
    id: 'chk-1',
    employeeId: 'emp-1',
    triggeredAt: '2026-09-16T09:00:00.000Z',
    systemAccessRevokedAt: null,
    physicalAccessRevokedAt: null,
    deviceReturnedAt: null,
    knowledgeTransferDoneAt: null,
    completedAt: null,
  };
  await page.route('http://localhost:4000/employees/emp-1', (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...EMPLOYEE_DETAIL,
        terminationDate: '2026-09-16T09:00:00.000Z',
        deprovisioningChecklist: checklist,
      },
    }),
  );
  await page.route(
    'http://localhost:4000/employees/emp-1/deprovisioning-checklist',
    (route) => {
      checklist = {
        ...checklist,
        systemAccessRevokedAt: '2026-09-16T10:00:00.000Z',
      };
      return route.fulfill({ status: 200, json: checklist });
    },
  );

  await page.goto('/employees/emp-1');
  await expect(
    page.getByRole('heading', { name: 'Jane Employee' }),
  ).toBeVisible();

  // Part 10.2 — the national-ID reveal is `employee.national-id.reveal`, which
  // the administrator does not hold. The form must be ABSENT, not merely
  // unusable: a control that 403s on submit is the dead control the UX directive
  // rules out, and it is also how this gap looked before the split.
  await expect(
    page.getByRole('heading', { name: 'Reveal national ID' }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reveal' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Mark done' }).first().click();
  await expect(page.getByText('System access revoked: Yes')).toBeVisible();
});

test('employee detail: Compliance holds the reveal and gets the real value', async ({
  page,
}) => {
  await mockAuth(page, ['COMPLIANCE_OFFICER']);
  await page.route(
    'http://localhost:4000/employees/emp-1/reveal-field',
    (route) =>
      route.fulfill({
        status: 201,
        json: { field: 'nationalId', value: '9988774321' },
      }),
  );
  await page.route('http://localhost:4000/employees/emp-1', (route) =>
    route.fulfill({ status: 200, json: EMPLOYEE_DETAIL }),
  );

  await page.goto('/employees/emp-1');
  await expect(
    page.getByRole('heading', { name: 'Jane Employee' }),
  ).toBeVisible();

  await page
    .getByLabel(/Reason/)
    .fill('KYC audit cross-check requested by Compliance');
  await page.getByRole('button', { name: 'Reveal' }).click();
  await expect(page.getByText('Full value: 9988774321')).toBeVisible();
});

test('employees list has no serious/critical accessibility violations @a11y', async ({
  page,
}) => {
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await page.route('http://localhost:4000/employees', (route) =>
    route.fulfill({ status: 200, json: [EMPLOYEE_ROW] }),
  );

  await page.goto('/employees');
  await expect(page.getByRole('cell', { name: 'Jane Employee' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    ),
  ).toEqual([]);
});

/*
 * MODULE 0 ITEM (g) — THE CBJ APPROVAL MARKER on a person's own record.
 */

test('shows the CBJ approval with its DERIVED types in catalogue order', async ({
  page,
}) => {
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await mockDetail(page, EMPLOYEE_DETAIL);
  await page.goto('/employees/emp-1');

  await expect(page.locator('[data-cbj-approval-status]')).toContainText(
    'Current',
  );
  await expect(page.locator('[data-cbj-approval-date]')).toContainText(
    '2024-09-15',
  );
  // CATALOGUE order, not insertion order — the LIFE branch is first in the list and GENERAL still
  // comes first here, which is what proves the type is derived and ordered rather than echoed.
  await expect(page.locator('[data-cbj-approval-types]')).toHaveText(
    'General · Life',
  );
  await expect(page.locator('[data-cbj-approval-branches]')).toContainText(
    'Individual life',
  );
  await expect(page.locator('[data-cbj-approval-branches]')).toContainText(
    'Motor comprehensive',
  );
  // CURRENT counts, so the "does not count" note is absent.
  await expect(page.locator('[data-cbj-approval-not-counted]')).toHaveCount(0);
});

test('an UNRECORDED approval date says so rather than showing a dash', async ({
  page,
}) => {
  // The distinction 54 migrated rows are in: a status whose date nobody recorded. An em dash reads
  // as "there is no date"; this is "nobody has entered it", and only one of those is actionable.
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await mockDetail(page, {
    ...EMPLOYEE_DETAIL,
    cbjApproval: { ...EMPLOYEE_DETAIL.cbjApproval, approvalDate: null },
  });
  await page.goto('/employees/emp-1');
  await expect(page.locator('[data-cbj-approval-date]')).toContainText(
    'not recorded',
  );
});

test('a SUSPENDED approval keeps its record and says it stops counting', async ({
  page,
}) => {
  /*
   * The whole reason the marker carries a status rather than a boolean: the office must still be
   * able to say what this person was approved for after the CBJ stands them down, AND must be told
   * that they no longer count toward the minimum staff — otherwise an administrator reads a
   * suspension as cosmetic and cannot explain why adding a second insurance type was refused.
   */
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await mockDetail(page, {
    ...EMPLOYEE_DETAIL,
    cbjApproval: {
      ...EMPLOYEE_DETAIL.cbjApproval,
      status: 'SUSPENDED',
      countsTowardMinimumStaff: false,
    },
  });
  await page.goto('/employees/emp-1');

  await expect(page.locator('[data-cbj-approval-status]')).toContainText(
    'Suspended',
  );
  await expect(page.locator('[data-cbj-approval-not-counted]')).toContainText(
    'minimum approved staff',
  );
  // The branches and the date survive — this is the assertion that would fail if a suspension were
  // implemented by clearing the record.
  await expect(page.locator('[data-cbj-approval-branches]')).toContainText(
    'Individual life',
  );
  await expect(page.locator('[data-cbj-approval-date]')).toContainText(
    '2024-09-15',
  );
});

test('a person with NO approval reads as an answer, and offers no branch form', async ({
  page,
}) => {
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await mockDetail(page, {
    ...EMPLOYEE_DETAIL,
    cbjApproval: {
      status: null,
      approvalDate: null,
      types: [],
      branches: [],
      countsTowardMinimumStaff: false,
    },
  });
  await page.goto('/employees/emp-1');

  await expect(page.locator('[data-cbj-approval-none]')).toContainText(
    'No CBJ approval is recorded',
  );
  // A branch cannot belong to an approval that does not exist — the api refuses it with a 422, and
  // the screen does not offer the control that would earn that refusal.
  await expect(page.getByLabel('Add a branch', { exact: true })).toHaveCount(0);
  // ...nor a withdraw button for an approval nobody holds.
  await expect(page.locator('[data-cbj-approval-withdraw]')).toHaveCount(0);
});

test('WITHDRAWING sends an explicit null, which is what the api reads as a withdrawal', async ({
  page,
}) => {
  // The api treats an ABSENT status as "leave it alone". If this button sent `{}` the approval would
  // stay exactly as it is and the screen would report success — a control that does nothing.
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  await mockDetail(page, EMPLOYEE_DETAIL);

  let body: unknown = null;
  const WITHDRAWN = {
    status: null,
    approvalDate: null,
    types: [],
    branches: [],
    countsTowardMinimumStaff: false,
  };
  /*
   * The DETAIL read has to reflect the withdrawal, because the panel renders its parent's
   * `employee.cbjApproval` and the page re-reads the person after every change. A mock that kept
   * returning the old approval made the first version of this test assert a render the fixture could
   * never produce — and that is the panel being RIGHT: it keeps no copy of the server's answer.
   */
  let withdrawn = false;
  await page.route('http://localhost:4000/employees/emp-1', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      json: withdrawn
        ? { ...EMPLOYEE_DETAIL, cbjApproval: WITHDRAWN }
        : EMPLOYEE_DETAIL,
    });
  });
  await page.route(
    'http://localhost:4000/employees/emp-1/cbj-approval',
    async (route) => {
      body = route.request().postDataJSON();
      withdrawn = true;
      return route.fulfill({ status: 200, json: WITHDRAWN });
    },
  );
  await page.goto('/employees/emp-1');
  await page.locator('[data-cbj-approval-withdraw]').click();
  await expect(page.locator('[data-cbj-approval-none]')).toBeVisible();
  expect(body).toEqual({ status: null, approvalDate: null });
});

test('a reader without employee.update sees the approval and no controls', async ({
  page,
}) => {
  // The directive's rule: a control a role cannot use does not exist on their screen. The FACT is
  // still readable, because knowing who is approved is not the same as being able to change it.
  // `mockAuthWithCodes`, not `mockAuth`: no ROLE NAME can express "can read a person, cannot
  // change their record" — and that is exactly the state an office creates the moment it uses the
  // Role screen, which is why this helper exists.
  await mockAuthWithCodes(page, ['employee.read']);
  await mockDetail(page, EMPLOYEE_DETAIL);
  await page.goto('/employees/emp-1');

  await expect(page.locator('[data-cbj-approval-status]')).toContainText(
    'Current',
  );
  await expect(page.locator('[data-cbj-approval-form]')).toHaveCount(0);
  await expect(page.locator('[data-cbj-approval-withdraw]')).toHaveCount(0);
});

test('an ABSENT cbjApproval is a stated state, and does not take the page down', async ({
  page,
}) => {
  /*
   * MODULE 0 ITEM (g), added after CI found it. `EmployeeDetail` is HAND-COPIED over an HTTP
   * response and TypeScript cannot check it, so a web build paired with an api that does not send
   * `cbjApproval` threw during render — taking down the reveal, the training list, the correction
   * form and the de-provisioning checklist along with the panel. Two specs whose mocks lacked the
   * field failed on CI and passed nowhere locally, because I had only run the specs I touched.
   *
   * It renders "the server did not send this" rather than "no approval on record", because those
   * are different facts and the second would be a wrong claim about a person's regulatory standing.
   */
  await mockAuth(page, ['SYSTEM_SECURITY_ADMINISTRATOR']);
  const { cbjApproval: _omitted, ...withoutApproval } = EMPLOYEE_DETAIL;
  await mockDetail(page, withoutApproval);
  await page.goto('/employees/emp-1');

  await expect(page.locator('[data-cbj-approval-unavailable]')).toContainText(
    'did not send',
  );
  // ...and it says it is NOT the same as having no approval, so nobody reads it as a finding.
  await expect(page.locator('[data-cbj-approval-unavailable]')).toContainText(
    'not the same as having no approval',
  );

  // THE REST OF THE PAGE SURVIVES — the half that matters, and the half a test asserting only the
  // notice would miss.
  await expect(page.getByTestId('correct-employee-open')).toBeVisible();
  await expect(page.getByText('Phishing awareness')).toBeVisible();
});

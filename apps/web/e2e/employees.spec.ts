import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

const ME_BASE = {
  id: "user-1",
  email: "admin@ibms.test",
  fullName: "Security Admin",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(page: Page, roles: string[]) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({ status: 200, json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) } }),
  );
}

const EMPLOYEE_ROW = {
  id: "emp-1",
  fullName: "Jane Employee",
  position: "Placement Officer",
  hireDate: "2020-06-01T00:00:00.000Z",
  terminationDate: null,
  licensedRole: "CBJ-licensed Broker Representative",
};

const EMPLOYEE_DETAIL = {
  ...EMPLOYEE_ROW,
  nationalId: "***4321",
  confidentialityAgreementSignedAt: null,
  backgroundCheckCompletedAt: null,
  createdAt: "2020-06-01T09:00:00.000Z",
  updatedAt: "2020-06-01T09:00:00.000Z",
  trainings: [
    { id: "trn-1", employeeId: "emp-1", trainingName: "Phishing awareness", dueAt: null, completedAt: null },
  ],
  deprovisioningChecklist: null,
};

/**
 * An EXACT permission set rather than a role's.
 *
 * `employee.read` and `employee.update` are held by the same three seeded roles, so "may read the
 * record and may not correct it" is a state NO ROLE NAME describes — and it is precisely what an
 * office creates the first time it uses the Role screen. Same reason `sla-policies.spec.ts` has
 * one of these.
 */
async function mockAuthWithCodes(page: Page, permissions: string[]) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        roles: ["SYSTEM_SECURITY_ADMINISTRATOR"],
        permissions,
      },
    }),
  );
}

/** The detail read plus the two sibling reads the page makes, so no request escapes. */
async function mockDetail(page: Page, detail: Record<string, unknown>) {
  await page.route("http://localhost:4000/employees/emp-1", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, json: detail });
  });
  await page.route(
    "http://localhost:4000/employees/emp-1/deprovisioning-checklist",
    (route) => route.fulfill({ status: 200, json: null }),
  );
}

/*
 * CORRECTING AN EMPLOYEE RECORD — `PATCH /employees/:id`, which had no web caller, so a person
 * could be registered and never corrected. Only the nested training and de-provisioning paths were
 * reachable.
 */

test("prefills the correction from the record, because these values are not masked", async ({
  page,
}) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await mockDetail(page, EMPLOYEE_DETAIL);
  await page.goto("/employees/emp-1");

  await page.getByTestId("correct-employee-open").click();
  // The contrast with the customer contact correction, which prefills NOTHING: a customer's phone
  // arrives masked, so prefilling would write the mask back as their phone number. These arrive in
  // the clear, so the current value is the right starting point — retyping a field you are not
  // changing is how an unrelated field gets changed by accident.
  await expect(page.getByTestId("correct-position")).toHaveValue(
    "Placement Officer",
  );
  await expect(page.getByTestId("correct-licensed-role")).toHaveValue(
    "CBJ-licensed Broker Representative",
  );
});

test("sends ONLY the field that changed", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await mockDetail(page, EMPLOYEE_DETAIL);

  let body: unknown = null;
  await page.route("http://localhost:4000/employees/emp-1", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    body = route.request().postDataJSON();
    return route.fulfill({ status: 200, json: EMPLOYEE_DETAIL });
  });
  await page.goto("/employees/emp-1");

  await page.getByTestId("correct-employee-open").click();
  await page.getByTestId("correct-position").fill("  Senior Placement Officer  ");
  await page.getByTestId("correct-employee-save").click();
  await expect(page.getByTestId("correct-employee-form")).toHaveCount(0);

  expect(body).toEqual({ position: "Senior Placement Officer" });
  // The licensed role and both compliance dates must be ABSENT, not resent. A PATCH that resends
  // every field re-stamps an undertaking date because somebody fixed a job title.
  expect(body).not.toHaveProperty("licensedRole");
  expect(body).not.toHaveProperty("confidentialityAgreementSignedAt");
  expect(body).not.toHaveProperty("backgroundCheckCompletedAt");
});

test("refuses to save while nothing has changed", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await mockDetail(page, EMPLOYEE_DETAIL);
  await page.goto("/employees/emp-1");

  await page.getByTestId("correct-employee-open").click();
  // "Nothing to correct" and "corrected" must not look the same to somebody who came to fix a
  // record — the same reason the customer correction answers an empty patch with a 422.
  await expect(page.getByTestId("correct-employee-save")).toBeDisabled();

  await page.getByTestId("correct-position").fill("Senior Placement Officer");
  await expect(page.getByTestId("correct-employee-save")).toBeEnabled();

  // Typing the ORIGINAL value back is not a change either, so the button must go quiet again.
  await page.getByTestId("correct-position").fill("Placement Officer");
  await expect(page.getByTestId("correct-employee-save")).toBeDisabled();
});

test("neither compliance date can be set in the future", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await mockDetail(page, EMPLOYEE_DETAIL);
  await page.goto("/employees/emp-1");

  await page.getByTestId("correct-employee-open").click();
  // The server refuses a future value outright — these are records of something that already
  // happened — so the control says so rather than letting the reader find out through a 422.
  const today = new Date().toISOString().slice(0, 10);
  await expect(page.getByTestId("correct-confidentiality")).toHaveAttribute(
    "max",
    today,
  );
  await expect(page.getByTestId("correct-background-check")).toHaveAttribute(
    "max",
    today,
  );
});

test("a reader who may see the record but not correct it is offered no control", async ({
  page,
}) => {
  await mockAuthWithCodes(page, ["employee.read"]);
  await mockDetail(page, EMPLOYEE_DETAIL);
  await page.goto("/employees/emp-1");

  // Anchored on the record rendering, so the absence cannot pass on a page that never mounted.
  await expect(page.getByText("Placement Officer")).toBeVisible();
  await expect(page.getByTestId("correct-employee-open")).toHaveCount(0);
});

test("renders the employee list with the create form", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/employees", (route) =>
    route.fulfill({ status: 200, json: [EMPLOYEE_ROW] }),
  );

  await page.goto("/employees");
  await expect(page.getByRole("heading", { name: "Employees" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Jane Employee" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Record a new employee" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/employees", (route) =>
    route.fulfill({ status: 403, json: { message: "no" } }),
  );

  await page.goto("/employees");
  await expect(
    page.getByText("employee.read permission", { exact: false }),
  ).toBeVisible();
});

test("employee detail: ticks a checklist item, and hides the reveal from an administrator", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);

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
    id: "chk-1",
    employeeId: "emp-1",
    triggeredAt: "2026-09-16T09:00:00.000Z",
    systemAccessRevokedAt: null,
    physicalAccessRevokedAt: null,
    deviceReturnedAt: null,
    knowledgeTransferDoneAt: null,
    completedAt: null,
  };
  await page.route("http://localhost:4000/employees/emp-1", (route) =>
    route.fulfill({
      status: 200,
      json: { ...EMPLOYEE_DETAIL, terminationDate: "2026-09-16T09:00:00.000Z", deprovisioningChecklist: checklist },
    }),
  );
  await page.route(
    "http://localhost:4000/employees/emp-1/deprovisioning-checklist",
    (route) => {
      checklist = { ...checklist, systemAccessRevokedAt: "2026-09-16T10:00:00.000Z" };
      return route.fulfill({ status: 200, json: checklist });
    },
  );

  await page.goto("/employees/emp-1");
  await expect(page.getByRole("heading", { name: "Jane Employee" })).toBeVisible();

  // Part 10.2 — the national-ID reveal is `employee.national-id.reveal`, which
  // the administrator does not hold. The form must be ABSENT, not merely
  // unusable: a control that 403s on submit is the dead control the UX directive
  // rules out, and it is also how this gap looked before the split.
  await expect(
    page.getByRole("heading", { name: "Reveal national ID" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reveal" })).toHaveCount(0);

  await page.getByRole("button", { name: "Mark done" }).first().click();
  await expect(page.getByText("System access revoked: Yes")).toBeVisible();
});

test("employee detail: Compliance holds the reveal and gets the real value", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/employees/emp-1/reveal-field", (route) =>
    route.fulfill({ status: 201, json: { field: "nationalId", value: "9988774321" } }),
  );
  await page.route("http://localhost:4000/employees/emp-1", (route) =>
    route.fulfill({ status: 200, json: EMPLOYEE_DETAIL }),
  );

  await page.goto("/employees/emp-1");
  await expect(page.getByRole("heading", { name: "Jane Employee" })).toBeVisible();

  await page.getByLabel(/Reason/).fill("KYC audit cross-check requested by Compliance");
  await page.getByRole("button", { name: "Reveal" }).click();
  await expect(page.getByText("Full value: 9988774321")).toBeVisible();
});

test("employees list has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/employees", (route) =>
    route.fulfill({ status: 200, json: [EMPLOYEE_ROW] }),
  );

  await page.goto("/employees");
  await expect(page.getByRole("cell", { name: "Jane Employee" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

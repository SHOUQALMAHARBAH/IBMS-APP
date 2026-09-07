import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles } }),
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
    page.getByText("employee.manage permission", { exact: false }),
  ).toBeVisible();
});

test("employee detail: reveals the national id and ticks a checklist item", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/employees/emp-1/reveal-field", (route) =>
    route.fulfill({ status: 201, json: { field: "nationalId", value: "9988774321" } }),
  );

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

  await page.getByLabel(/Reason/).fill("KYC audit cross-check requested by Compliance");
  await page.getByRole("button", { name: "Reveal" }).click();
  await expect(page.getByText("Full value: 9988774321")).toBeVisible();

  await page.getByRole("button", { name: "Mark done" }).first().click();
  await expect(page.getByText("System access revoked: Yes")).toBeVisible();
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

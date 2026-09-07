import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "manager@ibms.test",
  fullName: "Branch Manager",
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

const INSURER_SCORES = [
  {
    id: "score-1",
    insurerId: "ins-1",
    periodLabel: "2026-08",
    quoteResponseScore: "80.00",
    claimsServiceScore: "75.00",
    priceScore: "60.00",
    serviceQualityScore: "90.00",
    computedAt: "2026-09-01T00:00:00.000Z",
  },
];

const EMPLOYEE_RECORDS = [
  {
    id: "record-1",
    employeeId: "emp-1",
    periodLabel: "2026-08",
    newClients: 3,
    premiumWrittenJod: "15000.000",
    commissionEarnedJod: "2250.000",
    renewalRatePercent: "66.67",
    crossSellRatePercent: "50.00",
  },
];

test("renders both the insurer and employee performance sections", async ({ page }) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("http://localhost:4000/insurer-performance**", (route) =>
    route.fulfill({ status: 200, json: INSURER_SCORES }),
  );
  await page.route("http://localhost:4000/employee-performance**", (route) =>
    route.fulfill({ status: 200, json: EMPLOYEE_RECORDS }),
  );

  await page.goto("/dashboards/insurer-employee-performance");
  await expect(
    page.getByRole("heading", { name: "Insurer & Employee Performance Dashboard" }),
  ).toBeVisible();
  await expect(page.getByText("ins-1")).toBeVisible();
  await expect(page.getByText("90.00")).toBeVisible();
  await expect(page.getByText("emp-1")).toBeVisible();
  await expect(page.getByText("15000.000")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
});

test("applying the Insurer ID filter sends it only to the insurer-performance request", async ({ page }) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  let lastInsurerPerformanceUrl = "";
  let lastEmployeePerformanceUrl = "";
  await page.route("http://localhost:4000/insurer-performance**", (route) => {
    lastInsurerPerformanceUrl = route.request().url();
    return route.fulfill({ status: 200, json: INSURER_SCORES });
  });
  await page.route("http://localhost:4000/employee-performance**", (route) => {
    lastEmployeePerformanceUrl = route.request().url();
    return route.fulfill({ status: 200, json: EMPLOYEE_RECORDS });
  });

  await page.goto("/dashboards/insurer-employee-performance");
  await expect(page.getByText("ins-1")).toBeVisible();

  await page.getByLabel("Insurer ID filter").fill("ins-1");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("ins-1")).toBeVisible();

  expect(lastInsurerPerformanceUrl).toContain("insurerId=ins-1");
  expect(lastEmployeePerformanceUrl).not.toContain("insurerId");
});

test("a user without either permission sees the underlying error message", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await page.route("http://localhost:4000/insurer-performance**", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );
  await page.route("http://localhost:4000/employee-performance**", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/dashboards/insurer-employee-performance");
  await expect(
    page.getByText(
      "You don't hold the insurer-performance.view / employee-performance.view permissions.",
      { exact: false },
    ),
  ).toBeVisible();
});

test("insurer & employee performance dashboard has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("http://localhost:4000/insurer-performance**", (route) =>
    route.fulfill({ status: 200, json: INSURER_SCORES }),
  );
  await page.route("http://localhost:4000/employee-performance**", (route) =>
    route.fulfill({ status: 200, json: EMPLOYEE_RECORDS }),
  );

  await page.goto("/dashboards/insurer-employee-performance");
  await expect(page.getByText("emp-1")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

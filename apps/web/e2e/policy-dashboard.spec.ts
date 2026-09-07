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

const SUMMARY = {
  generatedAt: "2026-09-07T00:00:00.000Z",
  periodLabel: "2026-08",
  periodStart: "2026-08-01T00:00:00.000Z",
  periodEnd: "2026-09-01T00:00:00.000Z",
  renewalWindowDays: 90,
  activePoliciesCount: 240,
  expiringPoliciesCount: 18,
  newPoliciesIssuedCount: 12,
  cancelledPolicies: [
    {
      policyId: "pol-1",
      policyNumber: "POL-2026-001",
      insuranceLine: "motor",
      reason: "Client sold the insured vehicle.",
      cancelledAt: "2026-08-15T00:00:00.000Z",
    },
  ],
};

test("renders every metric section with real figures", async ({ page }) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("http://localhost:4000/dashboards/policy**", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dashboards/policy");
  await expect(page.getByRole("heading", { name: "Policy Dashboard" })).toBeVisible();
  await expect(page.getByText("240", { exact: true })).toBeVisible();
  await expect(page.getByText("18", { exact: true })).toBeVisible();
  await expect(page.getByText("12", { exact: true })).toBeVisible();
  await expect(page.getByText("POL-2026-001")).toBeVisible();
  await expect(page.getByText("Client sold the insured vehicle.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
});

test("a user without the permission sees the underlying error message", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await page.route("http://localhost:4000/dashboards/policy**", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/dashboards/policy");
  await expect(
    page.getByText("You don't hold the dashboard.policy.view permission.", { exact: false }),
  ).toBeVisible();
});

test("policy dashboard screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("http://localhost:4000/dashboards/policy**", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dashboards/policy");
  await expect(page.getByText("POL-2026-001")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

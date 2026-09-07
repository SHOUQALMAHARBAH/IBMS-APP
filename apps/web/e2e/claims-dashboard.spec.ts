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
  asOf: "2026-09-07T00:00:00.000Z",
  openClaimsCount: 14,
  closedClaimsCount: 52,
  outstandingClaimsValueJod: "37500.000",
  ageing: {
    d0_30: { count: 6, valueJod: "12000.000" },
    d31_60: { count: 4, valueJod: "9500.000" },
    d61_90: { count: 2, valueJod: "8000.000" },
    d90_plus: { count: 2, valueJod: "8000.000" },
  },
  lossRatioByClient: [
    { key: "cus-1", label: "Acme Ltd", periodClaims: "20000.000", periodPremium: "40000.000", ratio: "0.5000", ratioCapped: false, claimCount: 2, policyCount: 1 },
  ],
  lossRatioByLine: [
    { key: "motor", label: "motor", periodClaims: "20000.000", periodPremium: "40000.000", ratio: "0.5000", ratioCapped: false, claimCount: 2, policyCount: 1 },
  ],
  lossRatioByInsurer: [
    { key: "ins-1", label: "National Insurance", periodClaims: "20000.000", periodPremium: "40000.000", ratio: "0.5000", ratioCapped: false, claimCount: 2, policyCount: 1 },
  ],
};

test("renders every metric section with real figures", async ({ page }) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("http://localhost:4000/dashboards/claims**", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dashboards/claims");
  await expect(page.getByRole("heading", { name: "Claims Dashboard" })).toBeVisible();
  await expect(page.getByText("14", { exact: true })).toBeVisible();
  await expect(page.getByText("52", { exact: true })).toBeVisible();
  await expect(page.getByText("37500.000 JOD")).toBeVisible();
  await expect(page.getByText("National Insurance")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
});

test("a user without the permission sees the underlying error message", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await page.route("http://localhost:4000/dashboards/claims**", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/dashboards/claims");
  await expect(
    page.getByText("You don't hold the dashboard.claims.view permission.", { exact: false }),
  ).toBeVisible();
});

test("claims dashboard screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("http://localhost:4000/dashboards/claims**", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dashboards/claims");
  await expect(page.getByText("National Insurance")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

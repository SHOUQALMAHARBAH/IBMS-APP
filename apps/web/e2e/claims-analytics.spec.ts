import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Claims Officer",
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

const BY_LINE = {
  groupBy: "line",
  rows: [
    {
      key: "Property All Risks",
      label: "Property All Risks",
      periodClaims: "50000.000",
      periodPremium: "60000.000",
      ratio: "0.8333",
      ratioCapped: false,
      claimCount: 3,
      policyCount: 2,
    },
    {
      key: "Motor Fleet",
      label: "Motor Fleet",
      periodClaims: "0.000",
      periodPremium: "10000.000",
      ratio: "0.0000",
      ratioCapped: false,
      claimCount: 0,
      policyCount: 1,
    },
  ],
  totals: {
    periodClaims: "50000.000",
    periodPremium: "70000.000",
    ratio: "0.7143",
    ratioCapped: false,
    claimCount: 3,
    policyCount: 3,
  },
};

const BY_CUSTOMER = {
  groupBy: "customer",
  rows: [
    {
      key: "beta",
      label: "Beta Co",
      periodClaims: "30000.000",
      periodPremium: "20000.000",
      ratio: "1.5000",
      ratioCapped: false,
      claimCount: 1,
      policyCount: 1,
    },
  ],
  totals: BY_LINE.totals,
};

async function mockAnalytics(
  page: Page,
  opts: { status?: number } = {},
) {
  await page.route(
    "http://localhost:4000/claims-analytics/loss-ratio**",
    (route) => {
      if (opts.status && opts.status !== 200) {
        return route.fulfill({ status: opts.status, json: { message: "no" } });
      }
      const url = route.request().url();
      const json = url.includes("groupBy=customer") ? BY_CUSTOMER : BY_LINE;
      return route.fulfill({ status: 200, json });
    },
  );
}

test("shows the loss-ratio breakdown and switches grouping", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await mockAnalytics(page);

  await page.goto("/claims-analytics");
  await expect(
    page.getByRole("heading", { name: "Claims analytics" }),
  ).toBeVisible();

  // default group-by=line
  await expect(page.getByRole("cell", { name: "Property All Risks" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "83.3%" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "JOD 50,000.000" }).first()).toBeVisible();
  // totals row
  await expect(page.getByRole("cell", { name: "71.4%" })).toBeVisible();

  // switch to by-customer
  await page.getByLabel("Group by").selectOption("customer");
  await expect(page.getByRole("cell", { name: "Beta Co" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "150.0%" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockAnalytics(page, { status: 403 });

  await page.goto("/claims-analytics");
  await expect(
    page.getByText("claims-analytics.view permission", { exact: false }),
  ).toBeVisible();
});

test("claims analytics screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await mockAnalytics(page);

  await page.goto("/claims-analytics");
  await expect(page.getByRole("cell", { name: "Property All Risks" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

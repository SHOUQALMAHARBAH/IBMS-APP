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
  generatedAt: "2026-09-13T06:00:00.000Z",
  byLine: [
    { key: "property", policyCount: 5, totalIssuedPremiumJod: "50000.000" },
    { key: "motor", policyCount: 3, totalIssuedPremiumJod: "9000.000" },
  ],
  byInsurer: [
    { key: "Jordan Insurance Co", policyCount: 6, totalIssuedPremiumJod: "45000.000" },
  ],
  byClientSegment: [
    { key: "CORPORATE", policyCount: 6, totalIssuedPremiumJod: "52000.000" },
    { key: "INDIVIDUAL", policyCount: 2, totalIssuedPremiumJod: "7000.000" },
  ],
  byGeography: [
    { key: "Amman Branch", policyCount: 8, totalIssuedPremiumJod: "59000.000" },
  ],
};

async function mockSummary(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/portfolio-analysis", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: SUMMARY });
  });
}

test("renders all four breakdowns", async ({ page }) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockSummary(page);

  await page.goto("/portfolio-analysis");
  await expect(
    page.getByRole("heading", { name: "Portfolio Analysis" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "property" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Jordan Insurance Co" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "CORPORATE" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Amman Branch" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockSummary(page, { status: 403 });

  await page.goto("/portfolio-analysis");
  await expect(
    page.getByText("portfolio-analysis.view permission", { exact: false }),
  ).toBeVisible();
});

test("portfolio analysis screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["EXECUTIVE_MANAGEMENT"]);
  await mockSummary(page);

  await page.goto("/portfolio-analysis");
  await expect(page.getByRole("cell", { name: "property" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

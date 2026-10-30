import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) } }),
  );
}

const SUMMARY = {
  generatedAt: "2026-09-07T00:00:00.000Z",
  /*
   * OWNER DECISION 58. NOT optional padding: the screen reads
   * `summary.metricScope.<metric>` for all thirteen figures, and a fixture without
   * it passes `undefined` as the scope — so the component silently takes its `'asOf'`
   * branch and every figure gets the WRONG clause. A false label, not a crash.
   *
   * All five are `'period'` here because the api's own header says the period
   * «applies to every metric» on this screen. `/dashboards/policy` is where the
   * asymmetry is real.
   */
  metricScope: {
    leads: "period",
    premiumWritten: "period",
    commissionIncomeJod: "period",
    crossSell: "period",
    upSell: "period",
  },
  // THE WINDOW IS AUGUST, deliberately NOT the month this test runs in: a fixture
  // whose label happened to be the current month could not tell a screen that reads
  // the api's label from one that computes its own.

  periodLabel: "2026-08",
  periodStart: "2026-08-01T00:00:00.000Z",
  periodEnd: "2026-09-01T00:00:00.000Z",
  leads: { newLeadsCount: 20, convertedToProspectCount: 5, conversionRatePercent: 25 },
  premiumWritten: { newJod: "5000.000", renewalJod: "3000.000", totalJod: "8000.000" },
  commissionIncomeJod: "800.000",
  crossSell: { totalCount: 10, convertedCount: 3, conversionRatePercent: 30 },
  upSell: { totalCount: 4, convertedCount: 1, conversionRatePercent: 25 },
};

test("renders every metric section with real figures", async ({ page }) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("http://localhost:4000/dashboards/sales**", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dashboards/sales");
  await expect(page.getByRole("heading", { name: "Sales Dashboard" })).toBeVisible();
  await expect(page.getByText("20", { exact: true })).toBeVisible();
  await expect(page.getByText("5000.000")).toBeVisible();
  await expect(page.getByText("JOD 800.000")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
});

test("a user without the permission sees the underlying error message", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await page.route("http://localhost:4000/dashboards/sales**", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/dashboards/sales");
  await expect(
    page.getByText("(dashboard.sales.view)", { exact: false }),
  ).toBeVisible();
});

test("sales dashboard screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("http://localhost:4000/dashboards/sales**", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dashboards/sales");
  await expect(page.getByText("JOD 800.000")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

/*
 * ==========================================================================
 * OWNER DECISION 58 — «قسم العملاء المحتملون بيطلع 0 مع إنه في عملاء محتملون
 * جدد و عملاء محوّلون»
 *
 * The count was right. Measured at the time: 120 leads, every one created
 * 6–17 October, against a default window of the PREVIOUS calendar month —
 * September, which held zero. The screen was telling the truth about a month
 * she had not asked about.
 *
 * AND IT ALREADY PRINTED ITS PERIOD, once, at the top, through
 * `ReportProvenance`'s `period` shape — and she still read it as broken. That
 * is the evidence this group rests on: a line at the top is not enough, and a
 * figure has to carry its own period in the same glance.
 * ==========================================================================
 */

test("«بيطلع 0» — every figure carries the period it belongs to, not just the line at the top", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("http://localhost:4000/dashboards/sales**", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dashboards/sales");

  // THE FIGURE IS STILL THERE — the anchor, from the same render. Without it every
  // clause assertion below could be satisfied by a page that never mounted.
  await expect(page.getByText("20", { exact: true })).toBeVisible();

  // The month NAME, not the api's `2026-08` label: `formatPeriodLabel` resolves it
  // through ICU, and the EN locale is what this test's `/auth/me` mock reports.
  const clause = page.getByTestId("dsal-leads-new");
  await expect(clause).toContainText("August 2026");
  await expect(clause).toContainText("during");
  // From the api's declaration, never the screen's judgement.
  await expect(clause).toHaveAttribute("data-figure-scope", "period");

  // NOT ONE FIGURE — all thirteen. A per-figure clause that only reached the first
  // card would look right in a screenshot and leave twelve bare numbers.
  const everyClause = page.locator("[data-figure-scope]");
  await expect(everyClause).toHaveCount(13);

  // AND THE WINDOW IS THE API'S, NOT THE SCREEN'S. The fixture says August while
  // this test runs in whatever month it runs in, so a screen computing its own
  // label would disagree here — which is the half that proves the default is
  // server-side and the screen only reports it.
  for (const id of ["dsal-premium-total", "dsal-commission", "dsal-upsell-rate"]) {
    await expect(page.getByTestId(id)).toContainText("August 2026");
  }
});

test("asks the api for NO period, so the server's current-month default is what a reader gets", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  let askedFor = "unset";
  await page.route("http://localhost:4000/dashboards/sales**", (route) => {
    askedFor = new URL(route.request().url()).search;
    return route.fulfill({ status: 200, json: SUMMARY });
  });

  await page.goto("/dashboards/sales");
  await expect(page.getByTestId("dsal-leads-new")).toBeVisible();

  /*
   * The DEFAULT itself is `currentUtcMonthRange` in `sales-dashboard.service.ts`, and
   * `period-default.inventory.spec.ts` pins it there. What a browser can prove is the
   * precondition: the screen sends no period, so the server's default is the one that
   * decides. A screen that sent its own `periodLabel` would make that service change
   * invisible — which is exactly how a default nothing observed survived into her walk.
   */
  expect(askedFor).not.toContain("periodLabel");
  expect(askedFor).not.toContain("periodStart");
  expect(askedFor).not.toContain("periodEnd");
  // A FLOOR: `askedFor` must have been written, or the three assertions above pass
  // against a request that never happened.
  expect(askedFor).not.toBe("unset");
});

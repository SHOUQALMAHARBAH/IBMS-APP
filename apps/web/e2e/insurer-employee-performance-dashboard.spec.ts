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

const INSURER_SCORES = [
  {
    id: "score-1",
    insurerId: "ins-1",
    // Item 1 — resolved by the api through the one resolver that owns the question.
    insurerName: "شركة الأردن للتأمين",
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
    // Item 1 — the colleague's name from their HR record.
    employeeName: "سامر عبدالله الحوراني",
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
  /*
   * ITEM 1 — RE-POINTED, AND THE REVERSAL IS STATED. These asserted `ins-1` and `emp-1`, the two
   * uuids this dashboard rendered where a company and a colleague belong. Both are resolved by the
   * api now, through each entity's OWN resolver.
   *
   * EACH IS A PAIR — the name present AND the uuid absent — because a half-done screen rendering
   * both would satisfy a name-only assertion.
   */
  await expect(
    page.getByRole("cell", { name: "شركة الأردن للتأمين" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "ins-1", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("90.00")).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "سامر عبدالله الحوراني" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "emp-1", exact: true }),
  ).toHaveCount(0);
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
  /* RE-POINTED at the resolved NAME. Both of these are READY ANCHORS — the one signal that the
   * fetch resolved and the row painted — rather than claims about identity; the uuid simply used to
   * be the text in that cell. The filter still TAKES an id, which is the typed-identifier budget's
   * question and not this one. */
  await expect(page.getByText("شركة الأردن للتأمين")).toBeVisible();

  /*
   * RE-POINTED at the picker, and this test's OWN COMMENT above named the reason:
   * "the filter still TAKES an id, which is the typed-identifier budget's question and
   * not this one". That question is now answered — the filter takes a NAME, and
   * `getByLabel("Insurer ID filter")` is gone because the `aria-label` it read was
   * withdrawn with the input: its text named our surrogate key, which is what decision
   * 21 corrected in the label beside it and never in the aria.
   *
   * The assertion that matters is UNCHANGED and is why this is stronger rather than
   * merely different: whatever the reader chose must reach the insurer-performance
   * request and must NOT reach the employee-performance one.
   */
  await page.route(
    "http://localhost:4000/insurers/search**",
    (route) =>
      route.fulfill({
        status: 200,
        json: [
          { id: "ins-1", name: "Jordan Insurance", nameAr: "شركة الأردن للتأمين" },
        ],
      }),
  );
  const insurer = page.locator('[data-entity-search-term="insurer"]');
  await insurer.fill("Jor");
  await expect(page.locator('[data-entity-search-list="insurer"]')).toBeVisible();
  await insurer.press("Enter");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("شركة الأردن للتأمين")).toBeVisible();

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
      "(insurer-performance.view, employee-performance.view)",
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
  // Re-pointed at the resolved name — a ready anchor, so axe runs on the painted table.
  await expect(page.getByText("سامر عبدالله الحوراني")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

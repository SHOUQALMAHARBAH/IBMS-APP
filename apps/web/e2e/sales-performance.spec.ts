import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "sales@ibms.test",
  fullName: "Sales Officer",
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

const PERFORMANCE = {
  scope: { ownerUserId: "user-1" },
  target: {
    id: "target-1",
    ownerUserId: "user-1",
    branchId: null,
    periodLabel: "2026-Q4",
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2027-01-01T00:00:00.000Z",
    targetNewProspects: 10,
    createdByUserId: "manager-1",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  },
  actual: { newLeads: 8, newProspects: 4 },
  achievementPercent: 40,
};

async function mockPerformance(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/sales-performance*", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: PERFORMANCE });
  });
}

test("a Sales Officer sees their own performance vs. target with no scope picker", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockPerformance(page);

  await page.goto("/sales-performance");
  await expect(
    page.getByRole("heading", { name: "Sales Performance" }),
  ).toBeVisible();
  await expect(page.getByText("40%")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Look up performance" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Set target" }),
  ).toHaveCount(0);
});

test("a Manager sees a scope picker and a set-target form", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockPerformance(page);

  await page.goto("/sales-performance");
  await expect(
    page.getByRole("heading", { name: "Look up performance" }),
  ).toBeVisible();
  await page.getByPlaceholder("one employee").fill("user-1");
  await page.getByRole("button", { name: "View performance" }).click();
  await expect(page.getByText("40%")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Revise target" }),
  ).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await mockPerformance(page, { status: 403 });

  await page.goto("/sales-performance");
  await expect(
    page.getByText("dashboard.sales.view permission", { exact: false }),
  ).toBeVisible();
});

test("sales performance screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockPerformance(page);

  await page.goto("/sales-performance");
  await expect(page.getByText("40%")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

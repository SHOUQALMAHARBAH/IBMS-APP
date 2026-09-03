import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "finance@ibms.test",
  fullName: "Finance Officer",
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

const REPORT = {
  asOf: "2026-09-03T00:00:00.000Z",
  currency: "JOD",
  rows: [
    {
      customerId: "acme",
      customerLegalName: "Acme Ltd",
      currency: "JOD",
      current: "0.000",
      d1_30: "0.000",
      d31_60: "0.000",
      d61_90: "0.000",
      d90_plus: "115350.000",
      outstandingTotal: "115350.000",
      invoiceCount: 1,
      oldestDueDate: "2026-05-01T00:00:00.000Z",
      oldestDaysOverdue: 125,
    },
    {
      customerId: "beta",
      customerLegalName: "Beta Co",
      currency: "JOD",
      current: "4000.000",
      d1_30: "2000.000",
      d31_60: "0.000",
      d61_90: "0.000",
      d90_plus: "0.000",
      outstandingTotal: "6000.000",
      invoiceCount: 2,
      oldestDueDate: "2026-08-20T00:00:00.000Z",
      oldestDaysOverdue: 14,
    },
  ],
  totals: {
    current: "4000.000",
    d1_30: "2000.000",
    d31_60: "0.000",
    d61_90: "0.000",
    d90_plus: "115350.000",
    outstandingTotal: "121350.000",
    invoiceCount: 3,
    customerCount: 2,
  },
};

async function mockAgeing(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/client-accounting/ageing**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: REPORT });
  });
}

test("shows the ageing report worst-first with a totals row", async ({ page }) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockAgeing(page);

  await page.goto("/client-accounting");
  await expect(
    page.getByRole("heading", { name: "Client accounting" }),
  ).toBeVisible();

  // worst-first: Acme (125d) is the first data row
  const firstRowCells = page.locator("tbody tr").first().locator("td");
  await expect(firstRowCells.first()).toHaveText("Acme Ltd");
  await expect(page.getByRole("cell", { name: "125d overdue" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "JOD 115,350.000" }).first(),
  ).toBeVisible();

  await expect(page.getByRole("cell", { name: "Beta Co" })).toBeVisible();

  // totals row
  await expect(page.getByRole("cell", { name: "Total" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "JOD 121,350.000" }),
  ).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockAgeing(page, { status: 403 });

  await page.goto("/client-accounting");
  await expect(
    page.getByText("client-accounting.read permission", { exact: false }),
  ).toBeVisible();
});

test("client accounting screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockAgeing(page);

  await page.goto("/client-accounting");
  await expect(page.getByRole("cell", { name: "Acme Ltd" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

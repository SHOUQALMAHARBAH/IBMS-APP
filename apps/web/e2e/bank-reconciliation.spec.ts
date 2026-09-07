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

const EXCEPTIONS = [
  {
    id: "re-1",
    invoiceId: "inv-1",
    insurerStatementAmount: "110600.000",
    brokerRecordAmount: "105600.000",
    varianceAmount: "5000.000",
    status: "open",
    isResolved: false,
    raisedByUserId: "fin-1",
    investigatedByUserId: null,
    resolvedByUserId: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: "2026-09-03T10:00:00.000Z",
  },
];

async function mockRecon(page: Page, opts: { status?: number } = {}) {
  await page.route(
    "http://localhost:4000/reconciliation-exceptions**",
    (route) => {
      if (opts.status && opts.status !== 200) {
        return route.fulfill({ status: opts.status, json: { message: "no" } });
      }
      return route.fulfill({ status: 200, json: EXCEPTIONS });
    },
  );
}

test("lists open exceptions with the exact variance amount", async ({
  page,
}) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockRecon(page);

  await page.goto("/bank-reconciliation");
  await expect(
    page.getByRole("heading", { name: "Bank reconciliation" }),
  ).toBeVisible();

  await expect(page.getByRole("cell", { name: "5000.000" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "open", exact: true })).toBeVisible();

  // Finance sees the detect form + the per-row actions
  await expect(page.getByLabel("Statement lines")).toBeVisible();
  await expect(page.getByRole("button", { name: "Investigate" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRecon(page, { status: 403 });

  await page.goto("/bank-reconciliation");
  await expect(
    page.getByText("reconciliation-exception.investigate permission", {
      exact: false,
    }),
  ).toBeVisible();
});

test("bank-reconciliation screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockRecon(page);

  await page.goto("/bank-reconciliation");
  await expect(page.getByRole("cell", { name: "5000.000" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

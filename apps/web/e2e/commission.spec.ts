import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "compliance@ibms.test",
  fullName: "Compliance Officer",
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

const AGREEMENTS = [
  {
    id: "ag-open",
    insurerId: "ins-1",
    insurerName: "Acme Insurance",
    insuranceLine: "Property All Risks",
    ratePercent: "10.00",
    effectiveFrom: "2026-06-01T00:00:00.000Z",
    effectiveTo: null,
    isOpen: true,
  },
  {
    id: "ag-closed",
    insurerId: "ins-1",
    insurerName: "Acme Insurance",
    insuranceLine: "Property All Risks",
    ratePercent: "15.00",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: "2026-06-01T00:00:00.000Z",
    isOpen: false,
  },
];

async function mockCommission(page: Page, opts: { status?: number } = {}) {
  await page.route(
    "http://localhost:4000/commission/agreements**",
    (route) => {
      if (opts.status && opts.status !== 200) {
        return route.fulfill({ status: opts.status, json: { message: "no" } });
      }
      return route.fulfill({ status: 200, json: AGREEMENTS });
    },
  );
  await page.route("http://localhost:4000/commission/insurers**", (route) =>
    route.fulfill({
      status: 200,
      json: [{ id: "ins-1", name: "Acme Insurance" }],
    }),
  );
}

test("shows the governed rate table with the open + closed windows", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockCommission(page);

  await page.goto("/commission");
  await expect(
    page.getByRole("heading", { name: "Commission rates" }),
  ).toBeVisible();

  await expect(page.getByRole("cell", { name: "10.00%" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "15.00%" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Open", exact: true })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Closed", exact: true }),
  ).toBeVisible();

  // Compliance sees the add form
  await expect(page.getByLabel("Insurer")).toBeVisible();
  await expect(page.getByLabel("Rate percent")).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockCommission(page, { status: 403 });

  await page.goto("/commission");
  await expect(
    page.getByText("commission-rate.manage permission", { exact: false }),
  ).toBeVisible();
});

test("commission rates screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockCommission(page);

  await page.goto("/commission");
  await expect(page.getByRole("cell", { name: "10.00%" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

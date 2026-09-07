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

const SYNC_RUNS = [
  {
    id: "run-1",
    source: "OFAC_SDN",
    startedAt: "2026-09-05T00:00:00.000Z",
    completedAt: "2026-09-05T00:00:05.000Z",
    status: "succeeded",
    recordCount: 19329,
    errorMessage: null,
  },
  {
    id: "run-2",
    source: "UN_CONSOLIDATED",
    startedAt: "2026-09-05T00:00:00.000Z",
    completedAt: "2026-09-05T00:00:03.000Z",
    status: "succeeded",
    recordCount: 1011,
    errorMessage: null,
  },
];

async function mockStatus(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/watchlist-sync/status**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: SYNC_RUNS });
  });
}

test("lists sync runs with the sync/batch buttons", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockStatus(page);

  await page.goto("/watchlist-sync");
  await expect(
    page.getByRole("heading", { name: "Sanctions & PEP watchlist sync" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "OFAC_SDN" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "UN_CONSOLIDATED" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sync watchlists now" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run recurring screening batch now" }),
  ).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockStatus(page, { status: 403 });

  await page.goto("/watchlist-sync");
  await expect(
    page.getByText("sanctions-pep.screen permission", { exact: false }),
  ).toBeVisible();
});

test("watchlist-sync screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockStatus(page);

  await page.goto("/watchlist-sync");
  await expect(page.getByRole("cell", { name: "OFAC_SDN" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

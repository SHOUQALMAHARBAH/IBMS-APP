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

const HISTORY = [
  {
    id: "score-2",
    insurerId: "insurer-1",
    periodLabel: "2026-08",
    quoteResponseScore: "92.50",
    claimsServiceScore: "100.00",
    priceScore: "70.00",
    serviceQualityScore: "80.00",
    computedAt: "2026-09-01T06:00:00.000Z",
  },
  {
    id: "score-1",
    insurerId: "insurer-1",
    periodLabel: "2026-07",
    quoteResponseScore: "60.00",
    claimsServiceScore: "50.00",
    priceScore: "55.00",
    serviceQualityScore: "50.00",
    computedAt: "2026-08-01T06:00:00.000Z",
  },
];

async function mockList(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/insurer-performance*", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: HISTORY });
  });
}

test("looks up an insurer and renders its latest scores plus history", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockList(page);

  await page.goto("/insurer-performance");
  await expect(
    page.getByRole("heading", { name: "Insurer Performance" }),
  ).toBeVisible();
  await page.getByLabel("Insurer ID").fill("insurer-1");
  await page.getByRole("button", { name: "View performance" }).click();

  await expect(page.getByText("92.50").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "2026-07" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockList(page, { status: 403 });

  await page.goto("/insurer-performance");
  await page.getByLabel("Insurer ID").fill("insurer-1");
  await page.getByRole("button", { name: "View performance" }).click();
  await expect(
    page.getByText("insurer-performance.view permission", { exact: false }),
  ).toBeVisible();
});

test("triggers a compute and refreshes the history", async ({ page }) => {
  await mockAuth(page, ["EXECUTIVE_MANAGEMENT"]);
  await mockList(page);
  await page.route("http://localhost:4000/insurer-performance/compute", (route) =>
    route.fulfill({ status: 201, json: HISTORY[0] }),
  );

  await page.goto("/insurer-performance");
  await page.getByLabel("Insurer ID").fill("insurer-1");
  await page.getByRole("button", { name: "Compute" }).click();
  await expect(page.getByText("Score computed.")).toBeVisible();
});

test("insurer performance screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockList(page);

  await page.goto("/insurer-performance");
  await page.getByLabel("Insurer ID").fill("insurer-1");
  await page.getByRole("button", { name: "View performance" }).click();
  await expect(page.getByText("92.50").first()).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

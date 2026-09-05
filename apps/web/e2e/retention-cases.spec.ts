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

const RETENTION_CASES = [
  {
    id: "rc-1",
    customerId: "11111111-1111-1111-1111-111111111111",
    reason: "lapse_risk",
    status: "open",
    isClosed: false,
    createdAt: "2026-09-04T09:00:00.000Z",
    closedAt: null,
  },
  {
    id: "rc-2",
    customerId: "11111111-1111-1111-1111-111111111111",
    reason: "renewal_inactivity",
    status: "closed",
    isClosed: true,
    createdAt: "2026-08-01T09:00:00.000Z",
    closedAt: "2026-08-15T09:00:00.000Z",
  },
];

async function mockRetentionCases(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/retention-cases**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: RETENTION_CASES });
  });
}

test("lists retention cases with reason/status and the open form", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockRetentionCases(page);

  await page.goto("/retention-cases");
  await expect(
    page.getByRole("heading", { name: "Customer retention" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "lapse_risk" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "renewal_inactivity" }),
  ).toBeVisible();
  await expect(page.getByLabel("Reason")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open retention case" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run detection sweep now" }),
  ).toBeVisible();
  // the open case shows a Close action, the closed one does not
  await expect(page.getByRole("button", { name: "Close" })).toHaveCount(1);
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockRetentionCases(page, { status: 403 });

  await page.goto("/retention-cases");
  await expect(
    page.getByText("retention-case.manage permission", { exact: false }),
  ).toBeVisible();
});

test("retention screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockRetentionCases(page);

  await page.goto("/retention-cases");
  await expect(page.getByRole("cell", { name: "lapse_risk" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

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

const ALERTS = [
  {
    id: "tma-1",
    customerId: "11111111-1111-1111-1111-111111111111",
    patternType: "large_premium_payment",
    detailText: "Premium payment of 20000.000 JOD on invoice inv-1 meets or exceeds the threshold.",
    sourceEntityType: "Receipt",
    sourceEntityId: "receipt-1",
    detectedAt: "2026-09-04T09:00:00.000Z",
    escalatedToSuspiciousActivity: false,
    escalatedAt: null,
    reportedToAuthorityAt: null,
    status: "open",
    isClosed: false,
    classification: "HIGHLY_CONFIDENTIAL",
  },
  {
    id: "tma-2",
    customerId: "11111111-1111-1111-1111-111111111111",
    patternType: "frequent_cancellations",
    detailText: "3 cancellation(s) in the trailing 90 calendar days.",
    sourceEntityType: null,
    sourceEntityId: null,
    detectedAt: "2026-08-01T09:00:00.000Z",
    escalatedToSuspiciousActivity: true,
    escalatedAt: "2026-08-02T09:00:00.000Z",
    reportedToAuthorityAt: "2026-08-03T09:00:00.000Z",
    status: "closed",
    isClosed: true,
    classification: "HIGHLY_CONFIDENTIAL",
  },
];

async function mockAlerts(page: Page, opts: { status?: number } = {}) {
  await page.route(
    "http://localhost:4000/transaction-monitoring-alerts**",
    (route) => {
      if (opts.status && opts.status !== 200) {
        return route.fulfill({ status: opts.status, json: { message: "no" } });
      }
      return route.fulfill({ status: 200, json: ALERTS });
    },
  );
}

test("lists transaction-monitoring alerts with the log form and sweep button", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockAlerts(page);

  await page.goto("/transaction-monitoring");
  await expect(
    page.getByRole("heading", { name: "AML/CFT transaction monitoring" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "large_premium_payment" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "frequent_cancellations" }),
  ).toBeVisible();
  await expect(page.getByLabel("Pattern")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log alert" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run detection sweep now" }),
  ).toBeVisible();
  // the open, unescalated alert shows Escalate + Close; the closed one shows neither.
  await expect(page.getByRole("button", { name: "Escalate" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Close" })).toHaveCount(1);
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockAlerts(page, { status: 403 });

  await page.goto("/transaction-monitoring");
  await expect(
    page.getByText("aml.monitor permission", { exact: false }),
  ).toBeVisible();
});

test("transaction-monitoring screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockAlerts(page);

  await page.goto("/transaction-monitoring");
  await expect(
    page.getByRole("cell", { name: "large_premium_payment" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

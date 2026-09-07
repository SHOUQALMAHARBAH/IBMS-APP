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

const SUMMARY = {
  generatedAt: "2026-09-07T00:00:00.000Z",
  kyc: { byStatus: { DRAFT: 2, SUBMITTED: 1, SCREENING: 0, EDD: 0, COMPLIANCE_REVIEW: 1, APPROVED: 40, REJECTED: 1, PERIODIC_REVIEW_DUE: 3 } },
  complaints: {
    byStatus: { LOGGED: 1, ASSIGNED: 0, IN_PROGRESS: 2, RESOLVED: 3, CLOSED: 10, ESCALATED: 1 },
    byCategory: { denied_claim: 2, delayed_issuance: 3, premium_dispute: 0, unanswered_claim: 1, other: 1, uncategorized: 0 },
  },
  complianceExceptions: {
    openAmlAlertsCount: 4,
    amlByPatternType: { large_premium_payment: 2, frequent_cancellations: 1, frequent_refunds: 0, third_party_payment_source: 1, other: 0 },
    lastSelfApprovalScan: { asOf: "2026-09-01T00:00:00.000Z", violationCount: 0 },
  },
  regulatoryFilings: { totalCount: 12, submittedCount: 9, overdueCount: 1, pendingCount: 2 },
  dsr: { openCount: 5, byStatus: { RECEIVED: 2, IDENTITY_VERIFIED: 1, IN_PROGRESS: 2, PARTIALLY_FULFILLED: 0, FULFILLED: 8, REJECTED: 1, CLOSED: 9 } },
  breachRegister: { openCount: 2, byStatus: { REPORTED: 1, CONTAINED: 1, IMPACT_ASSESSED: 0, CLASSIFIED: 0, NOTIFIED: 0, RECOVERED: 0, CLOSED: 6 } },
  dpiaBacklog: { pendingReviewCount: 3, byOutcome: { AUTO_APPROVED: 20, DPO_REVIEW_REQUIRED: 3, ESCALATED_FULL_DPIA: 0 } },
};

test("renders every metric section with real figures", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/dashboards/compliance**", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dashboards/compliance");
  await expect(page.getByRole("heading", { name: "Compliance Dashboard" })).toBeVisible();
  await expect(page.getByText("4", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("5", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("2", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("3", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
});

test("a user without the permission sees the underlying error message", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await page.route("http://localhost:4000/dashboards/compliance**", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/dashboards/compliance");
  await expect(
    page.getByText("You don't hold the dashboard.compliance.view permission.", { exact: false }),
  ).toBeVisible();
});

test("compliance dashboard screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/dashboards/compliance**", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dashboards/compliance");
  await expect(page.getByRole("heading", { name: "Compliance Dashboard" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

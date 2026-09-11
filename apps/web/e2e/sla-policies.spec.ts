import { expect, test, type Page } from "@playwright/test";

// Configurable SLA policies (task Part A).
//
// The behaviour worth pinning here is NOT the table markup. It is that the
// screen never presents an internal target as a legal requirement — that is
// the entire reason SLA provenance became a structured field, and a UI that
// blurs it puts the whole feature back where it started.

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Compliance Officer",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(
  page: Page,
  roles: string[],
  languagePreference: "AR" | "EN" = "EN",
) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, languagePreference },
    }),
  );
}

function policy(over: Record<string, unknown> = {}) {
  return {
    id: "p-1",
    policyCode: "SLA-DSR-ACCESS-DELETION",
    policyName: "DSR — Access / Deletion",
    processType: "dsr_access_deletion",
    workflowState: null,
    description: null,
    durationValue: 15,
    durationUnit: "BUSINESS_DAYS",
    calendarType: "JORDAN_STANDARD",
    customWeekendDays: [],
    workingHoursStart: null,
    workingHoursEnd: null,
    timezone: "Asia/Amman",
    sourceType: "REGULATORY",
    sourceReference: "DSR — Access / Deletion (M04)",
    sourceDocument: "PRIV-STD-01",
    sourceSection: "§6.4",
    isRegulatory: true,
    sourceLabel: "Regulatory — PRIV-STD-01 §6.4",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    escalationEnabled: true,
    warningThreshold: 0.8,
    status: "ACTIVE",
    escalations: [],
    createdByUserId: "system",
    updatedByUserId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const internalPolicy = policy({
  id: "p-2",
  policyCode: "SLA-SANCTIONS-MATCH-REVIEW",
  policyName: "Sanctions match review (Compliance adjudication)",
  processType: "sanctions_match_review",
  durationValue: 3,
  sourceType: "INTERNAL_POLICY",
  sourceReference: null,
  sourceDocument: null,
  sourceSection: null,
  isRegulatory: false,
  sourceLabel: "Internal policy",
});

async function mockPolicies(page: Page, rows: Record<string, unknown>[]) {
  await page.route("**/sla/policies*", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, json: rows });
  });
}

test("marks an internal SLA as NOT a legal requirement", async ({ page }) => {
  // The 3-business-day sanctions-match figure: drafted in this repo, tighter
  // than the standard KYC review, on reasoning that is the broker's and not a
  // regulator's. It must never read as law.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [internalPolicy]);

  await page.goto("/sla-policies");

  await expect(
    page.getByText("Sanctions match review", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Internal policy", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Not a legal requirement")).toBeVisible();
  await expect(page.locator('[data-regulatory="false"]')).toHaveCount(1);
});

test("shows a regulatory SLA with the instrument that requires it", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [policy()]);

  await page.goto("/sla-policies");

  await expect(page.getByText("Regulatory — PRIV-STD-01 §6.4")).toBeVisible();
  await expect(page.locator('[data-regulatory="true"]')).toHaveCount(1);
  // A regulatory row must NOT carry the internal disclaimer.
  await expect(page.getByText("Not a legal requirement")).toHaveCount(0);
});

test("distinguishes the two side by side", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [policy(), internalPolicy]);

  await page.goto("/sla-policies");

  await expect(page.locator('[data-regulatory="true"]')).toHaveCount(1);
  await expect(page.locator('[data-regulatory="false"]')).toHaveCount(1);
});

test("shows business days as the unit, not raw hours", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [policy()]);

  await page.goto("/sla-policies");

  await expect(page.getByText("business days")).toBeVisible();
});

test("a read-only role sees the policies but cannot edit them", async ({
  page,
}) => {
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await mockPolicies(page, [policy()]);

  await page.goto("/sla-policies");

  await expect(page.getByText("DSR — Access / Deletion")).toBeVisible();
  await expect(page.getByText("Read only")).toBeVisible();
  await expect(page.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
});

test("surfaces a permission failure rather than an empty list", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/sla/policies*", (route) =>
    route.fulfill({ status: 403, json: { message: "Forbidden" } }),
  );

  await page.goto("/sla-policies");

  await expect(
    page.getByRole("alert").filter({ hasText: "sla.policy.read" }),
  ).toBeVisible();
  await expect(page.getByText("No policies.")).toHaveCount(0);
});

test("renders in Arabic with RTL direction", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"], "AR");
  await mockPolicies(page, [internalPolicy]);

  await page.goto("/sla-policies");

  await expect(
    page.getByRole("heading", { name: "سياسات مستوى الخدمة" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  // The distinction must survive translation — this is the claim that matters.
  await expect(page.getByText("سياسة داخلية", { exact: true })).toBeVisible();
  // Scoped to the TABLE: the intro paragraph also explains what a
  // non-regulatory SLA means, so a page-wide match is ambiguous. The claim
  // being tested is that the ROW carries the disclaimer.
  await expect(
    page.locator("table").getByText("ليست إلزاماً قانونياً"),
  ).toBeVisible();
});

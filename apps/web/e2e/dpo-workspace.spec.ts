import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "dpo@ibms.test",
  fullName: "Data Protection Officer",
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
  consentStatus: { activeCount: 3, withdrawnCount: 1, declinedCount: 0 },
  dsrQueue: [
    {
      id: "dsr-1",
      type: "ACCESS",
      status: "IN_PROGRESS",
      slaDueAt: "2026-09-25T00:00:00.000Z",
      daysUntilDue: 18,
      isOverdue: false,
    },
  ],
  incidentRegister: [
    { id: "inc-1", title: "Phishing attempt", severity: "HIGH", status: "CONTAINED" },
  ],
  dpiaRegister: [
    {
      id: "dpia-1",
      subjectDescription: "New biometric fraud-detection feature.",
      outcome: "DPO_REVIEW_REQUIRED",
      dpoReviewDueAt: "2026-09-14T00:00:00.000Z",
    },
  ],
  legalHoldRegister: [
    { id: "lh-1", scope: "Customer XYZ file", nextReviewDueAt: "2027-03-01T00:00:00.000Z", isActive: true },
  ],
  crossBorderTransferRegister: [
    { id: "cbt-1", destinationCountry: "United Kingdom", legalBasis: "standard_contractual_clauses", transferredAt: "2026-09-01T00:00:00.000Z" },
  ],
};

test("aggregates all six registers on one screen", async ({ page }) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/dpo-workspace/summary", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dpo-workspace");
  await expect(page.getByRole("heading", { name: "DPO Workspace" })).toBeVisible();
  await expect(page.getByText("Active: 3")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Phishing attempt" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "New biometric fraud-detection feature." })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Customer XYZ file" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "United Kingdom" })).toBeVisible();
  await expect(page.getByText("18d")).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/dpo-workspace/summary", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/dpo-workspace");
  await expect(
    page.getByText("You do not hold a permission required", { exact: false }),
  ).toBeVisible();
});

test("dpo-workspace screen has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/dpo-workspace/summary", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dpo-workspace");
  await expect(page.getByText("Active: 3")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});
